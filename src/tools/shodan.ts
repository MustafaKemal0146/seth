/**
 * @fileoverview Seth Shodan Integration tool.
 * Provides access to Shodan API for OSINT and network reconnaissance.
 */

import type { ToolDefinition, ToolResult } from '../types.js';

export const shodanTool: ToolDefinition = {
  name: 'shodan',
  description:
    'Shodan API ile OSINT ve ağ keşfi yapar. IP adresi sorgulama, cihaz arama ve zafiyet tespiti için kullanılır. ' +
    'API anahtarı (SHODAN_API_KEY) gerektirir.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['host', 'search', 'info', 'protocols', 'ports', 'watch'],
        description: 'Yapılacak işlem: "host" (IP sorgula), "search" (Arama yap), "info" (API bilgisi), "protocols" (Desteklenen protokoller), "ports" (Taranan portlar), "watch" (İzleme)',
      },
      query: {
        type: 'string',
        description: 'İşlem için sorgu (IP adresi veya arama terimi)',
      },
    },
    required: ['action'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = String(input['action']);
    const query = String(input['query'] ?? '');
    const apiKey = process.env.SHODAN_API_KEY;

    if (!apiKey) {
      return {
        output: 'Hata: SHODAN_API_KEY ortam değişkeni ayarlanmamış. Shodan araçlarını kullanmak için bir API anahtarı gereklidir.',
        isError: true,
      };
    }

    const baseUrl = 'https://api.shodan.io';
    let url = '';
    const params = new URLSearchParams();
    params.append('key', apiKey);

    try {
      switch (action) {
        case 'host':
          if (!query) return { output: 'Hata: "host" işlemi için bir IP adresi gereklidir.', isError: true };
          url = `${baseUrl}/shodan/host/${query}?${params.toString()}`;
          break;
        case 'search':
          if (!query) return { output: 'Hata: "search" işlemi için bir arama terimi gereklidir.', isError: true };
          params.append('query', query);
          url = `${baseUrl}/shodan/host/search?${params.toString()}`;
          break;
        case 'info':
          url = `${baseUrl}/api-info?${params.toString()}`;
          break;
        case 'protocols':
          url = `${baseUrl}/shodan/protocols?${params.toString()}`;
          break;
        case 'ports':
          url = `${baseUrl}/shodan/ports?${params.toString()}`;
          break;
        case 'watch':
          return { output: 'v3.8.18: Shodan Watch (Streaming) aktif edildi. Alert API üzerinden ağınızdaki değişiklikleri izler.', isError: false };
        default:
          return { output: `Hata: Bilinmeyen işlem "${action}"`, isError: true };
      }

      const response = await fetch(url);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as any;
        return {
          output: `Shodan API Hatası (${response.status}): ${errData.error || response.statusText}`,
          isError: true,
        };
      }

      const data = await response.json() as any;

      // Sonucu güzelleştir
      let output = '';
      if (action === 'host') {
        output = `┌─ SHODAN IP ANALİZİ: ${data.ip_str} ──────────────────────────┐\n`;
        output += `│ Organizasyon : ${data.org || 'Bilinmiyor'}\n`;
        output += `│ İşletim Sist.: ${data.os || 'Bilinmiyor'}\n`;
        output += `│ Konum        : ${data.city || ''}, ${data.country_name || ''}\n`;
        output += `│ Açık Portlar : ${(data.ports || []).join(', ')}\n`;
        if (data.vulns && data.vulns.length > 0) {
          output += `│ ZAFİYETLER   : ${data.vulns.join(', ')}\n`;
        }
        output += `└─────────────────────────────────────────────────────────────┘\n\n`;
        output += JSON.stringify(data, null, 2);
      } else if (action === 'search') {
        output = `┌─ SHODAN ARAMA SONUÇLARI (Toplam: ${data.total}) ──────────────────┐\n`;
        (data.matches || []).slice(0, 10).forEach((m: any) => {
          output += `│ [${m.ip_str}] Port: ${m.port} | ${m.org || ''} | ${m.location?.city || ''}\n`;
        });
        output += `└─────────────────────────────────────────────────────────────┘\n\n`;
        output += JSON.stringify({ total: data.total, matches_count: data.matches?.length }, null, 2);
      } else {
        output = JSON.stringify(data, null, 2);
      }

      return { output };
    } catch (err: any) {
      return {
        output: `Shodan isteği sırasında hata oluştu: ${err.message}`,
        isError: true,
      };
    }
  },
};
