/**
 * @fileoverview OpenAI provider adapter.
 */

import OpenAI from 'openai';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, StreamEvent, ContentBlock, ToolUseBlock, TextBlock, ToolSchema } from '../types.js';
import { ProviderError } from '../core/errors.js';
import { normalizeContent } from '../core/message.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  readonly supportsTools = true;
  readonly supportsStreaming = true;
  readonly supportsVision = true;

  private readonly client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: options.model,
          messages: openaiMessages,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          tools: options.tools ? options.tools.map(t => this.toOpenAITool(t)) : undefined,
          stream: false,
        },
        { signal: options.abortSignal },
      );

      return this.fromCompletion(completion);
    } catch (err) {
      throw new ProviderError(err instanceof Error ? err.message : String(err), 'openai');
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<StreamEvent> {
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: options.model,
          messages: openaiMessages,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          tools: options.tools ? options.tools.map(t => this.toOpenAITool(t)) : undefined,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: options.abortSignal },
      );

      let fullText = '';
      let completionId = '';
      let completionModel = '';
      let finishReason = 'stop';
      let inputTokens = 0;
      let outputTokens = 0;
      const toolBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        completionId = chunk.id;
        completionModel = chunk.model;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta.content) {
          fullText += delta.content;
          yield { type: 'text', data: delta.content };
        }

        for (const tc of delta.tool_calls ?? []) {
          if (!toolBuffers.has(tc.index)) {
            toolBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
          }
          const buf = toolBuffers.get(tc.index)!;
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.args += tc.function.arguments;
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }

      const toolBlocks: ToolUseBlock[] = [];
      for (const buf of toolBuffers.values()) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(buf.args) as Record<string, unknown>; } catch { /* empty */ }
        const block: ToolUseBlock = { type: 'tool_use', id: buf.id, name: buf.name, input };
        toolBlocks.push(block);
        yield { type: 'tool_use', data: block };
      }

      const content: ContentBlock[] = [];
      if (fullText) content.push({ type: 'text', text: fullText });
      content.push(...toolBlocks);

      yield {
        type: 'done',
        data: {
          id: completionId,
          content,
          model: completionModel,
          stopReason: this.normalizeFinishReason(finishReason),
          usage: { inputTokens, outputTokens },
        } satisfies ChatResponse,
      };
    } catch (err) {
      yield { type: 'error', data: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  private toOpenAIMessages(messages: ChatMessage[], systemPrompt?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) result.push({ role: 'system', content: systemPrompt });

    for (const msg of messages) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
        continue;
      }
      const blocks = normalizeContent(msg.content);
      if (msg.role === 'assistant') {
        const textParts: string[] = [];
        const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
        for (const b of blocks) {
          if (b.type === 'text') textParts.push(b.text);
          else if (b.type === 'tool_use') {
            toolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } });
          }
        }
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: textParts.join('') || null,
        };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg);
      } else {
        // User messages — split tool_results into separate 'tool' role messages
        const nonTool = blocks.filter(b => b.type !== 'tool_result');
        const toolResults = blocks.filter(b => b.type === 'tool_result');
        if (nonTool.length > 0) {
          const text = nonTool.filter(b => b.type === 'text').map(b => (b as TextBlock).text).join('');
          if (text) result.push({ role: 'user', content: text });
        }
        for (const tr of toolResults) {
          if (tr.type === 'tool_result') {
            result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
          }
        }
      }
    }
    return result;
  }

  private toOpenAITool(tool: ToolSchema): OpenAI.Chat.ChatCompletionTool {
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    };
  }

  private fromCompletion(completion: OpenAI.Chat.ChatCompletion): ChatResponse {
    const choice = completion.choices[0];
    if (!choice) throw new ProviderError('No choices in response', 'openai');
    const content: ContentBlock[] = [];
    if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
    for (const tc of choice.message.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* empty */ }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    return {
      id: completion.id,
      content,
      model: completion.model,
      stopReason: this.normalizeFinishReason(choice.finish_reason ?? 'stop'),
      usage: { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 },
    };
  }

  private normalizeFinishReason(reason: string): string {
    switch (reason) {
      case 'stop': return 'end_turn';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'max_tokens';
      default: return reason;
    }
  }
}
