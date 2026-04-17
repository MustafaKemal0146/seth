/**
 * @fileoverview Git worktree aracı — paralel branch çalışması.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);

export const gitWorktreeTool: ToolDefinition = {
  name: 'git_worktree',
  description: 'Git worktree yönetimi. Paralel branch\'lerde çalışmak için worktree ekle, listele veya kaldır.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'Yapılacak işlem' },
      path: { type: 'string', description: 'Worktree dizin yolu (add/remove için)' },
      branch: { type: 'string', description: 'Branch adı (add için)' },
    },
    required: ['action'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const action = input.action as string;

    try {
      if (action === 'list') {
        const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd });
        if (!stdout.trim()) return { output: 'Aktif worktree yok.' };
        const trees = stdout.trim().split('\n\n').map(block => {
          const lines = block.split('\n');
          const worktreePath = lines[0]?.replace('worktree ', '') ?? '';
          const branch = lines.find(l => l.startsWith('branch'))?.replace('branch refs/heads/', '') ?? 'detached';
          return `  ${worktreePath}  [${branch}]`;
        });
        return { output: `Worktree listesi:\n${trees.join('\n')}` };
      }

      if (action === 'add') {
        if (!input.path) return { output: 'path gerekli.', isError: true };
        const args = ['worktree', 'add', input.path as string];
        if (input.branch) args.push('-b', input.branch as string);
        const { stdout } = await execFileAsync('git', args, { cwd });
        return { output: `✓ Worktree oluşturuldu: ${input.path}\n${stdout}` };
      }

      if (action === 'remove') {
        if (!input.path) return { output: 'path gerekli.', isError: true };
        const { stdout } = await execFileAsync('git', ['worktree', 'remove', input.path as string], { cwd });
        return { output: `✓ Worktree kaldırıldı: ${input.path}\n${stdout}` };
      }

      return { output: `Bilinmeyen işlem: ${action}`, isError: true };
    } catch (err) {
      return { output: `Git worktree hatası: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
