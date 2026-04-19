/**
 * @fileoverview File read tool with line numbers and token limits.
 */

import { readFile, stat } from 'fs/promises';
import { resolve, basename } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';

const MAX_LINES = 1000;

export const fileReadTool: ToolDefinition = {
  name: 'file_read',
  description:
    'Dosya içeriğini satır numaralarıyla okur. ' +
    'Biçim: `satir_no\\ticerik`. ' +
    'Dosyayı değiştirmeden önce her zaman bu aracı kullan. ' +
    `Tek seferde en fazla ${MAX_LINES} satır döner; devamı için offset kullan.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Dosya yolu.' },
      offset: { type: 'number', description: '1 tabanlı başlangıç satırı. Varsayılan: 1' },
      limit: { type: 'number', description: `En fazla satır. Varsayılan: ${MAX_LINES}` },
    },
    required: ['path'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const filePath = resolve(cwd, input.path as string);

    try {
      const stats = await stat(filePath);
      if (stats.isDirectory()) {
        return { output: `❌ Cannot read ${filePath}: Is a directory. Use list_directory instead.`, isError: true };
      }

      if (stats.size > 10 * 1024 * 1024) {
        return { output: `❌ File is too large to read (>${10}MB).`, isError: true };
      }

      // PDF desteği — pdftotext varsa kullan
      if (filePath.toLowerCase().endsWith('.pdf')) {
        const { execSync } = await import('child_process');
        try {
          execSync('which pdftotext', { stdio: 'ignore' });
          const text = execSync(`pdftotext "${filePath}" -`, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
          return { output: `[PDF: ${basename(filePath)}]\n\n${text.slice(0, 40000)}`, isError: false };
        } catch {
          return { output: `❌ PDF okumak için pdftotext gerekli.\nKurulum: sudo apt install poppler-utils`, isError: true };
        }
      }

      const raw = await readFile(filePath, 'utf-8');
      const lines = raw.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

      const totalLines = lines.length;
      const startIdx = input.offset ? Math.max(0, Number(input.offset) - 1) : 0;

      if (startIdx >= totalLines && totalLines > 0) {
        return { output: `File has ${totalLines} lines but offset ${input.offset} is beyond the end.`, isError: true };
      }

      const requestedLimit = input.limit ? Number(input.limit) : MAX_LINES;
      const limit = Math.min(requestedLimit, MAX_LINES);
      
      const endIdx = Math.min(startIdx + limit, totalLines);
      const slice = lines.slice(startIdx, endIdx);

      const numbered = slice.map((line, i) => `${startIdx + i + 1}\t${line}`).join('\n');
      
      let meta = `\n\n--- [${basename(filePath)} : Lines ${startIdx + 1}-${endIdx} of ${totalLines}] ---`;
      if (endIdx < totalLines) {
        meta += `\n(File is truncated. Check lines ${endIdx + 1} to ${totalLines} using 'offset: ${endIdx + 1}')`;
      }

      return { output: numbered + meta, isError: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { output: `❌ File not found: ${filePath}`, isError: true };
      }
      return { output: `Cannot read "${filePath}": ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
