import type { ToolDefinition, ToolResult } from '../types.js';
import { stat, readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';

// .seth/memory.md format.
function getMemoryPath(cwd: string): string {
  return path.join(cwd, '.seth', 'memory.md');
}

export const memoryReadTool: ToolDefinition = {
  name: 'memory_read',
  description: 'Proje kalıcı belleğini (.seth/memory.md) okur. Kararlar, sistem durumu ve unutulmaması gereken notlar burada tutulur.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const memoryFile = getMemoryPath(cwd);
    try {
      await stat(memoryFile);
      const content = await readFile(memoryFile, 'utf-8');
      return { output: content.trim() ? content : 'Bellek boş.', isError: false };
    } catch {
      return { output: 'Kalıcı bellek dosyası henüz oluşturulmamış.', isError: false };
    }
  },
};

export const memoryWriteTool: ToolDefinition = {
  name: 'memory_write',
  description: 'Projenin kalıcı belleğine (.seth/memory.md) not ekler veya günceller. Unutulmamasi gereken bilgileri kalıcı belleğe kazımak için kullan.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Belleğe yazılacak tüm içerik. Öncekileri ezeceği için mevcutları korumak istiyorsa memory_read yap ve ekle.' }
    },
    required: ['content']
  },
  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const content = typeof input.content === 'string' ? input.content : '';
    const memoryDir = path.join(cwd, '.seth');
    const memoryFile = path.join(memoryDir, 'memory.md');

    try {
      await stat(memoryDir).catch(async () => {
        await mkdir(memoryDir, { recursive: true });
      });
      await writeFile(memoryFile, content, 'utf-8');
      return { output: `Kalıcı bellek güncellendi: ${memoryFile}\nİçerik Uzunluğu: ${content.length} karakter.`, isError: false };
    } catch (err: any) {
      return { output: `Belleğe yazılamadı: ${err.message}`, isError: true };
    }
  },
};
