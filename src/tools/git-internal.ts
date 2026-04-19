/**
 * @fileoverview Güvenli git çağrıları (shell yok, argüman dizisi).
 */

import { spawnSync } from 'child_process';

const MAX_OUTPUT_CHARS = 100_000;

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return s.slice(0, MAX_OUTPUT_CHARS) + '\n[... çıktı kısaltıldı]\n';
}

/** cwd içinde git çalıştırır; ilk öğe git alt komutudur. */
export function runGit(cwd: string, args: string[]): GitRunResult {
  const r = spawnSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf-8',
    maxBuffer: MAX_OUTPUT_CHARS * 4,
  });

  const stdoutRaw = typeof r.stdout === 'string' ? r.stdout : String(r.stdout ?? '');
  const stderrRaw = typeof r.stderr === 'string' ? r.stderr : String(r.stderr ?? '');

  return {
    ok: r.status === 0,
    stdout: truncate(stdoutRaw),
    stderr: stderrRaw,
    exitCode: r.status ?? null,
  };
}

/** Depo kökünü bulur; yoksa root null ve Türkçe hata özeti. */
export function resolveGitRepoRoot(startCwd: string): { root: string | null; error?: string } {
  const r = runGit(startCwd, ['rev-parse', '--show-toplevel']);
  const line = r.stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!r.ok || !line) {
    return {
      root: null,
      error:
        'Git deposu bulunamadı (bu dizinde .git yok) veya `git` yüklü değil / çalışmıyor.',
    };
  }
  return { root: line };
}
