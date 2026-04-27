/**
 * @fileoverview File write tool — for creating new files or completely overwriting.
 */

import { writeFile, mkdir, stat, readFile } from 'fs/promises';
import { dirname, resolve, basename } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import { webUIController } from '../web/controller.js';
import { isPathSafe } from '../security/path-validation.js';

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
    if (!isPathSafe(cwd, input.path as string)) {
      return { output: `❌ Security Error: Path traversal detected. Cannot write to files outside the current working directory.`, isError: true };
    }

    const filePath = resolve(cwd, input.path as string);
    const content = input.content as string;

    try {
      // Check if file already exists
      let isOverwrite = false;
      let oldContent = '';
      try {
        const fileStats = await stat(filePath);
        if (fileStats.isDirectory()) {
          return { output: `❌ Cannot write: ${filePath} is a directory.`, isError: true };
        }
        isOverwrite = true;
        oldContent = await readFile(filePath, 'utf-8').catch(() => '');
      } catch {
        // File doesn't exist, which is the intended use case
      }

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');

      const lines = content.split('\n').length;

      if (isOverwrite) {
        // Web UI'ya diff gönder
        const diffLines: string[] = [];
        for (const l of oldContent.split('\n')) diffLines.push(`- ${l}`);
        for (const l of content.split('\n')) diffLines.push(`+ ${l}`);
        webUIController.sendDiff(basename(filePath), diffLines.join('\n'));

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
