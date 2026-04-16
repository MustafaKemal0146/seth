/**
 * Bellek sistemi — ~/.seth/memory/
 * user.md, project.md, feedback.md, reference.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MEMORY_DIR = join(homedir(), '.seth', 'memory');

export type MemoryType = 'user' | 'project' | 'feedback' | 'reference';

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

export function readMemory(type: MemoryType): string {
  ensureDir();
  const file = join(MEMORY_DIR, `${type}.md`);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

export function writeMemory(type: MemoryType, content: string): void {
  ensureDir();
  writeFileSync(join(MEMORY_DIR, `${type}.md`), content, { mode: 0o600 });
}

export function appendMemory(type: MemoryType, entry: string): void {
  const existing = readMemory(type);
  const ts = new Date().toISOString().slice(0, 10);
  writeMemory(type, existing + `\n- [${ts}] ${entry.trim()}`);
}

export function loadAllMemories(): string {
  const types: MemoryType[] = ['user', 'project', 'feedback', 'reference'];
  const parts: string[] = [];
  for (const t of types) {
    const content = readMemory(t);
    if (content.trim()) parts.push(`## ${t}\n${content.trim()}`);
  }
  return parts.join('\n\n');
}
