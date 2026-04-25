/**
 * @fileoverview Google Gemini provider adapter.
 */

import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclaration } from '@google/generative-ai';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, StreamEvent, ContentBlock, ToolSchema, ToolUseBlock } from '../types.js';
import { ProviderError } from '../core/errors.js';
import { normalizeContent } from '../core/message.js';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  readonly supportsTools = true;
  readonly supportsStreaming = true;
  readonly supportsVision = true;

  private readonly genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const model = this.genAI.getGenerativeModel({
      model: options.model,
      tools: options.tools ? [{ functionDeclarations: options.tools.map(t => this.toGeminiFunction(t)) }] : undefined,
    });

    const { history, lastUserContent, systemInstruction } = this.prepareMessages(messages, options);
    const chat = model.startChat({ history, systemInstruction });

    try {
      const result = await chat.sendMessage(lastUserContent);
      const response = result.response;
      const content = this.extractContent(response);
      const usage = response.usageMetadata;

      return {
        id: `gemini-${Date.now()}`,
        content,
        model: options.model,
        stopReason: this.normalizeFinishReason(response.candidates?.[0]?.finishReason),
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      throw new ProviderError(err instanceof Error ? err.message : String(err), 'gemini');
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<StreamEvent> {
    const model = this.genAI.getGenerativeModel({
      model: options.model,
      tools: options.tools ? [{ functionDeclarations: options.tools.map(t => this.toGeminiFunction(t)) }] : undefined,
    });

    const { history, lastUserContent, systemInstruction } = this.prepareMessages(messages, options);
    const chat = model.startChat({ history, systemInstruction });

    try {
      const result = await chat.sendMessageStream(lastUserContent);
      let fullText = '';
      const toolCalls: ToolUseBlock[] = [];

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullText += text;
          yield { type: 'text', data: text };
        }

        // Check for function calls
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.functionCall) {
            const toolBlock: ToolUseBlock = {
              type: 'tool_use',
              id: `${part.functionCall.name}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: part.functionCall.name,
              input: (part.functionCall.args as Record<string, unknown>) ?? {},
            };
            toolCalls.push(toolBlock);
            yield { type: 'tool_use', data: toolBlock };
          }
        }
      }

      const finalResponse = await result.response;
      const usage = finalResponse.usageMetadata;
      const content: ContentBlock[] = [];
      if (fullText) content.push({ type: 'text', text: fullText });
      content.push(...toolCalls);

      yield {
        type: 'done',
        data: {
          id: `gemini-${Date.now()}`,
          content,
          model: options.model,
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
          usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 },
        } satisfies ChatResponse,
      };
    } catch (err) {
      yield { type: 'error', data: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  private prepareMessages(messages: ChatMessage[], options: ChatOptions) {
    let systemInstruction: string | undefined = options.systemPrompt;
    const history: Content[] = [];
    let lastUserContent: string | Part[] = '';

    const filtered = messages.filter(m => {
      if (m.role === 'system') {
        systemInstruction = typeof m.content === 'string' ? m.content : '';
        return false;
      }
      return true;
    });

    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];
      const blocks = normalizeContent(msg.content);
      const parts: Part[] = [];

      for (const b of blocks) {
        if (b.type === 'text') parts.push({ text: b.text });
        else if (b.type === 'tool_use') {
          parts.push({ functionCall: { name: b.name, args: b.input } });
        } else if (b.type === 'tool_result') {
          // ID formatı: "funcName__timestamp_random" — adı geri çıkar
          const funcName = b.tool_use_id.split('__')[0] ?? 'unknown';
          parts.push({
            functionResponse: {
              name: funcName,
              response: { content: b.content },
            },
          });
        }
      }

      if (i === filtered.length - 1 && msg.role === 'user') {
        lastUserContent = parts;
      } else {
        history.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        });
      }
    }

    return { history, lastUserContent, systemInstruction };
  }

  private extractContent(response: { candidates?: Array<{ content?: { parts?: Part[] } }> }): ContentBlock[] {
    const content: ContentBlock[] = [];
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) content.push({ type: 'text', text: part.text });
      if (part.functionCall) {
        content.push({
          type: 'tool_use',
          // Function adını ID'ye göm — functionResponse.name için geri çıkarılacak
          id: `${part.functionCall.name}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          input: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }
    return content;
  }

  private normalizeFinishReason(reason?: string): string {
    switch (reason) {
      case 'STOP': return 'end_turn';
      case 'MAX_TOKENS': return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
      default: return 'end_turn';
    }
  }

  private toGeminiFunction(tool: ToolSchema): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as FunctionDeclaration['parameters'],
    };
  }
}
