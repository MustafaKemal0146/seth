/**
 * @fileoverview Salt okunur git status (-sb).
 */

import { relative, resolve } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import { resolveGitRepoRoot, runGit } from './git-internal.js';

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description:
    'Git deposunun kısa durumunu gösterir (dal + izlenen dosyalar). Salt okunur; shell yerine bunu kullan.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'İsteğe bağlı alt yol (cwd’ye göre); yalnızca bu alt ağaç için durum özeti.',
      },
    },
    required: [],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const { root, error } = resolveGitRepoRoot(cwd);
    if (!root) return { output: error ?? 'Git hatası', isError: true };

    const args = ['status', '-sb'];
    const p = (input.path as string | undefined)?.trim();
    if (p) {
      const abs = resolve(cwd, p);
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (rel.startsWith('..')) {
        return { output: 'path, depo köküne göre geçerli bir alt dizin olmalı.', isError: true };
      }
      args.push('--', rel || '.');
    }

    const r = runGit(root, args);
    if (!r.ok) {
      return {
        output: r.stderr.trim() || r.stdout.trim() || `git status çıkış kodu: ${r.exitCode}`,
        isError: true,
      };
    }
    return { output: r.stdout.trim() || '(boş)' };
  },
};
