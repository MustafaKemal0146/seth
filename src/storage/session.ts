/**
 * @fileoverview Session persistence — JSON-based save/load.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
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

export function listSessions(): Array<{ id: string; provider: string; model: string; updatedAt: string }> {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('-yedek-'));
  return files.map(f => {
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as SessionData;
      return { id: data.id, provider: data.provider, model: data.model, updatedAt: data.updatedAt };
    } catch {
      return null;
    }
  }).filter((s): s is NonNullable<typeof s> => s !== null);
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
