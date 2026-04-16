/**
 * @fileoverview Proje kökündeki talimat dosyalarını okuyup sistem istemine ekler.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { SYSTEM_PROMPT_TR } from './prompts/system.js';

const MAX_INSTRUCTION_CHARS = 24_000;

const INSTRUCTION_FILES: { label: string; relativePath: string }[] = [
  { label: 'CLAUDE.md', relativePath: 'CLAUDE.md' },
  { label: 'AGENTS.md', relativePath: 'AGENTS.md' },
  { label: '.seth/instructions.md', relativePath: join('.seth', 'instructions.md') },
  { label: 'KALICI BELLEK', relativePath: join('.seth', 'memory.md') },
];

function readIfPresent(cwd: string, rel: string): string | null {
  const full = join(cwd, rel);
  try {
    if (!existsSync(full)) return null;
    const st = statSync(full);
    if (!st.isFile()) return null;
    return readFileSync(full, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Proje talimatlarını birleştirir; toplam uzunluk MAX_INSTRUCTION_CHARS ile sınırlı.
 */
export function loadProjectInstructionBlock(cwd: string): string {
  const parts: string[] = [];
  let total = 0;

  for (const { label, relativePath } of INSTRUCTION_FILES) {
    const text = readIfPresent(cwd, relativePath);
    if (text === null || !text.trim()) continue;

    const header = `\n--- Proje: ${label} ---\n`;
    const chunk = header + text.trimEnd() + '\n';
    if (total + chunk.length <= MAX_INSTRUCTION_CHARS) {
      parts.push(chunk);
      total += chunk.length;
      continue;
    }

    const remaining = MAX_INSTRUCTION_CHARS - total - header.length - 80;
    if (remaining < 200) break;

    const truncated = text.trimEnd().slice(0, remaining) + '\n[... kısaltıldı]\n';
    parts.push(header + truncated);
    break;
  }

  if (parts.length === 0) return '';

  return (
    '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'PROJE TALİMATLARI (otomatik yüklendi)\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' +
      parts.join('')
  );
}

function osTypeLabel(): string {
  return os.type() === 'Windows_NT' ? 'Windows (PowerShell)' : 'Linux/macOS (Bash)';
}

function getGitStatus(cwd: string): string {
  try {
    const isGit = execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' }).toString().trim() === 'true';
    if (!isGit) return '';
    const branch = execSync('git branch --show-current', { cwd, stdio: 'pipe' }).toString().trim();
    let status = execSync('git status --short', { cwd, stdio: 'pipe' }).toString().trim();
    const log = execSync('git log --oneline -n 3', { cwd, stdio: 'pipe' }).toString().trim();
    if (status.length > 2000) status = status.slice(0, 2000) + '\n... (çok uzun, kesildi)';
    
    return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGİT DURUMU\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGeçerli dal: ${branch}\nDurum:\n${status || '(temiz)'}\n\nSon commitler:\n${log}\n`;
  } catch {
    return '';
  }
}

function getCurrentDate(): string {
  const date = new Date().toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short' });
  return `Bugünün tarihi: ${date}\n\n`;
}

/** Tam sistem istemi: çekirdek + proje kökü talimatları. */
export function buildSystemPrompt(cwd: string): string {
  let base = getCurrentDate() + SYSTEM_PROMPT_TR.replace('{{CWD}}', cwd).replace('{{OS_TYPE}}', osTypeLabel());
  base += getGitStatus(cwd);
  const extra = loadProjectInstructionBlock(cwd);
  return extra ? `${base}${extra}` : base;
}
