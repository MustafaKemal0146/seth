/**
 * @fileoverview Search (Grep) tool — ripgrep varsa kullan, yoksa Node.js fallback.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_IGNORES = ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next'];
const MAX_SEARCH_RESULTS = 50;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// ripgrep mevcut mu kontrol et (bir kez)
let _rgPath: string | null | undefined = undefined;
async function getRgPath(): Promise<string | null> {
  if (_rgPath !== undefined) return _rgPath;
  try {
    const { stdout } = await execFileAsync('which', ['rg']);
    _rgPath = stdout.trim() || null;
  } catch { _rgPath = null; }
  return _rgPath;
}

export const searchTool: ToolDefinition = {
  name: 'search',
  description:
    'Kod tabanında metin veya regex deseni ara (ripgrep benzeri). ' +
    'node_modules ve ikili dosyalar atlanır. ' +
    'Eşleşen satırları satır numarasıyla döndürür.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Aranacak metin veya regex deseni.' },
      dir: { type: 'string', description: 'Aranacak dizin. Varsayılan: çalışma dizini (cwd).' },
      is_regex: { type: 'boolean', description: 'Regex olarak ara. Varsayılan: false' },
    },
    required: ['query'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const query = input.query as string;
    const isRegex = Boolean(input.is_regex);
    const targetDir = input.dir ? resolve(cwd, input.dir as string) : cwd;

    // ripgrep varsa kullan
    const rg = await getRgPath();
    if (rg) {
      try {
        const args = [
          '--line-number', '--color=never', '--max-count=50',
          '--glob=!node_modules', '--glob=!.git', '--glob=!dist',
          isRegex ? '--regexp' : '--fixed-strings', query, targetDir,
        ];
        const { stdout } = await execFileAsync(rg, args, { maxBuffer: 2 * 1024 * 1024 });
        const rgLines = stdout.trim().split('\n').filter(Boolean).slice(0, MAX_SEARCH_RESULTS);
        if (rgLines.length === 0) return { output: `"${query}" bulunamadı.`, isError: false };
        return { output: rgLines.join('\n'), isError: false };
      } catch (e: any) {
        if (e.code === 1) return { output: `"${query}" bulunamadı.`, isError: false };
      }
    }

    let regex: RegExp;
    try {
      regex = isRegex
        ? new RegExp(query, 'g')
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    } catch (e) {
      return { output: `Invalid regex pattern: ${query}`, isError: true };
    }

    const results: string[] = [];
    let filesSearched = 0;

    async function searchFile(filePath: string) {
      if (results.length >= MAX_SEARCH_RESULTS) return;

      try {
        const stats = await stat(filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) return; // Skip huge files

        const content = await readFile(filePath, 'utf-8');
        // Simple heuristic to skip binary files completely
        if (content.includes('\0')) return;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_SEARCH_RESULTS) break;
          
          if (regex.test(lines[i])) {
            const relPath = filePath.replace(targetDir + '\\', '').replace(targetDir + '/', '');
            // Highlight the matched line
            const displayLine = lines[i]?.trim().substring(0, 150) || '';
            results.push(`${relPath}:${i + 1}\t${displayLine}`);
          }
          // Reset lastIndex because 'test' with 'g' flag tracks state
          regex.lastIndex = 0;
        }
      } catch (err) {
        // ignore read permissions etc
      }
    }

    async function walk(dir: string) {
      if (results.length >= MAX_SEARCH_RESULTS) return;

      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (DEFAULT_IGNORES.includes(e.name)) continue;
          
          // Skip common binary media formats quickly
          if (/\.(jpg|jpeg|png|gif|ico|webp|mp4|webm|zip|tar|gz|pdf)$/i.test(e.name)) continue;

          const fullPath = join(dir, e.name);
          
          if (e.isDirectory()) {
            await walk(fullPath);
          } else {
            filesSearched++;
            await searchFile(fullPath);
          }
        }
      } catch (err) {
        // ignore unprivileged folders
      }
    }

    try {
      await walk(targetDir);
      
      if (results.length === 0) {
        return { output: `No lines matched "${query}". Scanned ${filesSearched} text files.`, isError: false };
      }

      const meta = results.length >= MAX_SEARCH_RESULTS ? `\n\n(Limited to ${MAX_SEARCH_RESULTS} matches)` : '';
      return { output: `Found matches across ${filesSearched} searched files:\n\n${results.join('\n')}${meta}`, isError: false };

    } catch (err) {
      return { output: `Error searching codebase: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
