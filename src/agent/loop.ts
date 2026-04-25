/**
 * @fileoverview Agent loop — the core plan→execute→respond cycle.
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, ToolUseBlock, ContentBlock, TokenUsage, ToolCallRecord, TurnResult, AgentBudget } from '../types.js';
import { ToolExecutor } from '../tools/executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { BudgetExceededError } from '../core/errors.js';
import { ThinkingFilter } from '../thinking-filter.js';
import { webUIController } from '../web/controller.js';
import { isPlanWaitingApproval, getPlanModeState } from '../plan-mode-state.js';

// Helper to let the event loop breathe
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  /** Düşünme seviyesi: low/medium/high/max */
  effort?: string;
  /** DeepSeek thinking mode — sadece deepseek provider'da etki eder */
  thinkingEnabled?: boolean;
  /** DeepSeek reasoning effort (thinking açıkken) */
  reasoningEffort?: 'high' | 'max';
  /** Birincil sağlayıcı başarısız olursa kullanılacak yedek sağlayıcı */
  fallbackProvider?: LLMProvider;
  fallbackModel?: string;
  /** Paralel araç yürütme üst sınırı (varsayılan: 5) */
  maxConcurrentTools?: number;
  /** Araç çıktısı kırpıldığında çağrılır (kullanıcıya uyarı göster). */
  onTruncation?: (toolName: string) => void;
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
  // Mutable kopyalar — fallback geçişi için
  let activeProvider = options.provider;
  let activeModel = options.model;

  // #1 Loop detection
  const { loopDetector } = await import('../loop-detection.js');
  loopDetector.reset();
  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  // v3.9.0: Web UI'ya geçmişi gönder
  webUIController.sendHistory(messages);

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
  const useTools = toolSchemas.length > 0 && activeProvider.supportsTools;

  while (budget.turnsUsed < budget.maxTurns) {
    budget.turnsUsed++;

    if (options.onTurnStart) options.onTurnStart(budget.turnsUsed, budget.maxTurns);

    // Effort seviyesine göre maxTokens ayarla
    const effortMaxTokens: Record<string, number> = {
      low: 2048, medium: 8192, high: 16384, max: 32768,
    };
    const maxTokens = effortMaxTokens[options.effort ?? 'medium'] ?? 8192;

    const chatOptions: ChatOptions = {
      model: activeModel,
      systemPrompt: options.systemPrompt,
      tools: useTools ? toolSchemas : undefined,
      maxTokens,
      abortSignal: options.abortSignal,
      thinkingEnabled: options.thinkingEnabled,
      reasoningEffort: options.reasoningEffort,
    };

    // Call LLM
    let response: ChatResponse;

    try {
      if (activeProvider.supportsStreaming) {
        // Streaming path — pipe text through ThinkingFilter
        let streamResponse: ChatResponse | null = null;

        // Create a fresh filter per turn so state doesn't bleed across turns
        let accumulatedText = '';
        const filter = new ThinkingFilter((chunk: string) => {
          accumulatedText += chunk;
          if (options.onText) options.onText(chunk);
          // v3.9.0: Web UI'ya akışı gönder (tam birikim — frontend replace ediyor)
          webUIController.sendText(accumulatedText);
        });

        for await (const event of activeProvider.stream(messages, chatOptions)) {
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
        // Non-streaming path
        response = await activeProvider.chat(messages, chatOptions);
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
          // v3.9.0: Web UI'ya metni gönder
          webUIController.sendText(textContent);
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
      if (options.fallbackProvider && activeProvider !== options.fallbackProvider) {
        if (options.onText) options.onText(`\n⚡ Birincil sağlayıcı başarısız, yedek sağlayıcıya geçiliyor...\n`);
        activeProvider = options.fallbackProvider;
        if (options.fallbackModel) activeModel = options.fallbackModel;
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

    // v3.9.0: Web UI'ya istatistikleri gönder
    webUIController.sendStats({
      messages: messages.length,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      turns: budget.turnsUsed,
      provider: activeProvider.name,
      model: activeModel,
    } as any);

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

    // [v3.8.12.2] Execute tools in smaller chunks for better UI responsiveness
    const executed = [];
    const MAX_CONCURRENT = options.maxConcurrentTools ?? 5;

    for (let i = 0; i < toolUseBlocks.length; i += MAX_CONCURRENT) {
      const chunk = toolUseBlocks.slice(i, i + MAX_CONCURRENT);
      
      // v3.8.17: Paralel yürütme görselleştirmesi
      if (toolUseBlocks.length > 1) {
        const names = chunk.map(b => b.name).join(', ');
        if (options.onText) options.onText(`\n\x1b[90m⚙️  Paralel yürütülüyor (${i+1}-${Math.min(i+MAX_CONCURRENT, toolUseBlocks.length)}/${toolUseBlocks.length}): ${names}\x1b[0m\n`);
      }

      // Dinamik dinleyici ayarı
      const currentListeners = process.rawListeners('SIGINT').length;
      process.setMaxListeners(Math.max(50, currentListeners + chunk.length + 5));

      const chunkResults = await Promise.all(chunk.map(async (toolBlock) => {
        if (options.onToolCall) options.onToolCall(toolBlock.name, toolBlock.input);
        // v3.9.0: Web UI'ya araç çağrısını gönder
        webUIController.sendToolCall(toolBlock.name, toolBlock.input);

        // #1 Loop detection
        const loopResult = loopDetector.checkToolCall(toolBlock.name, toolBlock.input);
        if (loopResult.isLoop) {
          if (options.onText) options.onText(`\n⚠️ Döngü tespit edildi: ${loopResult.detail}\n`);
          return {
            toolBlock,
            result: { output: `[DÖNGÜ TESPİT EDİLDİ] ${loopResult.detail} — Araç çağrısı durduruldu.`, isError: true },
            record: { toolName: toolBlock.name, input: toolBlock.input, output: '', durationMs: 0, isError: true },
          };
        }

        if (toolBlock.name === 'sethEngine') {
          const saat = new Date().toLocaleTimeString('tr-TR');
          const hedef = String(toolBlock.input?.target || 'BILINMEYEN_HEDEF');
          const vektor = String(toolBlock.input?.action || 'BILINMEYEN_VEKTOR');
          console.log(`\n\x1b[31m[!] SETH: [${saat}] - [${hedef}] - [OTONOM ANALIZ DEVAM EDIYOR] - [${vektor.toUpperCase()} BAŞLATILDI]\x1b[0m\n`);
        }

        const { result, record } = await options.toolExecutor.execute(
          toolBlock.name,
          toolBlock.input,
          options.cwd,
        );

        if (options.onToolResult) options.onToolResult(toolBlock.name, result.output, result.isError ?? false, result.data);
        // v3.9.0: Web UI'ya araç sonucunu gönder
        webUIController.sendToolResult(toolBlock.name, result.output, result.isError ?? false);
        // v3.9.2: Kırpılmış çıktı uyarısı
        if (result.isTruncated && options.onTruncation) options.onTruncation(toolBlock.name);

        return { toolBlock, result, record };
      }));
      
      executed.push(...chunkResults);

      // Paketler arası minik bir nefes payı (50ms) - UI'ın güncellenmesi için
      if (i + MAX_CONCURRENT < toolUseBlocks.length) {
        await delay(50);
      }
    }

    const toolResults: ContentBlock[] = [];
    for (const item of executed) {
      allToolCalls.push(item.record);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: item.toolBlock.id,
        content: item.result.output,
        is_error: item.result.isError,
      });
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults });

    if (options.onTurnEnd) options.onTurnEnd(budget.turnsUsed, budget.maxTurns);
    if (options.onTurnComplete) options.onTurnComplete(budget.turnsUsed, budget.maxTurns);

    // Plan approval checkpoint — exit loop so REPL can ask user
    if (isPlanWaitingApproval()) {
      finalText = getPlanModeState().planText;
      break;
    }
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
