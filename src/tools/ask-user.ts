/**
 * @fileoverview ask_user tool — lets the model ask the user a question mid-session.
 * Adapted from main-code/src/tools/AskUserQuestionTool (claude-code source).
 *
 * The model calls this tool whenever it needs to:
 *   • Disambiguate vague instructions
 *   • Confirm a destructive action
 *   • Choose between multiple implementation strategies
 *
 * The tool suspends the agent loop, renders a numbered menu, reads a single
 * raw keypress (or "other" text), then returns the chosen answer to the model.
 */

import * as readline from 'readline';
import chalk from 'chalk';
import type { ToolDefinition, ToolResult } from '../types.js';

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    'Kullanıcıya soru sorar ve yanıtını bekler. ' +
    'Belirsiz talimatları netleştirmek, yıkıcı işlem öncesi onay almak veya ' +
    'birden fazla yaklaşım arasında seçim yaptırmak için kullan. ' +
    'Seçenekleri kısa ve net ver. Rutin onaylar için kullanma; yalnızca gerçekten gerekli kararlarda.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Kullanıcıya gösterilecek soru; kısa ve net olsun.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description:
          'İsteğe bağlı cevap seçenekleri listesi. Boşsa kullanıcı serbest metin yazar. ' +
          'Doluysa numaralı menü gösterilir; otomatik olarak "Diğer…" eklenir.',
      },
    },
    required: ['question'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const question = String(input.question ?? '').trim();
    const rawOptions = Array.isArray(input.options) ? (input.options as string[]) : [];

    if (!question) {
      return { output: 'Hata: Soru boş olamaz.', isError: true };
    }

    // ─── Render the question ────────────────────────────────────────────
    process.stdout.write('\n');
    process.stdout.write(chalk.bold.cyan('  ❓ ') + chalk.bold(question) + '\n');

    const hasOptions = rawOptions.length > 0;
    const choices = hasOptions ? [...rawOptions, 'Diğer…'] : [];

    if (hasOptions) {
      choices.forEach((opt, idx) => {
        process.stdout.write(
          chalk.dim(`     ${idx + 1}. `) + opt + '\n',
        );
      });
      process.stdout.write(chalk.dim('\n     Seçin (numara) veya bir şey yazın: '));
    } else {
      process.stdout.write(chalk.dim('     Cevabınız: '));
    }

    // ─── Read answer ────────────────────────────────────────────────────
    const answer = await readLine();
    process.stdout.write('\n');

    let result: string;

    if (hasOptions) {
      const num = parseInt(answer.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= choices.length) {
        const chosen = choices[num - 1]!;
        if (chosen === 'Diğer…') {
          process.stdout.write(chalk.dim('     Cevabınızı yazın: '));
          const custom = await readLine();
          result = custom.trim() || '(boş)';
        } else {
          result = chosen;
        }
      } else {
        // Treat raw text as the answer
        result = answer.trim() || '(boş)';
      }
    } else {
      result = answer.trim() || '(boş)';
    }

    process.stdout.write(
      chalk.green('  ✓ ') + chalk.dim('Cevap alındı: ') + chalk.white(result) + '\n\n',
    );

    return { output: result, isError: false };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a full line from stdin using a temporary readline interface.
 * We canNOT reuse the REPL's readline here because it's paused during
 * tool execution — so we open a fresh non-terminal interface.
 */
function readLine(): Promise<string> {
  return new Promise<string>(resolve => {
    // We need to temporarily set stdin back to cooked mode for readline
    const wasRaw = (process.stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw;
    if (process.stdin.isTTY && wasRaw) {
      process.stdin.setRawMode(false);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.once('line', line => {
      rl.close();
      // Restore raw mode if it was set before
      if (process.stdin.isTTY && wasRaw) {
        process.stdin.setRawMode(true);
      }
      resolve(line);
    });

    rl.once('close', () => resolve(''));
  });
}
