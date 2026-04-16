/**
 * @fileoverview Agent loop — the core plan→execute→respond cycle.
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, ToolUseBlock, ContentBlock, TokenUsage, ToolCallRecord, TurnResult, AgentBudget } from '../types.js';
import { ToolExecutor } from '../tools/executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { BudgetExceededError } from '../core/errors.js';
import { ThinkingFilter } from '../thinking-filter.js';

export interface AgentLoopOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  toolRegistry: ToolRegistry;
  toolExecutor: ToolExecutor;
  maxTurns: number;
  maxTokens: number;
  cwd: string;
  debug: boolean;
  onText?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, output: string, isError: boolean, data?: import('../types.js').FileToolData | import('../types.js').AgentToolData) => void;
  onTurnComplete?: (turn: number, total: number) => void;
  /** Tur başında (LLM çağrısından hemen önce). */
  onTurnStart?: (turn: number, maxTurns: number) => void;
  /** Tur sonunda (araç sonuçları eklendikten sonra, bir sonraki tura dönmeden önce). */
  onTurnEnd?: (turn: number, maxTurns: number) => void;
  abortSignal?: AbortSignal;
  /** Birincil sağlayıcı başarısız olursa kullanılacak yedek sağlayıcı */
  fallbackProvider?: LLMProvider;
  fallbackModel?: string;
}

export interface AgentResult {
  readonly messages: ChatMessage[];
  readonly totalUsage: TokenUsage;
  readonly toolCalls: ToolCallRecord[];
  readonly turns: number;
  readonly finalText: string;
}

export async function runAgentLoop(
  userMessage: string,
  history: ChatMessage[],
  options: AgentLoopOptions,
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const budget: AgentBudget = {
    maxTurns: options.maxTurns,
    maxTokens: options.maxTokens,
    turnsUsed: 0,
    tokensUsed: 0,
  };

  const allToolCalls: ToolCallRecord[] = [];
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let finalText = '';

  const toolSchemas = options.toolRegistry.toSchemas();
  const useTools = toolSchemas.length > 0 && options.provider.supportsTools;

  while (budget.turnsUsed < budget.maxTurns) {
    budget.turnsUsed++;

    if (options.onTurnStart) options.onTurnStart(budget.turnsUsed, budget.maxTurns);

    const chatOptions: ChatOptions = {
      model: options.model,
      systemPrompt: options.systemPrompt,
      tools: useTools ? toolSchemas : undefined,
      maxTokens: 8192,
      abortSignal: options.abortSignal,
    };

    // Call LLM
    let response: ChatResponse;

    try {
      if (options.provider.supportsStreaming) {
        // Streaming path — pipe text through ThinkingFilter
        let streamResponse: ChatResponse | null = null;

        // Create a fresh filter per turn so state doesn't bleed across turns
        const filter = new ThinkingFilter((chunk: string) => {
          if (options.onText) options.onText(chunk);
        });

        for await (const event of options.provider.stream(messages, chatOptions)) {
          if (event.type === 'text') {
            filter.feed(event.data as string);
          }
          if (event.type === 'done') {
            streamResponse = event.data as ChatResponse;
          }
          if (event.type === 'error') {
            throw event.data;
          }
        }
        filter.end();
        if (!streamResponse) throw new Error('Stream ended without response');
        response = streamResponse;
      } else {
        // Non-streaming path — still pipe through ThinkingFilter to suppress thinking blocks
        response = await options.provider.chat(messages, chatOptions);
        const textContent = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as { text: string }).text)
          .join('');
        if (textContent) {
          const filter = new ThinkingFilter((chunk: string) => {
            if (options.onText) options.onText(chunk);
          });
          filter.feed(textContent);
          filter.end();
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        return {
          messages,
          totalUsage,
          toolCalls: allToolCalls,
          turns: budget.turnsUsed,
          finalText: finalText || '[İşlem kullanıcı tarafından durduruldu]',
        };
      }
      // Fallback sağlayıcı varsa geç
      if (options.fallbackProvider && options.provider !== options.fallbackProvider) {
        if (options.onText) options.onText(`\n⚡ Birincil sağlayıcı başarısız, yedek sağlayıcıya geçiliyor...\n`);
        options.provider = options.fallbackProvider;
        if (options.fallbackModel) options.model = options.fallbackModel;
        continue;
      }
      throw err;
    }

    // Update usage
    totalUsage = {
      inputTokens: totalUsage.inputTokens + response.usage.inputTokens,
      outputTokens: totalUsage.outputTokens + response.usage.outputTokens,
    };
    budget.tokensUsed = totalUsage.inputTokens + totalUsage.outputTokens;

    // Check budget
    if (budget.tokensUsed >= budget.maxTokens) {
      throw new BudgetExceededError(`Token budget exceeded: ${budget.tokensUsed}/${budget.maxTokens}`);
    }

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content });

    // Check for tool use
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as ToolUseBlock[];

    if (toolUseBlocks.length === 0) {
      // No tool calls — conversation turn complete
      finalText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('');

      // Remove any <thinking>...</thinking> blocks from the final rendered text
      finalText = finalText.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

      if (options.onTurnEnd) options.onTurnEnd(budget.turnsUsed, budget.maxTurns);
      if (options.onTurnComplete) options.onTurnComplete(budget.turnsUsed, budget.maxTurns);
      break;
    }

    // Execute tools
    const toolResults: ContentBlock[] = [];
    for (const toolBlock of toolUseBlocks) {
      if (options.onToolCall) options.onToolCall(toolBlock.name, toolBlock.input);

      if (toolBlock.name === 'sethEngine') {
        const saat = new Date().toLocaleTimeString('tr-TR');
        const hedef = String(toolBlock.input?.target || 'BILINMEYEN_HEDEF');
        const vektor = String(toolBlock.input?.action || 'BILINMEYEN_VEKTOR');
        
        // Log to console in specific format
        console.log(`\n\x1b[31m[!] SETH: [${saat}] - [${hedef}] - [OTONOM ANALIZ DEVAM EDIYOR] - [${vektor.toUpperCase()} BAŞLATILDI]\x1b[0m\n`);
      }

      if (options.debug) {
        process.stderr.write(`[debug] Tool call: ${toolBlock.name}(${JSON.stringify(toolBlock.input).slice(0, 200)})\n`);
      }

      const { result, record } = await options.toolExecutor.execute(
        toolBlock.name,
        toolBlock.input,
        options.cwd,
      );

      allToolCalls.push(record);

      if (options.onToolResult) options.onToolResult(toolBlock.name, result.output, result.isError ?? false, result.data);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result.output,
        is_error: result.isError,
      });
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults });

    if (options.onTurnEnd) options.onTurnEnd(budget.turnsUsed, budget.maxTurns);
    if (options.onTurnComplete) options.onTurnComplete(budget.turnsUsed, budget.maxTurns);
  }

  if (budget.turnsUsed >= budget.maxTurns && !finalText) {
    finalText = '[Ajan maksimum tur sınırına ulaştı]';
  }

  return {
    messages,
    totalUsage,
    toolCalls: allToolCalls,
    turns: budget.turnsUsed,
    finalText,
  };
}
