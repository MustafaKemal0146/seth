/**
 * @fileoverview Görev listesine tek öğe ekler (gorev_yaz tam liste değil).
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import type { TodoDurum } from '../session-runtime.js';
import { gorevEkle, getAgentSessionContext } from '../session-runtime.js';

const DURUMLAR: TodoDurum[] = ['bekliyor', 'suruyor', 'tamamlandi'];

function isDurum(s: string): s is TodoDurum {
  return DURUMLAR.includes(s as TodoDurum);
}

export const gorevEkleTool: ToolDefinition = {
  name: 'gorev_ekle',
  description:
    'Mevcut görev listesine tek görev ekler (id çakışmaz). Tam liste için gorev_yaz kullanın.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Kısa benzersiz kimlik' },
      baslik: { type: 'string', description: 'Görev başlığı' },
      durum: {
        type: 'string',
        enum: ['bekliyor', 'suruyor', 'tamamlandi'],
        description: 'Varsayılan: bekliyor',
      },
    },
    required: ['id', 'baslik'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const id = String(input.id ?? '').trim();
    const baslik = String(input.baslik ?? '').trim();
    const durumRaw = String(input.durum ?? 'bekliyor').trim();
    if (!id || !baslik) {
      return { output: 'Hata: id ve baslik zorunlu.', isError: true };
    }
    if (!isDurum(durumRaw)) {
      return { output: `Hata: geçersiz durum "${durumRaw}".`, isError: true };
    }
    const sid = getAgentSessionContext();
    try {
      gorevEkle(sid, { id, baslik, durum: durumRaw });
    } catch (e) {
      return { output: e instanceof Error ? e.message : String(e), isError: true };
    }
    return { output: `Görev eklendi: ${id} — ${baslik}` };
  },
};
