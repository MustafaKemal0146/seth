/**
 * @fileoverview Kayıtlı araçları ada veya açıklamada arar (ToolSearch benzeri).
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { kayitliAraclariOku } from '../session-runtime.js';

export const aracAraTool: ToolDefinition = {
  name: 'arac_ara',
  description:
    'Hangi yerleşik aracın ne işe yaradığını bulmak için kullan. ' +
    'Sorgu, araç adında veya açıklama metninde (büyük/küçük harf duyarsız) aranır.',
  inputSchema: {
    type: 'object',
    properties: {
      sorgu: { type: 'string', description: 'Aranacak kelime veya kısa ifade' },
      limit: { type: 'number', description: 'En fazla kaç sonuç. Varsayılan: 8' },
    },
    required: ['sorgu'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const q = String(input.sorgu ?? '').trim().toLowerCase();
    const limit = Math.min(20, Math.max(1, Number(input.limit) || 8));
    if (!q) {
      return { output: 'Hata: sorgu boş olamaz.', isError: true };
    }

    const tools = kayitliAraclariOku();
    if (tools.length === 0) {
      return {
        output:
          'Henüz araç özeti yüklenmedi (iç hata). REPL yeniden başlatmayı deneyin.',
        isError: true,
      };
    }

    const hits = tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );

    const slice = hits.slice(0, limit);
    if (slice.length === 0) {
      return { output: `“${input.sorgu}” için eşleşen araç yok.` };
    }

    const lines = slice.map((t) => `• ${t.name}\n  ${t.description.slice(0, 200)}${t.description.length > 200 ? '…' : ''}`);
    return { output: lines.join('\n\n') };
  },
};
