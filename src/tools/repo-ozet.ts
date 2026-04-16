/**
 * @fileoverview Tek çağrıda dal, son commit, diff --stat ve kısa status.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { resolveGitRepoRoot, runGit } from './git-internal.js';

function section(title: string, body: string): string {
  return `${title}\n${body.trim() || '(boş)'}\n`;
}

/** Slash /repo_ozet ile paylaşılan mantık. */
export async function runRepoOzetSummary(cwd: string): Promise<ToolResult> {
  const { root, error } = resolveGitRepoRoot(cwd);
  if (!root) return { output: error ?? 'Git hatası', isError: true };

  const branch = runGit(root, ['branch', '--show-current']);
  const last = runGit(root, ['log', '-1', '--oneline', '--decorate']);
  const stat = runGit(root, ['diff', '--stat', 'HEAD']);
  const st = runGit(root, ['status', '-sb']);
  const common = runGit(root, ['rev-parse', '--git-common-dir']);

  const parts: string[] = [];
  const gitCommon = common.stdout.trim();
  const isWorktree = gitCommon && !gitCommon.endsWith('.git'); // or just not default .git

  parts.push(section('Dal:', branch.stdout.trim()));
  if (isWorktree) {
    parts.push(section('Worktree Tespit Edildi:', `Evet (Common Dir: ${gitCommon})`));
  }
  parts.push(section('Son commit:', last.stdout.trim()));
  parts.push(section('diff --stat (çalışma ağacı vs HEAD):', stat.stdout.trim()));
  parts.push(section('Kısa durum (status -sb):', st.stdout.trim()));

  const anyFail = !branch.ok || !last.ok || !stat.ok || !st.ok;
  if (anyFail) {
    const err =
      [branch.stderr, last.stderr, stat.stderr, st.stderr].filter(Boolean).join('\n') ||
      'Bir veya daha fazla git alt komutu başarısız.';
    return { output: parts.join('\n') + `\n--- Uyarı ---\n${err}`, isError: false };
  }

  return { output: parts.join('\n').trimEnd() };
}

export const repoOzetTool: ToolDefinition = {
  name: 'repo_ozet',
  description:
    'Depo özeti: mevcut dal, son commit (1 satır), tüm çalışma ağacına karşı diff --stat ve git status -sb. PR/dal bağlamı için tek çağrı.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(_input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    return runRepoOzetSummary(cwd);
  },
};
