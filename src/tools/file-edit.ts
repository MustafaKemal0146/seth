/**
 * @fileoverview File edit tool — exact string replacement with diff output.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve, basename } from 'path';
import chalk from 'chalk';
import type { ToolDefinition, ToolResult, FileToolData } from '../types.js';
import { webUIController } from '../web/controller.js';
import { generateColoredDiff } from '../diff-utils.js';
import { isPathSafe } from '../security/path-validation.js';

export const fileEditTool: ToolDefinition = {
  name: 'file_edit',
  description:
    'Dosyada tam metin eşleşmesiyle değiştirme yapar. ' +
    'Var olan dosyayı düzenlemeyi yeni dosya yazmaya tercih et. ' +
    'old_string dosyada tek değilse işlem başarısız olur; daha geniş bağlam ver veya ' +
    'allow_multiple: true ile tüm eşleşmeleri değiştir. ' +
    'Satır numarası önekini old_string/new_string içine asla katma.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Dosya yolu.' },
      old_string: {
        type: 'string',
        description: 'Bulunup değiştirilecek tam metin (girinti ve boşluklar dosyayla aynı olmalı).',
      },
      new_string: { type: 'string', description: 'Yerine konacak metin.' },
      allow_multiple: {
        type: 'boolean',
        description: 'true ise old_string’in tüm örnekleri değişir. Varsayılan: false',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  isDestructive: true,
  requiresConfirmation: true,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    if (!isPathSafe(cwd, input.path as string)) {
      return { output: `❌ Security Error: Path traversal detected. Cannot edit files outside the current working directory.`, isError: true };
    }

    const filePath = resolve(cwd, input.path as string);
    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;
    const allowMultiple = Boolean(input.allow_multiple);

    if (!oldStr) {
      return { output: `❌ Error: old_string cannot be empty.`, isError: true };
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const occurrences = content.split(oldStr).length - 1;

      if (occurrences === 0) {
        // Try to provide helpful error if it's a whitespace issue
        const normalizedContent = content.replace(/\s+/g, ' ');
        const normalizedOld = oldStr.replace(/\s+/g, ' ');
        if (normalizedContent.includes(normalizedOld)) {
          return { output: `❌ No exact match found, but found a match with different whitespace/indentation. Check your spaces and tabs.`, isError: true };
        }
        return { output: `❌ No match found for the specified old_string in ${filePath}. Check if the file was modified.`, isError: true };
      }

      if (occurrences > 1 && !allowMultiple) {
        return { output: `❌ Found ${occurrences} matches. old_string must be unique. Add more context to make it unique or use allow_multiple: true.`, isError: true };
      }

      const updated = allowMultiple ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
      await writeFile(filePath, updated, 'utf-8');

      // Generate colored diff for terminal
      const diff = generateDiff(oldStr, newStr, filePath, occurrences, content);
      // Generate clean diff for web UI
      const cleanDiff = generateCleanDiff(oldStr, newStr);

      const oldLineCount = oldStr.split('\n').length;
      const newLineCount = newStr.split('\n').length;
      const summary = `Replaced ${occurrences} occurrence(s) of ${oldLineCount} line(s) with ${newLineCount} line(s)`;
      const totalLines = updated.split('\n').length;

      const data: FileToolData = {
        type: 'update',
        path: input.path as string,
        diff: cleanDiff,
        lineCount: totalLines,
        summary,
      };

      // Web UI'ya diff gönder
      webUIController.sendDiff(basename(filePath), cleanDiff);

      return { output: `✅ ${summary} in ${basename(filePath)}\n\n${diff}`, data };
    } catch (err) {
      return { output: `Cannot edit "${filePath}": ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};

function generateDiff(oldStr: string, newStr: string, filePath: string, occurrences: number, fullContent?: string): string {
  const lines: string[] = [];
  lines.push(`\x1b[90m${'─'.repeat(50)}\x1b[0m`);
  lines.push(`\x1b[1m📝 ${basename(filePath)}\x1b[0m \x1b[90m(${occurrences} match${occurrences > 1 ? 'es' : ''})\x1b[0m`);
  lines.push(`\x1b[90m${'─'.repeat(50)}\x1b[0m`);

  // Use context-aware diff if we have the full file content
  if (fullContent) {
    const oldStart = fullContent.indexOf(oldStr);
    const linesBefore = oldStart >= 0 ? fullContent.slice(0, oldStart).split('\n').length : 1;
    const colored = generateColoredDiff(oldStr, newStr, 2);
    // Adjust line numbers based on actual position in file
    const shifted = colored.replace(/^\s*(\d+)/gm, (_, n) => String(parseInt(n) + linesBefore - 1).padStart(4));
    lines.push(shifted);
  } else {
    lines.push(generateColoredDiff(oldStr, newStr, 2));
  }

  lines.push(`\x1b[90m${'─'.repeat(50)}\x1b[0m`);
  return lines.join('\n');
}

/** Web UI için ANSI kodsuz temiz diff (- / + satır önekleri). */
function generateCleanDiff(oldStr: string, newStr: string): string {
  const lines: string[] = [];
  for (const line of oldStr.split('\n')) lines.push(`- ${line}`);
  for (const line of newStr.split('\n')) lines.push(`+ ${line}`);
  return lines.join('\n');
}
