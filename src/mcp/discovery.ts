/**
 * @fileoverview MCP server otomatik keşif — npm'den @modelcontextprotocol paketlerini bulur.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const execFileAsync = promisify(execFile);

export interface McpServerInfo {
  name: string;
  package: string;
  description: string;
}

const KNOWN_MCP_SERVERS: McpServerInfo[] = [
  { name: 'filesystem', package: '@modelcontextprotocol/server-filesystem', description: 'Dosya sistemi erişimi' },
  { name: 'github', package: '@modelcontextprotocol/server-github', description: 'GitHub API' },
  { name: 'postgres', package: '@modelcontextprotocol/server-postgres', description: 'PostgreSQL veritabanı' },
  { name: 'sqlite', package: '@modelcontextprotocol/server-sqlite', description: 'SQLite veritabanı' },
  { name: 'brave-search', package: '@modelcontextprotocol/server-brave-search', description: 'Brave arama' },
  { name: 'puppeteer', package: '@modelcontextprotocol/server-puppeteer', description: 'Web tarayıcı otomasyonu' },
  { name: 'memory', package: '@modelcontextprotocol/server-memory', description: 'Kalıcı bellek' },
  { name: 'fetch', package: '@modelcontextprotocol/server-fetch', description: 'HTTP fetch' },
];

/**
 * Yüklü MCP server'ları keşfet.
 */
export async function discoverMcpServers(): Promise<McpServerInfo[]> {
  const results = await Promise.allSettled(
    KNOWN_MCP_SERVERS.map(async (server) => {
      await execFileAsync('npx', ['--yes', server.package, '--version'], { timeout: 3000 });
      return server;
    })
  );

  const found: McpServerInfo[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      found.push(result.value);
    }
  }
  return found;
}

/**
 * MCP config dosyasına server ekle.
 */
export function addMcpServerToConfig(server: McpServerInfo, args: string[] = []): void {
  const configPath = join(homedir(), '.seth', 'mcp.json');
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* ignore */ }
  }
  const servers = (config.mcpServers as Record<string, unknown>) ?? {};
  servers[server.name] = {
    command: 'npx',
    args: ['-y', server.package, ...args],
  };
  config.mcpServers = servers;
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
