/**
 * @fileoverview Salt okunur git log (--oneline).
 */

import { relative, resolve } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import { resolveGitRepoRoot, runGit } from './git-internal.js';

const DEFAULT_N = 10;
const MAX_N = 50;

export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description:
    'Son commit’lerin tek satırlık özet listesi (oneline + decorate). Salt okunur.',
  inputSchema: {
    type: 'object',
    properties: {
      n: {
        type: 'number',
        description: `Commit sayısı. Varsayılan: ${DEFAULT_N}, üst sınır: ${MAX_N}.`,
      },
      path: {
        type: 'string',
        description: 'İsteğe bağlı yalnızca bu yolu etkileyen commit’ler (cwd’ye göre).',
      },
    },
    required: [],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const { root, error } = resolveGitRepoRoot(cwd);
    if (!root) return { output: error ?? 'Git hatası', isError: true };

    let n = typeof input.n === 'number' && Number.isFinite(input.n) ? Math.floor(input.n) : DEFAULT_N;
    n = Math.min(MAX_N, Math.max(1, n));

    const args = ['log', `-n`, String(n), '--oneline', '--decorate'];
    const p = (input.path as string | undefined)?.trim();
    if (p) {
      const abs = resolve(cwd, p);
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (rel.startsWith('..')) {
        return { output: 'path depo kökü içinde olmalı.', isError: true };
      }
      args.push('--', rel || '.');
    }

    const r = runGit(root, args);
    if (!r.ok) {
      return {
        output: r.stderr.trim() || r.stdout.trim() || `git log çıkış kodu: ${r.exitCode}`,
        isError: true,
      };
    }
    return { output: r.stdout.trim() || '(commit yok)' };
  },
};
