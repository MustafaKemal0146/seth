/**
 * Graceful shutdown — SIGTERM/SIGINT gelince önce kaydet, sonra çık.
 * Cleanup registry ile kayıt.
 */

type CleanupFn = () => void | Promise<void>;
import { closeBrowser } from './tools/browser-automation.js';
const cleanupFns: CleanupFn[] = [];
let registered = false;

export function registerCleanup(fn: CleanupFn): void {
  cleanupFns.push(fn);
}

export function setupGracefulShutdown(): void {
  if (registered) return;
  registered = true;

  const shutdown = async (signal: string) => {
    process.stdout.write(`\n`);
    for (const fn of cleanupFns) {
      try { await fn(); } catch { /* sessizce geç */ }
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // SIGINT (Ctrl+C) zaten repl.ts'de yönetiliyor, burada sadece SIGTERM
}

/**
 * Arka plan temizlik — başlangıçta çalışır, 30 günden eski oturum dosyalarını siler.
 */
export async function startBackgroundCleanup(sessionsDir: string): Promise<void> {
  try {
    const { readdir, stat, unlink } = await import('fs/promises');
    const { join } = await import('path');
    const files = await readdir(sessionsDir).catch(() => [] as string[]);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 gün
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(sessionsDir, file);
      const s = await stat(filePath).catch(() => null);
      if (s && s.mtimeMs < cutoff) {
        await unlink(filePath).catch(() => {});
        deleted++;
      }
    }
    if (deleted > 0) {
      // Sessizce temizle, kullanıcıya bildirme
    }
  } catch { /* sessizce geç */ }
}
