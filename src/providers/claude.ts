/**
 * @fileoverview Anthropic Claude provider adapter.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, StreamEvent, ContentBlock, ToolUseBlock, TextBlock, ToolSchema } from '../types.js';
import { ProviderError } from '../core/errors.js';
import { normalizeContent } from '../core/message.js';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude' as const;
  readonly supportsTools = true;
  readonly supportsStreaming = true;
  readonly supportsVision = true;

  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
    });
  }

  /**
   * Gerçek token sayımı — API'den doğru sayı.
   */
  async countTokens(messages: ChatMessage[], systemPrompt?: string): Promise<number> {
    try {
      const { anthropicMessages } = this.prepareMessages(messages, { model: 'claude-3-5-haiku-latest', systemPrompt });
      const result = await this.client.messages.countTokens({
        model: 'claude-3-5-haiku-latest',
        system: systemPrompt,
        messages: anthropicMessages,
      });
      return result.input_tokens;
    } catch {
      const text = messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('');
      return Math.ceil(text.length / 4);
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const { systemPrompt, anthropicMessages } = this.prepareMessages(messages, options);
    const cachedSystem = this.buildCachedSystem(systemPrompt);
    const cachedTools = options.tools ? this.toCachedTools(options.tools) : undefined;

    try {
      const response = await this.client.messages.create(
        {
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          messages: anthropicMessages,
          system: cachedSystem as any,
          tools: cachedTools as any,
          temperature: options.temperature,
        },
        { signal: options.abortSignal },
      );

      return {
        id: response.id,
        content: response.content.map(b => this.fromAnthropicBlock(b)),
        model: response.model,
        stopReason: response.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (err) {
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        'claude',
      );
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<StreamEvent> {
    const { systemPrompt, anthropicMessages } = this.prepareMessages(messages, options);
    const cachedSystem = this.buildCachedSystem(systemPrompt);
    const cachedTools = options.tools ? this.toCachedTools(options.tools) : undefined;

    const stream = this.client.messages.stream(
      {
        model: options.model,
        max_tokens: options.maxTokens ?? 4096,
        messages: anthropicMessages,
        system: cachedSystem as any,
        tools: cachedTools as any,
        temperature: options.temperature,
      },
      { signal: options.abortSignal },
    );

    const toolBuffers = new Map<number, { id: string; name: string; json: string }>();

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              toolBuffers.set(event.index, { id: block.id, name: block.name, json: '' });
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text', data: delta.text };
            } else if (delta.type === 'input_json_delta') {
              const buf = toolBuffers.get(event.index);
              if (buf) buf.json += delta.partial_json;
            }
            break;
          }
          case 'content_block_stop': {
            const buf = toolBuffers.get(event.index);
            if (buf) {
              let input: Record<string, unknown> = {};
              try { input = JSON.parse(buf.json) as Record<string, unknown>; } catch { /* empty */ }
              const toolBlock: ToolUseBlock = { type: 'tool_use', id: buf.id, name: buf.name, input };
              yield { type: 'tool_use', data: toolBlock };
              toolBuffers.delete(event.index);
            }
            break;
          }
        }
      }

      const final = await stream.finalMessage();
      const content = final.content.map(b => this.fromAnthropicBlock(b));
      yield {
        type: 'done',
        data: {
          id: final.id,
          content,
          model: final.model,
          stopReason: final.stop_reason ?? 'end_turn',
          usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
        } satisfies ChatResponse,
      };
    } catch (err) {
      yield { type: 'error', data: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  private prepareMessages(messages: ChatMessage[], options: ChatOptions) {
    let systemPrompt: string | undefined = options.systemPrompt;
    const anthropicMessages: Anthropic.Messages.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = typeof msg.content === 'string' ? msg.content : '';
        continue;
      }
      const blocks = normalizeContent(msg.content);
      const filtered = blocks
        .map(b => this.toAnthropicBlock(b))
        .filter((b): b is Anthropic.Messages.ContentBlockParam => b !== null);
      // Tüm bloklar reasoning ise (Claude'da desteklenmez) mesajı atla
      if (filtered.length === 0) continue;
      anthropicMessages.push({ role: msg.role, content: filtered });
    }

    return { systemPrompt, anthropicMessages };
  }

  private toAnthropicBlock(block: ContentBlock): Anthropic.Messages.ContentBlockParam | null {
    switch (block.type) {
      case 'text': return { type: 'text', text: block.text };
      case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result': return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error };
      case 'reasoning': return null; // Claude'da reasoning_content yok, görmezden gel
    }
  }

  private fromAnthropicBlock(block: Anthropic.Messages.ContentBlock): ContentBlock {
    switch (block.type) {
      case 'text': return { type: 'text', text: block.text };
      case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> };
      default: return { type: 'text', text: `[unsupported: ${(block as { type: string }).type}]` };
    }
  }

  private toAnthropicTools(tools: readonly ToolSchema[]): Anthropic.Messages.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object' as const, ...t.inputSchema },
    }));
  }

  /** System promptu önbelleklenebilir blok dizisine dönüştür. */
  private buildCachedSystem(systemPrompt: string | undefined): any {
    if (!systemPrompt) return undefined;
    return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  }

  /** Tool listesini önbelleklenebilir hale getir (son araça cache_control ekle). */
  private toCachedTools(tools: readonly ToolSchema[]): any[] {
    const anthropicTools = this.toAnthropicTools(tools);
    if (anthropicTools.length === 0) return anthropicTools;
    const last = { ...anthropicTools[anthropicTools.length - 1]!, cache_control: { type: 'ephemeral' } };
    return [...anthropicTools.slice(0, -1), last];
  }
}
