/**
 * @fileoverview Takım meta dosyasını okur (~/.seth/teams/).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import { getTeamsDir } from '../config/settings.js';

function sanitizeName(name: string): string {
  const t = name.trim().replace(/[^\w\u00c0-\u024f\-_.]/gu, '_').slice(0, 80);
  return t || 'takim';
}

export const takimOkuTool: ToolDefinition = {
  name: 'takim_oku',
  description: 'Takım kaydı JSON dosyasını okur (takim_olustur ile oluşturduğunuz ad).',
  inputSchema: {
    type: 'object',
    properties: {
      takim_adi: { type: 'string', description: 'Takım adı (dosya adı ile eşleşen)' },
    },
    required: ['takim_adi'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const ad = String(input.takim_adi ?? '').trim();
    if (!ad) {
      return { output: 'Hata: takim_adi gerekli.', isError: true };
    }
    const safe = sanitizeName(ad);
    const filePath = join(getTeamsDir(), `${safe}.json`);
    if (!existsSync(filePath)) {
      return { output: `Takım dosyası yok: ${filePath}`, isError: true };
    }
    const raw = readFileSync(filePath, 'utf-8');
    return { output: raw };
  },
};
