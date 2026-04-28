/**
 * @fileoverview Session persistence — JSON-based save/load.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { SessionData, ChatMessage, ProviderName, TokenUsage } from '../types.js';
import { getSessionsDir } from '../config/settings.js';

export function createSession(provider: ProviderName, model: string): SessionData {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    provider,
    model,
    messages: [],
    messagesLaneB: [],
    activeLane: 'a',
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export function saveSession(session: SessionData): string {
  const dir = getSessionsDir();
  const filePath = join(dir, `${session.id}.json`);
  const data = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

/** Yedek dosyası: aynı oturum kimliği, zaman damgalı. */
export function saveSessionBackup(session: SessionData): string {
  const dir = getSessionsDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(dir, `${session.id}-yedek-${ts}.json`);
  writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

export function loadSession(sessionId: string): SessionData | null {
  const dir = getSessionsDir();
  const filePath = join(dir, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as SessionData;
  } catch {
    return null;
  }
}

export function listSessions(): Array<{ id: string; provider: string; model: string; updatedAt: string; tag?: string }> {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('-yedek-'));

  return files.map(f => {
    const filePath = join(dir, f);
    try {
      const stats = statSync(filePath);

      // Optimizasyon: Sadece dosyanın başını ve sonunu oku.
      // id, provider, model genelde baştadır. updatedAt ise genelde sondadır.
      const fd = openSync(filePath, 'r');

      try {
        const startSize = Math.min(1000, stats.size);
        const startBuffer = Buffer.alloc(startSize);
        readSync(fd, startBuffer, 0, startSize, 0);
        const startStr = startBuffer.toString('utf-8');

        const idMatch = startStr.match(/"id"\s*:\s*"([^"]+)"/);
        const providerMatch = startStr.match(/"provider"\s*:\s*"([^"]+)"/);
        const modelMatch = startStr.match(/"model"\s*:\s*"([^"]+)"/);
        const tagMatch = startStr.match(/"tag"\s*:\s*"([^"]+)"/);

        const endSize = Math.min(500, stats.size);
        const endBuffer = Buffer.alloc(endSize);
        readSync(fd, endBuffer, 0, endSize, Math.max(0, stats.size - endSize));
        const endStr = endBuffer.toString('utf-8');

        const updatedAtMatch = endStr.match(/"updatedAt"\s*:\s*"([^"]+)"/) || startStr.match(/"updatedAt"\s*:\s*"([^"]+)"/);

        if (idMatch && providerMatch && modelMatch) {
          return {
            id: idMatch[1],
            provider: providerMatch[1],
            model: modelMatch[1],
            updatedAt: updatedAtMatch ? updatedAtMatch[1] : '',
            tag: tagMatch ? tagMatch[1] : undefined
          };
        }
      } finally {
        closeSync(fd);
      }

      // Fallback: Eger regex ile bulamazsak tüm dosyayı parse et (küçük olasılık ama doğruluğu garanti eder)
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionData;
      return { id: data.id, provider: data.provider, model: data.model, updatedAt: data.updatedAt, tag: data.tag };

    } catch (err) {
      if (process.env.SETH_DEBUG) console.error('[seth:session] listSessions failed', err);
      return null;
    }
  }).filter((s): s is NonNullable<typeof s> => s !== null);
}

export function setSessionTag(sessionId: string, tag: string): boolean {
  const session = loadSession(sessionId);
  if (!session) return false;
  saveSession({ ...session, tag });
  return true;
}

export function updateSessionMessages(
  session: SessionData,
  laneA: ChatMessage[],
  laneB: ChatMessage[],
  activeLane: 'a' | 'b',
  usage: TokenUsage,
): SessionData {
  return {
    ...session,
    messages: laneA,
    messagesLaneB: laneB,
    activeLane,
    tokenUsage: {
      inputTokens: session.tokenUsage.inputTokens + usage.inputTokens,
      outputTokens: session.tokenUsage.outputTokens + usage.outputTokens,
    },
    updatedAt: new Date().toISOString(),
  };
}
