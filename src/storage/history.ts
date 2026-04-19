/**
 * Kalıcı komut geçmişi — ~/.seth/history.jsonl
 * Oturumlar arası ↑↓ ok tuşu geçmişi ve paste store.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';

const SETH_DIR = join(homedir(), '.seth');
const HISTORY_FILE = join(SETH_DIR, 'history.jsonl');
const PASTE_DIR = join(SETH_DIR, 'paste-store');
const MAX_HISTORY = 500;
const PASTE_INLINE_LIMIT = 1024; // Bu kadardan büyükse dosyaya yaz

function ensureDirs() {
  if (!existsSync(SETH_DIR)) mkdirSync(SETH_DIR, { recursive: true });
  if (!existsSync(PASTE_DIR)) mkdirSync(PASTE_DIR, { recursive: true });
}

export interface HistoryEntry {
  text: string;
  timestamp: number;
  pasteHash?: string; // büyük paste için referans
}

// ─── Geçmiş Yükleme ──────────────────────────────────────────────────────────

export function loadHistory(): string[] {
  try {
    ensureDirs();
    if (!existsSync(HISTORY_FILE)) return [];
    const lines = readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { /* skip */ }
    }
    // En yeni önce, tekrarları kaldır
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const t = entries[i]!.text;
      if (!seen.has(t)) { seen.add(t); result.push(t); }
    }
    return result.slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

// ─── Geçmişe Ekleme ──────────────────────────────────────────────────────────

export function addToHistory(text: string): void {
  if (!text.trim()) return;
  try {
    ensureDirs();
    const entry: HistoryEntry = { text, timestamp: Date.now() };
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch { /* sessizce geç */ }
}

// ─── Paste Store ─────────────────────────────────────────────────────────────

export function storePaste(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  if (content.length > PASTE_INLINE_LIMIT) {
    try {
      ensureDirs();
      const file = join(PASTE_DIR, hash);
      if (!existsSync(file)) writeFileSync(file, content, { mode: 0o600 });
    } catch { /* sessizce geç */ }
  }
  return hash;
}

export function retrievePaste(hash: string): string | null {
  try {
    const file = join(PASTE_DIR, hash);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  } catch { /* */ }
  return null;
}
