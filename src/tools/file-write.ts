/**
 * @fileoverview File write tool — for creating new files or completely overwriting.
 */

import { writeFile, mkdir, stat } from 'fs/promises';
import { dirname, resolve, basename } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';

export const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description:
    'Dosyayı EKSİKSİZ olarak diske yazar. ' +
    'ÖNEMLİ: Yalnızca YENİ dosya oluşturmak veya tam üzerine yazmak için kullan. ' +
    'Var olan dosyada küçük değişiklik için file_edit kullan. ' +
    'Tüm dosya içeriğini ver; yer tutucu yok.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Dosya yolu.' },
      content: { type: 'string', description: 'Tam dosya içeriği.' },
    },
    required: ['path', 'content'],
  },
  isDestructive: true,
  requiresConfirmation: true,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const filePath = resolve(cwd, input.path as string);
    const content = input.content as string;

    try {
      // Check if file already exists
      let isOverwrite = false;
      try {
        const fileStats = await stat(filePath);
        if (fileStats.isDirectory()) {
          return { output: `❌ Cannot write: ${filePath} is a directory.`, isError: true };
        }
        isOverwrite = true;
      } catch {
        // File doesn't exist, which is the intended use case
      }

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');

      const lines = content.split('\n').length;
      
      if (isOverwrite) {
        return { 
          output: `⚠️ OVERWROTE existing file ${basename(filePath)} (${lines} lines).\nFriendly reminder: prefer file_edit for existing files!`, 
          isError: false,
          data: { type: 'update', path: input.path as string, content, lineCount: lines }
        };
      }
      
      return { 
        output: `✅ Created new file ${basename(filePath)} (${lines} lines)`, 
        isError: false,
        data: { type: 'create', path: input.path as string, content, lineCount: lines }
      };
    } catch (err) {
      return { output: `Cannot write to "${filePath}": ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
