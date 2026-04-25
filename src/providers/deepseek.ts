/**
 * @fileoverview DeepSeek provider — OpenAI-uyumlu, thinking mode destekli.
 * DeepSeek V4 API: https://api.deepseek.com
 * Modeller: deepseek-v4-flash, deepseek-v4-pro
 */

import OpenAI from 'openai';

// ─── Reasoning Box Renderer ────────────────────────────────────────────────────

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const result: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { result.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      // Çok uzun kelimeyi satıra sığacak şekilde kes
      if (word.length > width) {
        if (line) { result.push(line); line = ''; }
        for (let i = 0; i < word.length; i += width) result.push(word.slice(i, i + width));
        continue;
      }
      if (line.length + word.length + (line ? 1 : 0) > width) {
        if (line) result.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

function formatReasoningBox(text: string, elapsedMs: number): string {
  // Sağ border yok — emoji geniş karakter sorununu ve padEnd hizasını önler
  const cols = process.stdout.columns || 80;
  const termWidth = Math.min(cols, 80);
  const innerWidth = termWidth - 4; // "  │ " = 4 karakter
  const lines = wrapText(text.trim(), innerWidth);
  const dur = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';

  // Üst kenarlık — emoji 2 sütun geniş: string uzunluğuna +1 ekle
  const topPrefix = '╭─ 💭 Düşünüyor ';
  const topDashes = Math.max(2, termWidth - 2 - topPrefix.length - 1);
  const top = `  ${dim}${topPrefix}${'─'.repeat(topDashes)}${reset}`;

  // Satırlar — sadece sol kenarlık
  const rows = lines.map(l => `  ${dim}│${reset} ${l}`);

  // Alt kenarlık — süre sağda
  const botSuffix = ` ${dur}`;
  const botDashes = Math.max(2, termWidth - 2 - 1 - botSuffix.length);
  const bottom = `  ${dim}╰${'─'.repeat(botDashes)}${botSuffix}${reset}`;

  return '\n' + [top, ...rows, bottom].join('\n') + '\n\n';
}

// ──────────────────────────────────────────────────────────────────────────────

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamEvent,
  ContentBlock,
  ToolUseBlock,
  TextBlock,
  ToolSchema,
  ReasoningBlock,
} from '../types.js';
import { ProviderError } from '../core/errors.js';
import { normalizeContent } from '../core/message.js';

export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek' as const;
  readonly supportsTools = true;
  readonly supportsStreaming = true;
  readonly supportsVision = false;

  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);
    const thinkingEnabled = options.thinkingEnabled ?? true;
    const reasoningEffort = options.reasoningEffort ?? 'high';

    // Thinking açıkken temperature desteklenmiyor
    const extraBody: Record<string, unknown> = thinkingEnabled
      ? { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort }
      : { thinking: { type: 'disabled' } };

    try {
      const params = {
        model: options.model,
        messages: openaiMessages,
        max_tokens: options.maxTokens,
        ...(thinkingEnabled ? {} : { temperature: options.temperature }),
        tools: options.tools ? options.tools.map(t => this.toOpenAITool(t)) : undefined,
        stream: false as const,
        ...extraBody,
      };

      const completion = await this.client.chat.completions.create(
        params as Parameters<typeof this.client.chat.completions.create>[0],
        { signal: options.abortSignal },
      );

      return this.fromCompletion(completion as OpenAI.Chat.ChatCompletion);
    } catch (err) {
      throw new ProviderError(err instanceof Error ? err.message : String(err), 'deepseek');
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<StreamEvent> {
    const openaiMessages = this.toOpenAIMessages(messages, options.systemPrompt);
    const thinkingEnabled = options.thinkingEnabled ?? true;
    const reasoningEffort = options.reasoningEffort ?? 'high';

    const extraBody: Record<string, unknown> = thinkingEnabled
      ? { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort }
      : { thinking: { type: 'disabled' } };

    try {
      const params = {
        model: options.model,
        messages: openaiMessages,
        max_tokens: options.maxTokens,
        ...(thinkingEnabled ? {} : { temperature: options.temperature }),
        tools: options.tools ? options.tools.map(t => this.toOpenAITool(t)) : undefined,
        stream: true as const,
        stream_options: { include_usage: true },
        ...extraBody,
      };

      const stream = await this.client.chat.completions.create(
        params as Parameters<typeof this.client.chat.completions.create>[0],
        { signal: options.abortSignal },
      );

      let fullText = '';
      let reasoningText = '';
      let reasoningStartTime = 0;
      let completionId = '';
      let completionModel = '';
      let finishReason = 'stop';
      let inputTokens = 0;
      let outputTokens = 0;
      const toolBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk & { choices: Array<{ delta: { reasoning_content?: string } }> }>) {
        completionId = chunk.id;
        completionModel = chunk.model;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }

        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as OpenAI.Chat.ChatCompletionChunk['choices'][0]['delta'] & { reasoning_content?: string };

        // reasoning_content — buffer'a al, canlı gösterme (kutu olarak sonra gösterilecek)
        if (delta.reasoning_content) {
          if (!reasoningText) reasoningStartTime = Date.now();
          reasoningText += delta.reasoning_content;
        }

        if (delta.content) {
          if (reasoningText && fullText === '') {
            // Reasoning bitti — çerçeveli kutu olarak göster
            yield { type: 'text', data: formatReasoningBox(reasoningText, Date.now() - reasoningStartTime) };
          }
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

      // Reasoning var ama content hiç gelmedi (örn. sadece tool call) — kutuyu şimdi göster
      if (reasoningText && fullText === '' && toolBlocks.length > 0) {
        yield { type: 'text', data: formatReasoningBox(reasoningText, Date.now() - reasoningStartTime) };
      }

      const content: ContentBlock[] = [];
      // reasoning_content — tool call içeren turlardan sonra API'ye geri gönderilmesi zorunlu
      if (reasoningText) content.push({ type: 'reasoning', reasoning: reasoningText });
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
        let reasoningContent: string | undefined;
        for (const b of blocks) {
          if (b.type === 'text') textParts.push(b.text);
          else if (b.type === 'reasoning') reasoningContent = b.reasoning;
          else if (b.type === 'tool_use') {
            toolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } });
          }
        }
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam & { reasoning_content?: string } = {
          role: 'assistant',
          // tool_calls veya reasoning_content varken content null olamaz (API 400 verir)
          content: textParts.join('') || (toolCalls.length > 0 || !!reasoningContent ? '' : null),
        };
        // Tool call içeren turlardan sonra reasoning_content zorunlu olarak geri gönderilmeli
        if (reasoningContent) assistantMsg.reasoning_content = reasoningContent;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg as OpenAI.Chat.ChatCompletionAssistantMessageParam);
      } else {
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
    if (!choice) throw new ProviderError('No choices in response', 'deepseek');
    const content: ContentBlock[] = [];
    const msg = choice.message as OpenAI.Chat.ChatCompletionMessage & { reasoning_content?: string };
    if (msg.reasoning_content) content.push({ type: 'reasoning', reasoning: msg.reasoning_content });
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const tc of msg.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* empty */ }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    return {
      id: completion.id,
      content,
      model: completion.model,
      stopReason: this.normalizeFinishReason(choice.finish_reason ?? 'stop'),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
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
