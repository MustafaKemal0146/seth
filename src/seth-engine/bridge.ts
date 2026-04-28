/**
 * Seth Engine — SETH için arka plan sunucu yöneticisi
 *
 * SETH açılırken Seth Engine server'ını background'da başlatır,
 * MCP config'e otomatik ekler, kapanırken temizler.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { registerCleanup } from '../lifecycle.js';

const ENGINE_PORT = 8888;
const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

let serverProcess: ChildProcess | null = null;

/**
 * Seth Engine server'ını background'da başlat.
 * SETH lifecycle'ında çağrılır.
 */
export function startSethEngine(): void {
  if (serverProcess) return;

  const serverScript = join(ENGINE_DIR, 'seth_engine_server.py');
  if (!existsSync(serverScript)) return;

  try {
    serverProcess = spawn('python3', [serverScript], {
      stdio: 'pipe',
      env: {
        ...process.env,
        SETH_ENGINE_PORT: String(ENGINE_PORT),
        PYTHONUNBUFFERED: '1',
      },
      detached: false,
    });

    serverProcess.stdout?.on('data', () => {});
    serverProcess.stderr?.on('data', () => {});
    serverProcess.on('error', () => { serverProcess = null; });
    serverProcess.on('exit', () => { serverProcess = null; });

    registerEngineMcp();
    registerCleanup(async () => { stopSethEngine(); });
  } catch {
    serverProcess = null;
  }
}

/**
 * Seth Engine server'ını durdur.
 */
export function stopSethEngine(): void {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      if (serverProcess) {
        try { serverProcess.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, 3000);
    serverProcess = null;
  }
}

/**
 * ~/.seth/mcp.json dosyasına Seth Engine girişini ekle.
 */
function registerEngineMcp(): void {
  const configDir = join(homedir(), '.seth');
  const configPath = join(configDir, 'mcp.json');

  if (!existsSync(configDir)) {
    try { mkdirSync(configDir, { recursive: true }); } catch { return; }
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { config = {}; }
  }

  const servers: Record<string, unknown> = (config.mcpServers as Record<string, unknown>) ?? {};

  if (!servers['seth-engine']) {
    const mcpScript = join(ENGINE_DIR, 'seth_engine_mcp.py');
    servers['seth-engine'] = {
      command: 'python3',
      args: [mcpScript, '--server', `http://localhost:${ENGINE_PORT}`],
    };
    config.mcpServers = servers;
    try { writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8'); } catch { /* ignore */ }
  }
}
