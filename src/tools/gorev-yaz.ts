/**
 * @fileoverview Oturum görev listesini tam liste ile değiştirir.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import type { GorevOgesi, TodoDurum } from '../session-runtime.js';
import { getAgentSessionContext, todoListesiniAyarla } from '../session-runtime.js';

const DURUMLAR: TodoDurum[] = ['bekliyor', 'suruyor', 'tamamlandi'];

function isDurum(s: string): s is TodoDurum {
  return DURUMLAR.includes(s as TodoDurum);
}

export const gorevYazTool: ToolDefinition = {
  name: 'gorev_yaz',
  description:
    'Görev listesini günceller: tüm görevleri tek seferde verin (tam değiştirme). ' +
    'Her görevde id, baslik ve durum (bekliyor | suruyor | tamamlandi) olmalı.',
  inputSchema: {
    type: 'object',
    properties: {
      gorevler: {
        type: 'array',
        description: 'Güncel görev listesinin tamamı',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Kısa benzersiz kimlik' },
            baslik: { type: 'string', description: 'Görev açıklaması' },
            durum: {
              type: 'string',
              enum: ['bekliyor', 'suruyor', 'tamamlandi'],
              description: 'bekliyor = yapılacak, suruyor = üzerinde çalışılıyor, tamamlandi = bitti',
            },
          },
          required: ['id', 'baslik', 'durum'],
        },
      },
    },
    required: ['gorevler'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const raw = input.gorevler;
    if (!Array.isArray(raw)) {
      return { output: 'Hata: gorevler bir dizi olmalı.', isError: true };
    }

    const out: GorevOgesi[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        return { output: 'Hata: geçersiz görev öğesi.', isError: true };
      }
      const o = item as Record<string, unknown>;
      const id = String(o.id ?? '').trim();
      const baslik = String(o.baslik ?? '').trim();
      const durum = String(o.durum ?? '').trim();
      if (!id || !baslik) {
        return { output: 'Hata: her görevde id ve baslik zorunlu.', isError: true };
      }
      if (!isDurum(durum)) {
        return { output: `Hata: geçersiz durum "${durum}".`, isError: true };
      }
      out.push({ id, baslik, durum });
    }

    const sid = getAgentSessionContext();
    todoListesiniAyarla(sid, out);
    return { output: `Görev listesi güncellendi (${out.length} öğe).` };
  },
};
