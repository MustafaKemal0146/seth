/**
 * @fileoverview Headless (non-interactive) mode for SETH.
 * Usage: seth -p "your question"
 */

import chalk from 'chalk';
import type { SETHConfig, ProviderName } from './types.js';
import { createProvider } from './providers/base.js';
import { createDefaultRegistry, ToolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { runAgentLoop } from './agent/loop.js';
import { loadConfig, resolveModel, getEffectiveContextBudgetTokens } from './config/settings.js';
import { buildSystemPrompt } from './project-instructions.js';
import { setAgentSessionContext } from './session-runtime.js';
import { randomUUID } from 'crypto';

export async function runHeadless(
  prompt: string,
  options: {
    provider?: ProviderName;
    model?: string;
    noTools?: boolean;
    debug?: boolean;
    autoApprove?: boolean;
  } = {},
): Promise<void> {
  // Headless mod başlatılıyor
  const config = loadConfig({
    debug: options.debug ?? false,
  });

  const providerName = options.provider ?? config.defaultProvider;
  const model = options.model ?? resolveModel(providerName, config);

  const provider = await createProvider(providerName, config);
  const toolRegistry = options.noTools ? new ToolRegistry() : await createDefaultRegistry();
  const isAutoApprove = options.autoApprove ?? config.autoApprove ?? false;
  const confirmFn = isAutoApprove ? async () => true : undefined;
  const toolExecutor = new ToolExecutor(toolRegistry, config.tools, confirmFn);

  setAgentSessionContext(`headless-${randomUUID()}`);

  const systemPrompt = buildSystemPrompt(process.cwd());

  try {
    const result = await runAgentLoop(prompt, [], {
      provider,
      model,
      systemPrompt,
      toolRegistry,
      toolExecutor,
      maxTurns: config.agent.maxTurns,
      maxTokens: getEffectiveContextBudgetTokens(config),
      cwd: process.cwd(),
      debug: config.debug,
      onTurnStart: config.debug
        ? (turn, max) => {
            process.stderr.write(`[seth] tur ${turn}/${max}\n`);
          }
        : undefined,
      onTurnEnd: config.debug
        ? (turn, max) => {
            process.stderr.write(`[seth] tur bitti ${turn}/${max}\n`);
          }
        : undefined,
      onText: (text: string) => process.stdout.write(text),
      onToolCall: (name: string, input: Record<string, unknown>) => {
        process.stderr.write(chalk.dim(`\n  ⚙ ${name}(${JSON.stringify(input).slice(0, 100)})\n`));
      },
      onToolResult: (name: string, output: string, isError: boolean) => {
        if (isError) process.stderr.write(chalk.red(`  ✗ ${name}: ${output.slice(0, 200)}\n`));
        else if (config.debug) process.stderr.write(chalk.dim(`  ✓ ${name}: ${output.slice(0, 100)}\n`));
      },
    });

    if (result.finalText && !result.finalText.endsWith('\n')) process.stdout.write('\n');
  } catch (err) {
    console.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
