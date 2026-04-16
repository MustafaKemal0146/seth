/**
 * @fileoverview Ollama provider adapter.
 * Uses raw fetch — no SDK dependency. This is critical for local-first experience.
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, StreamEvent, ContentBlock, ToolSchema, ToolUseBlock, TextBlock } from '../types.js';
import { ProviderError } from '../core/errors.js';
import { normalizeContent } from '../core/message.js';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly supportsTools = true;
  readonly supportsStreaming = true;
  readonly supportsVision = false;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl = 'http://localhost:11434', timeoutMs = 120_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const ollamaMessages = this.toOllamaMessages(messages, options.systemPrompt);
    const tools = options.tools ? options.tools.map(t => this.toOllamaTool(t)) : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: ollamaMessages,
          tools,
          stream: false,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Bilinmeyen hata');
        throw new ProviderError(`Ollama API hatası (${res.status}): ${errorText}`, 'ollama', res.status);
      }

      const data = await res.json() as OllamaChatResponse;
      return this.fromOllamaResponse(data, options.model);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        throw new ProviderError(
          `Ollama'ya bağlanılamadı (${this.baseUrl}). Ollama çalışıyor mu? 'ollama serve' komutuyla başlatmayı deneyin.`,
          'ollama',
        );
      }
      throw new ProviderError(message, 'ollama');
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<StreamEvent> {
    const ollamaMessages = this.toOllamaMessages(messages, options.systemPrompt);
    const tools = options.tools ? options.tools.map(t => this.toOllamaTool(t)) : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: ollamaMessages,
          tools,
          stream: true,
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Bilinmeyen hata');
        yield { type: 'error', data: new ProviderError(`Ollama API hatası (${res.status}): ${errorText}`, 'ollama') };
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        yield { type: 'error', data: new Error('Ollama boş yanıt döndürdü.') };
        return;
      }

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      const toolCalls: ToolUseBlock[] = [];
      let promptTokens = 0;
      let completionTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as OllamaChatResponse;

            if (chunk.message?.content) {
              fullText += chunk.message.content;
              yield { type: 'text', data: chunk.message.content };
            }

            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                const block: ToolUseBlock = {
                  type: 'tool_use',
                  id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function.name,
                  input: tc.function.arguments,
                };
                toolCalls.push(block);
                yield { type: 'tool_use', data: block };
              }
            }

            if (chunk.done) {
              promptTokens = chunk.prompt_eval_count ?? 0;
              completionTokens = chunk.eval_count ?? 0;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      const content: ContentBlock[] = [];
      if (fullText) content.push({ type: 'text', text: fullText });
      content.push(...toolCalls);

      yield {
        type: 'done',
        data: {
          id: `ollama-${Date.now()}`,
          content,
          model: options.model,
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
          usage: { inputTokens: promptTokens, outputTokens: completionTokens },
        } satisfies ChatResponse,
      };
    } catch (err) {
      yield { type: 'error', data: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  private toOllamaMessages(messages: ChatMessage[], systemPrompt?: string): OllamaMessage[] {
    const result: OllamaMessage[] = [];
    if (systemPrompt) result.push({ role: 'system', content: systemPrompt });

    for (const msg of messages) {
      const blocks = normalizeContent(msg.content);
      if (msg.role === 'system') {
        result.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
        continue;
      }

      if (msg.role === 'assistant') {
        const textParts = blocks.filter(b => b.type === 'text').map(b => (b as TextBlock).text);
        const toolUseBlocks = blocks.filter(b => b.type === 'tool_use') as ToolUseBlock[];
        const ollamaMsg: OllamaMessage = { role: 'assistant', content: textParts.join('') };
        if (toolUseBlocks.length > 0) {
          ollamaMsg.tool_calls = toolUseBlocks.map(tc => ({
            function: { name: tc.name, arguments: tc.input },
          }));
        }
        result.push(ollamaMsg);
      } else {
        // User message
        const toolResults = blocks.filter(b => b.type === 'tool_result');
        const textParts = blocks.filter(b => b.type === 'text').map(b => (b as TextBlock).text);

        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            if (tr.type === 'tool_result') {
              result.push({ role: 'tool', content: tr.content });
            }
          }
        }
        if (textParts.length > 0) {
          result.push({ role: 'user', content: textParts.join('') });
        }
      }
    }
    return result;
  }

  private toOllamaTool(tool: ToolSchema): OllamaToolDef {
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    };
  }

  private fromOllamaResponse(data: OllamaChatResponse, model: string): ChatResponse {
    const content: ContentBlock[] = [];

    if (data.message.content) {
      content.push({ type: 'text', text: data.message.content });
    }

    if (data.message.tool_calls) {
      for (const tc of data.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    return {
      id: `ollama-${Date.now()}`,
      content,
      model,
      stopReason: data.message.tool_calls?.length ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
    };
  }
}
