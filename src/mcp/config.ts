/**
 * @fileoverview ~/.seth/mcp.json — standart MCP sunucu tanımları.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface McpServerEntry {
  readonly command: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
}

export interface McpConfigFile {
  readonly servers?: Record<string, McpServerEntry>;
}

const MCP_FILE = join(homedir(), '.seth', 'mcp.json');

export function loadMcpConfig(): McpConfigFile | null {
  if (!existsSync(MCP_FILE)) return null;
  try {
    return JSON.parse(readFileSync(MCP_FILE, 'utf-8')) as McpConfigFile;
  } catch {
    return null;
  }
}

export function getMcpServer(name: string): McpServerEntry | null {
  const cfg = loadMcpConfig();
  const s = cfg?.servers?.[name];
  if (!s?.command) return null;
  return s;
}

export function mcpConfigPath(): string {
  return MCP_FILE;
}
