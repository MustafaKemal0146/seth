/**
 * @fileoverview Tek görevde baslik veya durum günceller.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import type { TodoDurum } from '../session-runtime.js';
import { gorevGuncelle, getAgentSessionContext } from '../session-runtime.js';

const DURUMLAR: TodoDurum[] = ['bekliyor', 'suruyor', 'tamamlandi'];

function isDurum(s: string): s is TodoDurum {
  return DURUMLAR.includes(s as TodoDurum);
}

export const gorevGuncelleTool: ToolDefinition = {
  name: 'gorev_guncelle',
  description: 'Var olan bir görevin başlığını veya durumunu günceller.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Görev id' },
      baslik: { type: 'string', description: 'Yeni başlık (isteğe bağlı)' },
      durum: {
        type: 'string',
        enum: ['bekliyor', 'suruyor', 'tamamlandi'],
        description: 'Yeni durum (isteğe bağlı)',
      },
    },
    required: ['id'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const id = String(input.id ?? '').trim();
    if (!id) {
      return { output: 'Hata: id gerekli.', isError: true };
    }
    const patch: { baslik?: string; durum?: TodoDurum } = {};
    if (input.baslik !== undefined) {
      const b = String(input.baslik).trim();
      if (b) patch.baslik = b;
    }
    if (input.durum !== undefined) {
      const d = String(input.durum).trim();
      if (!isDurum(d)) {
        return { output: `Hata: geçersiz durum "${d}".`, isError: true };
      }
      patch.durum = d;
    }
    if (Object.keys(patch).length === 0) {
      return { output: 'Hata: baslik veya durum verin.', isError: true };
    }
    const sid = getAgentSessionContext();
    const ok = gorevGuncelle(sid, id, patch);
    if (!ok) {
      return { output: `Görev bulunamadı: ${id}`, isError: true };
    }
    return { output: `Görev güncellendi: ${id}` };
  },
};
