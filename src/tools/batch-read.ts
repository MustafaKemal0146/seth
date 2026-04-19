/**
 * @fileoverview Batch read tool — read multiple files in one operation.
 */

import { readFile, stat } from 'fs/promises';
import { resolve, basename } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';

const MAX_FILES = 20;
const MAX_LINES_PER_FILE = 500;
const MAX_TOTAL_SIZE = 100_000; // 100KB total

export const batchReadTool: ToolDefinition = {
  name: 'batch_read',
  description: `Birden çok dosyayı tek seferde okur; başlıklarla birlikte döner. En fazla ${MAX_FILES} dosya, dosya başına ${MAX_LINES_PER_FILE} satır.`,
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Okunacak dosya yolları (mutlak veya cwd’ye göreli).',
      },
      show_line_numbers: {
        type: 'boolean',
        description: 'Satır numaralarını göster. Varsayılan: true',
      },
    },
    required: ['paths'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    let paths = input.paths as string[];
    // Glob pattern'ları genişlet — sadece ** içerenleri işle
    const expandedPaths: string[] = [];
    for (const p of paths) {
      if (p.includes('*')) {
        // Basit glob: sadece *.ext pattern'ı destekle
        try {
          const { readdirSync, statSync } = await import('fs');
          const { join: pjoin, extname } = await import('path');
          const ext = p.split('*').pop() ?? '';
          const dir = p.includes('/') ? pjoin(cwd, p.split('*')[0]!.replace(/\/$/, '')) : cwd;
          const files = readdirSync(dir).filter(f => f.endsWith(ext)).slice(0, MAX_FILES);
          expandedPaths.push(...files.map(f => pjoin(dir, f)));
        } catch { expandedPaths.push(p); }
      } else {
        expandedPaths.push(p);
      }
    }
    paths = expandedPaths;
    const showLineNumbers = (input.show_line_numbers as boolean) ?? true;

    if (!Array.isArray(paths) || paths.length === 0) {
      return { output: 'No file paths provided.', isError: true };
    }

    if (paths.length > MAX_FILES) {
      return { 
        output: `Too many files. Maximum ${MAX_FILES} files allowed, got ${paths.length}.`, 
        isError: true 
      };
    }

    const results: FileReadResult[] = [];
    let totalSize = 0;

    // Paralel okuma — 5'er 5'er
    const PARALLEL_LIMIT = 5;
    for (let i = 0; i < paths.length; i += PARALLEL_LIMIT) {
      const batch = paths.slice(i, i + PARALLEL_LIMIT);
      const batchResults = await Promise.all(
        batch.map(path => {
          const filePath = resolve(cwd, path);
          return readSingleFile(filePath, showLineNumbers, MAX_TOTAL_SIZE - totalSize);
        })
      );
      
      for (const result of batchResults) {
        results.push(result);
        if (!result.error) totalSize += result.size;
        if (totalSize >= MAX_TOTAL_SIZE) break;
      }
      
      if (totalSize >= MAX_TOTAL_SIZE) {
        results.push({
          path: '...',
          content: `(Size limit reached: ${MAX_TOTAL_SIZE} bytes)`,
          error: false,
          size: 0,
          lines: 0,
          truncated: true,
        });
        break;
      }
    }

    const output = formatBatchOutput(results);
    const hasErrors = results.some(r => r.error);

    return { output, isError: hasErrors && results.every(r => r.error) };
  },
};

interface FileReadResult {
  path: string;
  content: string;
  error: boolean;
  size: number;
  lines: number;
  truncated: boolean;
}

async function readSingleFile(
  filePath: string,
  showLineNumbers: boolean,
  remainingBytes: number,
): Promise<FileReadResult> {
  try {
    // Check file size first
    const stats = await stat(filePath);
    
    if (stats.isDirectory()) {
      return {
        path: filePath,
        content: '(This is a directory, not a file)',
        error: true,
        size: 0,
        lines: 0,
        truncated: false,
      };
    }

    // Check for binary files
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'ico', 'pdf', 'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'dylib', 'woff', 'woff2', 'ttf', 'eot'];
    
    if (binaryExtensions.includes(ext)) {
      return {
        path: filePath,
        content: `(Binary file: ${stats.size} bytes)`,
        error: false,
        size: 0,
        lines: 0,
        truncated: false,
      };
    }

    const raw = await readFile(filePath, 'utf-8');
    let lines = raw.split('\n');
    
    // Remove trailing empty line
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const truncated = lines.length > MAX_LINES_PER_FILE;
    if (truncated) {
      lines = lines.slice(0, MAX_LINES_PER_FILE);
    }

    let content: string;
    if (showLineNumbers) {
      content = lines.map((line, i) => `${String(i + 1).padStart(4)}\t${line}`).join('\n');
    } else {
      content = lines.join('\n');
    }

    const truncatedNote = truncated ? `\n... (truncated at ${MAX_LINES_PER_FILE} lines)` : '';

    return {
      path: filePath,
      content: content + truncatedNote,
      error: false,
      size: content.length,
      lines: lines.length,
      truncated,
    };
  } catch (err) {
    return {
      path: filePath,
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      error: true,
      size: 0,
      lines: 0,
      truncated: false,
    };
  }
}

function formatBatchOutput(results: FileReadResult[]): string {
  const parts: string[] = [];

  for (const result of results) {
    const header = `\n${'═'.repeat(60)}\n📄 ${basename(result.path)}\n${'─'.repeat(60)}\n`;
    
    if (result.error) {
      parts.push(header + `❌ ${result.content}`);
    } else {
      const meta = result.truncated ? ' (truncated)' : '';
      parts.push(header + result.content + meta);
    }
  }

  const summary = `\n${'═'.repeat(60)}\n📊 Summary: ${results.length} file(s), ${results.filter(r => r.error).length} error(s)\n`;

  return parts.join('') + summary;
}
