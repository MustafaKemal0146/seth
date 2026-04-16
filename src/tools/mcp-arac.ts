/**
 * @fileoverview MCP sunucusunda araç listeleme ve çağırma.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { getMcpServer, mcpConfigPath } from '../mcp/config.js';
import { McpStdioClient } from '../mcp/stdio-client.js';

export const mcpAracTool: ToolDefinition = {
  name: 'mcp_arac',
  description:
    'Yapılandırılmış MCP (Model Context Protocol) sunucusunda araçları listeler veya çağırır. ' +
    `Ayar dosyası: ${mcpConfigPath()} — "servers" altında sunucu adı, command ve args.`,
  inputSchema: {
    type: 'object',
    properties: {
      islem: {
        type: 'string',
        enum: ['listele', 'cagir'],
        description: 'listele: sunucudaki araçları göster; cagir: tek araç çalıştır',
      },
      sunucu: { type: 'string', description: 'mcp.json içindeki sunucu anahtarı' },
      arac_adi: { type: 'string', description: 'cagir için MCP araç adı' },
      argumanlar: {
        type: 'object',
        description: 'cagir için araç argümanları (JSON nesnesi)',
      },
    },
    required: ['islem', 'sunucu'],
  },
  isDestructive: false,
  requiresConfirmation: true,

  async execute(input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const islem = String(input.islem ?? '');
    const sunucu = String(input.sunucu ?? '').trim();
    if (!sunucu) {
      return { output: 'Hata: sunucu adı gerekli.', isError: true };
    }

    const entry = getMcpServer(sunucu);
    if (!entry) {
      return {
        output: `Sunucu "${sunucu}" bulunamadı. ${mcpConfigPath()} dosyasında "servers" tanımlayın.`,
        isError: true,
      };
    }

    const client = new McpStdioClient();
    try {
      await client.connect(entry);

      if (islem === 'listele') {
        const result = (await client.request('tools/list', {})) as {
          tools?: Array<{ name?: string; description?: string }>;
        };
        const tools = result?.tools ?? [];
        if (tools.length === 0) {
          return { output: '(Bu sunucuda araç listesi boş.)' };
        }
        const lines = tools.map(
          (t) => `• ${t.name ?? '?'}${t.description ? `\n  ${t.description.slice(0, 160)}` : ''}`,
        );
        return { output: lines.join('\n') };
      }

      if (islem === 'cagir') {
        const aracAdi = String(input.arac_adi ?? '').trim();
        if (!aracAdi) {
          return { output: 'Hata: cagir için arac_adi gerekli.', isError: true };
        }
        const argumanlar = (input.argumanlar as Record<string, unknown>) ?? {};
        const callResult = await client.request('tools/call', {
          name: aracAdi,
          arguments: argumanlar,
        });
        return { output: JSON.stringify(callResult, null, 2) };
      }

      return { output: `Geçersiz islem: ${islem}`, isError: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `MCP hatası: ${msg}`, isError: true };
    } finally {
      client.close();
    }
  },
};
