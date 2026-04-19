/**
 * @fileoverview Asciinema v2 formatında konuşma export.
 * https://docs.asciinema.org/manual/asciicast/v2/
 */

import type { ChatMessage } from './types.js';

export function exportAsAsciicast(messages: ChatMessage[], provider: string, model: string): string {
  const width = process.stdout.columns ?? 220;
  const height = process.stdout.rows ?? 50;
  const startTime = Date.now() / 1000;

  const header = JSON.stringify({
    version: 2,
    width,
    height,
    timestamp: Math.floor(startTime),
    title: `SETH — ${provider}/${model}`,
    env: { TERM: 'xterm-256color', SHELL: '/bin/bash' },
  });

  const events: string[] = [header];
  let t = 0;

  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const prefix = msg.role === 'user' ? '\r\n\x1b[36m> \x1b[0m' : '\r\n\x1b[32m';
    const suffix = msg.role === 'assistant' ? '\x1b[0m' : '';
    const output = prefix + text.replace(/\n/g, '\r\n') + suffix + '\r\n';

    events.push(JSON.stringify([t, 'o', output]));
    t += 0.5;
  }

  return events.join('\n');
}
