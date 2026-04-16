/**
 * @fileoverview Glob tool — recursive file discovery with auto-ignore for common directories.
 */

import { readdir, stat } from 'fs/promises';
import { resolve, join, basename } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';

const DEFAULT_IGNORES = ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next'];

export const globTool: ToolDefinition = {
  name: 'glob',
  description:
    'Dosya adı veya alt dizge ile dosya bulur. ' +
    '.git, node_modules ve derleme klasörlerini atlar. ' +
    'shell(find) veya shell(ls) yerine bunu kullan.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Eşleşecek alt dizge veya dosya adı parçası.' },
      dir: {
        type: 'string',
        description: 'Arama kökü (göreli veya mutlak). Varsayılan: cwd.',
      },
    },
    required: ['pattern'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const pattern = (input.pattern as string).toLowerCase();
    const targetDir = input.dir ? resolve(cwd, input.dir as string) : cwd;

    const matches: string[] = [];
    let scanned = 0;

    async function walk(dir: string) {
      if (matches.length >= 100) return; // limit to 100 results

      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (DEFAULT_IGNORES.includes(e.name)) continue;

          const fullPath = join(dir, e.name);
          
          if (e.isDirectory()) {
            await walk(fullPath);
          } else {
            scanned++;
            if (e.name.toLowerCase().includes(pattern) || fullPath.toLowerCase().includes(pattern)) {
              matches.push(fullPath);
            }
          }
        }
      } catch (err) {
        // ignore access errors on deep unprivileged folders
      }
    }

    try {
      await walk(targetDir);
      
      if (matches.length === 0) {
        return { output: `No files matched "${pattern}". Scanned ${scanned} files.`, isError: false };
      }

      // Convert to relative paths if within targetDir for cleaner output
      const cleanMatches = matches.map(m => m.replace(targetDir + '\\', '').replace(targetDir + '/', ''));
      
      const meta = matches.length === 100 ? '\n(Limited to 100 results)' : '';
      return { output: `Found ${matches.length} files matching "${pattern}":\n\n${cleanMatches.join('\n')}${meta}`, isError: false };

    } catch (err) {
      return { output: `Error scanning directory: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
