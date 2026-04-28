/**
 * Seth Engine MCP tool'larını SETH tool registry'sine dinamik olarak kaydeder.
 *
 * SETH başlarken Seth Engine MCP server'a bağlanır, tüm tool'ları keşfeder
 * ve her birini SETH'in kendi tool'u gibi kaydeder. AI direkt olarak
 * `nmap_scan`, `sqlmap_scan` gibi isimlerle çağırabilir.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { getMcpServer } from '../mcp/config.js';
import { McpStdioClient } from '../mcp/stdio-client.js';
import { ToolRegistry } from '../tools/registry.js';

const SERVER_NAME = 'seth-engine';
let registered = false;

/**
 * Seth Engine MCP tool'larını keşfedip SETH registry'sine kaydeder.
 */
export async function registerSethEngineTools(registry: ToolRegistry): Promise<number> {
  if (registered) return 0;

  const entry = getMcpServer(SERVER_NAME);
  if (!entry) return 0;

  const client = new McpStdioClient();
  try {
    await client.connect(entry);

    const result = (await client.request('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };

    const mcpTools = result?.tools ?? [];
    let count = 0;

    for (const mcpTool of mcpTools) {
      const toolName = mcpTool.name;
      const toolDesc = mcpTool.description ?? `Seth Engine: ${toolName}`;
      const schema = mcpTool.inputSchema ?? { type: 'object', properties: {} };

      if (!registry.has(toolName)) {
        const toolDef: ToolDefinition = {
          name: toolName,
          description: toolDesc,
          inputSchema: {
            type: schema.type ?? 'object',
            properties: schema.properties ?? {},
            required: schema.required as string[] | undefined,
          },
          isDestructive: isDestructiveTool(toolName),
          requiresConfirmation: isDestructiveTool(toolName),
          execute: createEngineExecutor(toolName),
        };

        try { registry.register(toolDef); count++; } catch { /* isim çakışması */ }
      }
    }

    registered = true;
    return count;
  } catch {
    return 0;
  } finally {
    client.close();
  }
}

function createEngineExecutor(toolName: string) {
  return async (input: Record<string, unknown>, _cwd: string): Promise<ToolResult> => {
    const entry = getMcpServer(SERVER_NAME);
    if (!entry) {
      return { output: "Seth Engine sunucusu bulunamadı. SETH\u2018i yeniden başlatın.", isError: true };
    }

    const client = new McpStdioClient();
    try {
      await client.connect(entry);
      const callResult = await client.request('tools/call', {
        name: toolName,
        arguments: input,
      });
      return { output: JSON.stringify(callResult, null, 2) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Seth Engine hatası (${toolName}): ${msg}`, isError: true };
    } finally { client.close(); }
  };
}

function isDestructiveTool(name: string): boolean {
  const destructive = [
    'exploit', 'payload', 'sqlmap', 'metasploit', 'hydra', 'hashcat', 'john',
    'rce', 'shell', 'execute', 'delete', 'modify', 'pacu', 'msfvenom',
    'buffer_overflow', 'deserialization', 'xxe', 'auth_bypass',
  ];
  return destructive.some((k) => name.toLowerCase().includes(k));
}
