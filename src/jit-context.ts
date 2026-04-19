/**
 * @fileoverview JIT (Just-In-Time) Context — araç bir dizine eriştiğinde
 * o dizindeki SETH.md/GEMINI.md/CLAUDE.md dosyalarını otomatik yükler.
 * gemini-cli'nin jit-context.ts'inden ilham alınmıştır.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';

const JIT_FILES = ['SETH.md', 'GEMINI.md', 'CLAUDE.md', '.seth/instructions.md'];
const MAX_JIT_CHARS = 8000;

/**
 * Verilen dosya/dizin yolu için JIT context dosyalarını keşfet.
 * Sadece cwd'nin alt dizinlerinde çalışır.
 */
export function discoverJitContext(accessedPath: string, cwd: string): string {
  let dir: string;
  try {
    dir = statSync(accessedPath).isDirectory() ? accessedPath : dirname(accessedPath);
  } catch {
    dir = dirname(accessedPath);
  }

  // Sadece cwd'nin alt dizinleri için çalış, kök için değil
  if (!dir.startsWith(cwd) || dir === cwd) return '';

  const parts: string[] = [];
  for (const filename of JIT_FILES) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content) {
          parts.push(`\n[JIT: ${filePath.replace(cwd + '/', '')}]\n${content}`);
        }
      } catch { /* ignore */ }
    }
  }

  if (parts.length === 0) return '';
  const combined = parts.join('\n');
  return combined.length > MAX_JIT_CHARS
    ? combined.slice(0, MAX_JIT_CHARS) + '\n[... kırpıldı]'
    : combined;
}
