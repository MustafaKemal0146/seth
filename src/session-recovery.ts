/**
 * @fileoverview Oturum kurtarma — crash sonrası son oturumu kurtarır.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionData } from './types.js';

const RECOVERY_FILE = join(homedir(), '.seth', 'recovery.json');

/**
 * Aktif oturumu recovery dosyasına yaz (her turda çağrılır).
 */
export function writeRecoveryCheckpoint(session: SessionData): void {
  try {
    const dir = join(homedir(), '.seth');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(RECOVERY_FILE, JSON.stringify({
      sessionId: session.id,
      provider: session.provider,
      model: session.model,
      title: session.title,
      messageCount: session.messages.length,
      savedAt: new Date().toISOString(),
    }), 'utf-8');
  } catch { /* sessizce geç */ }
}

/**
 * Kurtarılabilir oturum var mı kontrol et.
 */
export function checkRecovery(): { sessionId: string; provider: string; model: string; title?: string; messageCount: number; savedAt: string } | null {
  if (!existsSync(RECOVERY_FILE)) return null;
  try {
    return JSON.parse(readFileSync(RECOVERY_FILE, 'utf-8'));
  } catch { return null; }
}

/**
 * Recovery dosyasını temizle (normal çıkışta).
 */
export function clearRecovery(): void {
  try {
    if (existsSync(RECOVERY_FILE)) {
      writeFileSync(RECOVERY_FILE, '', 'utf-8');
    }
  } catch { /* ignore */ }
}
