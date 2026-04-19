/**
 * Hook sistemi — ~/.seth/hooks.json
 * PreToolUse / PostToolUse / OnResponse hook'ları
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync, exec } from 'child_process';

const HOOKS_FILE = join(homedir(), '.seth', 'hooks.json');

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'OnResponse' | 'OnStart';

export interface Hook {
  event: HookEvent;
  tool?: string;       // araç filtresi, örn: "shell", "*"
  command: string;     // çalıştırılacak shell komutu
  async?: boolean;     // arka planda çalıştır
  once?: boolean;      // bir kez çalıştır sonra sil
}

let hooks: Hook[] = [];
let loaded = false;

export function loadHooks(): Hook[] {
  if (loaded) return hooks;
  loaded = true;
  if (!existsSync(HOOKS_FILE)) return hooks;
  try {
    hooks = JSON.parse(readFileSync(HOOKS_FILE, 'utf8'));
  } catch { hooks = []; }
  return hooks;
}

export function runHooks(event: HookEvent, toolName?: string, context?: Record<string, string>): void {
  const all = loadHooks();
  const matching = all.filter(h =>
    h.event === event && (!h.tool || h.tool === '*' || h.tool === toolName)
  );
  for (const hook of matching) {
    try {
      let cmd = hook.command;
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          cmd = cmd.replace(`$${k}`, v);
        }
      }
      if (hook.async) {
        exec(cmd);
      } else {
        execSync(cmd, { stdio: 'ignore', timeout: 10000 });
      }
    } catch { /* hook hatası sessizce geç */ }
  }
}

export function getHooksExample(): string {
  return JSON.stringify([
    { event: 'PreToolUse', tool: 'file_write', command: 'echo "Dosya yazılıyor: $path"' },
    { event: 'PostToolUse', tool: 'shell', command: 'echo "Komut tamamlandı"', async: true },
    { event: 'OnResponse', command: 'notify-send "SETH" "Yanıt hazır"', async: true },
  ], null, 2);
}
