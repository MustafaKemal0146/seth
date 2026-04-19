/**
 * @fileoverview Tüm geçmiş oturumlarda full-text arama.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getSessionsDir } from './config/settings.js';
import type { SessionData } from './types.js';

export interface SessionSearchResult {
  sessionId: string;
  provider: string;
  model: string;
  createdAt: string;
  matchCount: number;
  preview: string;
}

/**
 * Tüm oturumlarda arama yap.
 */
export async function searchAllSessions(query: string): Promise<SessionSearchResult[]> {
  const sessionsDir = getSessionsDir();
  const files = await readdir(sessionsDir).catch(() => []);
  const results: SessionSearchResult[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(sessionsDir, file), 'utf-8');
      const session = JSON.parse(raw) as SessionData;
      
      let matchCount = 0;
      let preview = '';
      const q = query.toLowerCase();

      for (const msg of session.messages) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (text.toLowerCase().includes(q)) {
          matchCount++;
          if (!preview) {
            const idx = text.toLowerCase().indexOf(q);
            const start = Math.max(0, idx - 40);
            const end = Math.min(text.length, idx + query.length + 40);
            preview = text.slice(start, end);
          }
        }
      }

      if (matchCount > 0) {
        results.push({
          sessionId: session.id,
          provider: session.provider,
          model: session.model,
          createdAt: session.createdAt,
          matchCount,
          preview,
        });
      }
    } catch { /* skip malformed */ }
  }

  return results.sort((a, b) => b.matchCount - a.matchCount);
}
