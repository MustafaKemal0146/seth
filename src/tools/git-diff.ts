/**
 * @fileoverview Salt okunur git diff (tam veya --stat, staged opsiyonel).
 */

import { relative, resolve } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import { resolveGitRepoRoot, runGit } from './git-internal.js';

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description:
    'İşleme alınmış veya alınmamış değişikliklerin diff çıktısı veya --stat özeti. Salt okunur.',
  inputSchema: {
    type: 'object',
    properties: {
      staged: {
        type: 'boolean',
        description: 'true ise index (stage) ile HEAD arası (--cached). Varsayılan: false (çalışma ağacı).',
      },
      stat_only: {
        type: 'boolean',
        description: 'true ise yalnızca dosya başına satır istatistiği (--stat). Varsayılan: false (tam diff).',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'İsteğe bağlı dosya/klasör yolları (cwd’ye göre).',
      },
    },
    required: [],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const { root, error } = resolveGitRepoRoot(cwd);
    if (!root) return { output: error ?? 'Git hatası', isError: true };

    const staged = Boolean(input.staged);
    const statOnly = Boolean(input.stat_only);
    const pathsIn = (input.paths as string[] | undefined)?.filter((x) => x?.trim()) ?? [];

    const args: string[] = ['diff'];
    if (staged) args.push('--cached');
    if (statOnly) args.push('--stat');
    if (pathsIn.length > 0) {
      const relPaths: string[] = [];
      for (const p of pathsIn) {
        const abs = resolve(cwd, p);
        const rel = relative(root, abs).replace(/\\/g, '/');
        if (rel.startsWith('..')) {
          return { output: `paths içinde depo dışı yol: ${p}`, isError: true };
        }
        relPaths.push(rel || '.');
      }
      args.push('--', ...relPaths);
    }

    const r = runGit(root, args);
    if (!r.ok) {
      return {
        output: r.stderr.trim() || r.stdout.trim() || `git diff çıkış kodu: ${r.exitCode}`,
        isError: true,
      };
    }
    const out = r.stdout.trim();
    return { output: out || (statOnly ? '(değişiklik yok)' : '') };
  },
};
