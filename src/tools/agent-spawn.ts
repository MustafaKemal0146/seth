/**
 * @fileoverview Alt-ajan aracı — karmaşık görevleri bağımsız alt-ajanlara delege et.
 *
 * main-code AgentTool mantığına benzer:
 * - Yeni bir runAgentLoop çağrısı başlatır (recursive)
 * - Kendi araç seti, bağlamı ve bütçesi var
 * - Sonucu üst ajana döner
 * - Maksimum derinlik: 4
 */

import type { ToolDefinition, ToolResult, SETHConfig, ProviderName, LLMProvider } from '../types.js';
import { runAgentLoop } from '../agent/loop.js';
import { createDefaultRegistry } from './registry.js';
import { ToolExecutor } from './executor.js';
import { loadConfig } from '../config/settings.js';
import { createProvider } from '../providers/base.js';
import { buildSystemPrompt } from '../project-instructions.js';

// Derinlik takibi — circular spawn'ı önle
let currentAgentDepth = 0;
const MAX_AGENT_DEPTH = 4;

export function getAgentSpawnDepth(): number {
  return currentAgentDepth;
}

export function setAgentSpawnDepth(d: number): void {
  currentAgentDepth = d;
}

// Üst ajandan aktarılan provider — aynı provider'ı kullan
let sharedProvider: LLMProvider | null = null;
let sharedModel: string | null = null;
let sharedCwd: string = process.cwd();

export function setSharedAgentContext(
  provider: LLMProvider,
  model: string,
  cwd: string,
): void {
  sharedProvider = provider;
  sharedModel = model;
  sharedCwd = cwd;
}

export const agentSpawnTool: ToolDefinition = {
  name: 'agent_spawn',
  description:
    'Bağımsız bir alt-ajan oluşturur; karmaşık veya paralel görevleri delege etmek için kullan. ' +
    'Alt-ajan kendi araç setine sahiptir, görevi tamamlayınca sonucu döner. ' +
    'Büyük projelerde dosya yazma, araştırma, test çalıştırma gibi bağımsız adımlar için ideal. ' +
    'Alt-ajan maksimum derinliği ' + MAX_AGENT_DEPTH + '\'tur.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Alt-ajanın yapması gereken görev — mümkün olduğunca net ve kapsamlı yaz.',
      },
      context: {
        type: 'string',
        description: 'Alt-ajana aktarılacak ek bağlam (dosya içerikleri, gereksinimler vb.).',
      },
      max_turns: {
        type: 'number',
        description: 'Alt-ajanın maksimum tur sayısı. Varsayılan: 15.',
      },
      allow_tools: {
        type: 'boolean',
        description: 'Alt-ajan araç kullanabilsin mi? Varsayılan: true.',
      },
    },
    required: ['task'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const task = String(input.task ?? '');
    const context = input.context ? `\n\nBağlam:\n${String(input.context)}` : '';
    const maxTurns = Number(input.max_turns ?? 15);
    const allowTools = input.allow_tools !== false;

    if (!task.trim()) {
      return { output: 'Hata: task parametresi boş olamaz.', isError: true };
    }

    if (currentAgentDepth >= MAX_AGENT_DEPTH) {
      return {
        output: `Hata: Maksimum ajan derinliğine ulaşıldı (${MAX_AGENT_DEPTH}). Daha fazla alt-ajan oluşturulamaz.`,
        isError: true,
      };
    }

    // Derinliği artır
    currentAgentDepth++;
    process.stderr.write(`[seth] Alt-ajan başlatıldı (derinlik ${currentAgentDepth}): ${task.slice(0, 80)}\n`);

    try {
      // Aynı provider'ı kullan veya yenisini oluştur
      let provider = sharedProvider;
      let model = sharedModel ?? 'claude-3-5-sonnet-20241022';

      if (!provider) {
        const config = loadConfig();
        model = config.defaultModel;
        provider = await createProvider(config.defaultProvider as ProviderName, config);
      }

      const toolRegistry = allowTools ? await createDefaultRegistry() : await import('./registry.js').then(m => new m.ToolRegistry());
      const config = loadConfig();
      const toolExecutor = new ToolExecutor(toolRegistry, config.tools, async () => true); // Alt-ajan auto-approve

      const systemPrompt =
        buildSystemPrompt(cwd ?? sharedCwd) +
        `\n\n---\nSen bir alt-ajansın (derinlik ${currentAgentDepth}/${MAX_AGENT_DEPTH}). ` +
        `Üst ajan sana şu görevi verdi. Görevi tamamla, öz ve net bir sonuç döndür.\n---`;

      const userMessage = task + context;

      const result = await runAgentLoop(userMessage, [], {
        provider,
        model,
        systemPrompt,
        toolRegistry,
        toolExecutor,
        maxTurns,
        maxTokens: 500_000, // Alt-ajana sabit bütçe
        cwd: cwd ?? sharedCwd,
        debug: false,
        onText: (text) => {
          // Alt-ajan çıktısını stderr'e yaz (debug)
          if (process.env.SETH_DEBUG_SUBAGENT) {
            process.stderr.write(`[alt-ajan-${currentAgentDepth}] ${text}`);
          }
        },
      });

      const output =
        `[Alt-Ajan Sonucu — Derinlik ${currentAgentDepth}]\n` +
        `Görev: ${task.slice(0, 200)}\n` +
        `Turlar: ${result.turns} · Araç çağrıları: ${result.toolCalls.length}\n\n` +
        result.finalText;

      const data = {
        task: task.slice(0, 200),
        turns: result.turns,
        toolCalls: result.toolCalls.length,
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
      };

      return { output, isError: false, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        output: `Alt-ajan hatası: ${msg}`,
        isError: true,
      };
    } finally {
      currentAgentDepth--;
    }
  },
};
