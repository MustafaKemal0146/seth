/**
 * @fileoverview Topic Tool — konuşma konusunu tespit eder ve oturum başlığını günceller.
 */

import type { ToolDefinition, ToolResult } from '../types.js';

export const topicTool: ToolDefinition = {
  name: 'update_topic',
  description: 'Konuşmanın mevcut konusunu/başlığını güncelle. Konu değiştiğinde çağır.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Konuşmanın kısa başlığı (max 60 karakter)' },
    },
    required: ['topic'],
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const topic = String(input.topic ?? '').slice(0, 60);
    if (!topic) return { output: 'Konu boş olamaz.', isError: true };
    // Terminal başlığını güncelle
    process.stdout.write(`\x1b]0;SETH — ${topic}\x07`);
    return { output: `Konu güncellendi: ${topic}` };
  },
};
