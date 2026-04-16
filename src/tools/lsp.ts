import type { ToolDefinition, ToolResult } from '../types.js';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export const lspDiagnosticsTool: ToolDefinition = {
  name: 'lsp_diagnostics',
  description: 'Projedeki kod hatalarını ve uyarılarını listeler. TypeScript (tsc) veya ESLint kullanır.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Kontrol edilecek dizin (varsayılan: .)',
      },
    },
  },
  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const targetPath = (input.path as string) || '.';
    const absPath = join(cwd, targetPath);

    let output = '';
    let hasTsConfig = existsSync(join(absPath, 'tsconfig.json'));
    let hasPackageJson = existsSync(join(absPath, 'package.json'));

    if (hasTsConfig) {
      // Try npx tsc --noEmit
      const r = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
        cwd: absPath,
        shell: true,
        encoding: 'utf-8',
      });
      if (r.stdout) output += `--- TypeScript Hataları ---\n${r.stdout}\n`;
      if (r.stderr) output += `--- tsc stderr ---\n${r.stderr}\n`;
    }

    if (hasPackageJson && !output) {
      // Try eslint if no tsc output or no tsconfig
      const r = spawnSync('npx', ['eslint', '.', '--format', 'compact'], {
        cwd: absPath,
        shell: true,
        encoding: 'utf-8',
      });
      if (r.stdout) output += `--- ESLint Bulguları ---\n${r.stdout}\n`;
    }

    if (!output) {
      return { output: 'Herhangi bir hata veya uyarı bulunamadı (veya uygun bir linter/compiler tespit edilemedi).' };
    }

    return { output: output.trim() };
  },
};
