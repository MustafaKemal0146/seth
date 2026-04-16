/**
 * @fileoverview İsimlendirilmiş takım meta dosyası oluşturur (~/.seth/teams/).
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';
import { getTeamsDir } from '../config/settings.js';
import { getAgentSessionContext } from '../session-runtime.js';

function sanitizeName(name: string): string {
  const t = name.trim().replace(/[^\w\u00c0-\u024f\-_.]/gu, '_').slice(0, 80);
  return t || 'takim';
}

export const takimOlusturTool: ToolDefinition = {
  name: 'takim_olustur',
  description:
    'İsimlendirilmiş bir takım kaydı oluşturur (paralel iş / ajanda). Dosya ~/.seth/teams/ altında saklanır.',
  inputSchema: {
    type: 'object',
    properties: {
      takim_adi: { type: 'string', description: 'Takım benzersiz adı' },
      aciklama: { type: 'string', description: 'İsteğe bağlı açıklama' },
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
    const aciklama = input.aciklama !== undefined ? String(input.aciklama) : undefined;
    const safe = sanitizeName(ad);
    const dir = getTeamsDir();
    const filePath = join(dir, `${safe}.json`);
    const sid = getAgentSessionContext();
    const payload = {
      takim_adi: ad,
      dosya: safe,
      oturum_id: sid,
      olusturulma: new Date().toISOString(),
      aciklama: aciklama ?? null,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { output: `Takım oluşturuldu: ${ad} → ${filePath}` };
  },
};
