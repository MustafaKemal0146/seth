/**
 * Ctrl+R — Geçmiş fuzzy arama
 * ~/.seth/history.jsonl üzerinde interaktif arama
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { loadHistory } from './storage/history.js';

export async function runHistorySearch(): Promise<string | null> {
  const history = loadHistory();
  if (history.length === 0) return null;

  return new Promise((resolve) => {
    let query = '';
    let selectedIdx = 0;
    let filtered = history.slice(0, 10);

    const render = () => {
      // Ekranı temizle ve arama UI'ını çiz
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(chalk.cyan('  🔍 Geçmiş Arama') + chalk.dim(' (Esc: iptal, Enter: seç, ↑↓: gezin)\n'));
      process.stdout.write(chalk.dim('  ─'.repeat(40)) + '\n');
      process.stdout.write(`  ${chalk.yellow('>')} ${query}█\n`);
      process.stdout.write(chalk.dim('  ─'.repeat(40)) + '\n');

      filtered.forEach((item, i) => {
        const display = item.length > 70 ? item.slice(0, 67) + '…' : item;
        if (i === selectedIdx) {
          process.stdout.write(`  ${chalk.bgBlue.white(` ${display.padEnd(70)} `)}\n`);
        } else {
          process.stdout.write(`  ${chalk.dim(display)}\n`);
        }
      });
    };

    const filter = () => {
      if (!query) {
        filtered = history.slice(0, 10);
      } else {
        const q = query.toLowerCase();
        filtered = history.filter(h => h.toLowerCase().includes(q)).slice(0, 10);
      }
      selectedIdx = 0;
    };

    // Raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    render();

    const onData = (key: string) => {
      if (key === '\x1b' || key === '\x03') {
        // Esc veya Ctrl+C
        cleanup();
        resolve(null);
      } else if (key === '\r' || key === '\n') {
        // Enter
        const selected = filtered[selectedIdx] ?? null;
        cleanup();
        resolve(selected);
      } else if (key === '\x1b[A') {
        // Yukarı ok
        selectedIdx = Math.max(0, selectedIdx - 1);
        render();
      } else if (key === '\x1b[B') {
        // Aşağı ok
        selectedIdx = Math.min(filtered.length - 1, selectedIdx + 1);
        render();
      } else if (key === '\x7f' || key === '\b') {
        // Backspace
        query = query.slice(0, -1);
        filter();
        render();
      } else if (key.length === 1 && key >= ' ') {
        query += key;
        filter();
        render();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\x1b[2J\x1b[H');
    };

    process.stdin.on('data', onData);
  });
}
