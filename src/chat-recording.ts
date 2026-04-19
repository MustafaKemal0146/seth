/**
 * @fileoverview Chat Recording — konuşmaları JSONL formatında kaydeder.
 * gemini-cli'nin chatRecordingService.ts'inden ilham alınmıştır.
 *
 * Her mesaj ~/.seth/recordings/<session-id>.jsonl dosyasına eklenir.
 * Analiz, arama ve replay için kullanılabilir.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ChatMessage } from './types.js';

const RECORDINGS_DIR = join(homedir(), '.seth', 'recordings');

export interface MessageRecord {
  timestamp: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount?: number;
}

function ensureDir(): void {
  if (!existsSync(RECORDINGS_DIR)) mkdirSync(RECORDINGS_DIR, { recursive: true });
}

/**
 * Mesajı JSONL dosyasına kaydet.
 */
export function recordMessage(sessionId: string, message: ChatMessage, tokenCount?: number): void {
  try {
    ensureDir();
    const record: MessageRecord = {
      timestamp: new Date().toISOString(),
      sessionId,
      role: message.role as MessageRecord['role'],
      content: typeof message.content === 'string'
        ? message.content.slice(0, 2000) // Max 2000 char
        : JSON.stringify(message.content).slice(0, 2000),
      tokenCount,
    };
    const filePath = join(RECORDINGS_DIR, `${sessionId}.jsonl`);
    appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch { /* sessizce geç */ }
}

/**
 * Oturum kaydını oku.
 */
export function readRecording(sessionId: string): MessageRecord[] {
  try {
    const filePath = join(RECORDINGS_DIR, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line) as MessageRecord);
  } catch { return []; }
}
