/**
 * @fileoverview LSP aracı — TypeScript/ESLint diagnostics + gerçek LSP bağlantısı.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { spawnSync, spawn } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

export const lspDiagnosticsTool: ToolDefinition = {
  name: 'lsp_diagnostics',
  description: 'Projedeki kod hatalarını ve uyarılarını listeler. TypeScript (tsc --noEmit) veya ESLint kullanır.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Kontrol edilecek dizin (varsayılan: .)' },
      tool: { type: 'string', enum: ['auto', 'tsc', 'eslint'], description: 'Kullanılacak araç (varsayılan: auto)' },
    },
  },
  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const targetPath = (input.path as string) || '.';
    const absPath = join(cwd, targetPath);
    const tool = (input.tool as string) || 'auto';

    const hasTsConfig = existsSync(join(absPath, 'tsconfig.json'));
    const hasEslint = existsSync(join(absPath, '.eslintrc.json')) || existsSync(join(absPath, '.eslintrc.js')) || existsSync(join(absPath, 'eslint.config.js'));

    let output = '';

    // TypeScript
    if ((tool === 'auto' && hasTsConfig) || tool === 'tsc') {
      const r = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
        cwd: absPath, shell: true, encoding: 'utf-8', timeout: 30_000,
      });
      const combined = (r.stdout || '') + (r.stderr || '');
      if (combined.trim()) output += `TypeScript Hataları:\n${combined.trim()}\n`;
      else output += 'TypeScript: Hata yok ✓\n';
    }

    // ESLint
    if ((tool === 'auto' && hasEslint) || tool === 'eslint') {
      const r = spawnSync('npx', ['eslint', '.', '--format', 'compact', '--max-warnings', '50'], {
        cwd: absPath, shell: true, encoding: 'utf-8', timeout: 30_000,
      });
      const combined = (r.stdout || '') + (r.stderr || '');
      if (combined.trim()) output += `ESLint Bulguları:\n${combined.trim()}\n`;
      else output += 'ESLint: Uyarı yok ✓\n';
    }

    if (!output) {
      return { output: 'tsconfig.json veya ESLint config bulunamadı. Desteklenen: TypeScript, ESLint.' };
    }

    return { output: output.trim() };
  },
};
