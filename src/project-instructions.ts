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
  { label: 'SETH.md', relativePath: 'SETH.md' },
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
  const gitOpts = {
    cwd,
    stdio: 'pipe' as const,
    timeout: 5_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  };
  try {
    const isGit = execSync('git --no-pager rev-parse --is-inside-work-tree', gitOpts).toString().trim() === 'true';
    if (!isGit) return '';
    const branch = execSync('git --no-pager branch --show-current', gitOpts).toString().trim();
    let status = execSync('git --no-pager status --short', gitOpts).toString().trim();
    const log = execSync('git --no-pager log --oneline -n 3', gitOpts).toString().trim();
    if (status.length > 2000) status = status.slice(0, 2000) + '\n... (çok uzun, kesildi)';

    return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGİT DURUMU\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGeçerli dal: ${branch}\nDurum:\n${status || '(temiz)'}\n\nSon commitler:\n${log}\n`;
  } catch (err) {
    if (process.env.SETH_DEBUG) console.error('[seth:project-instructions] getGitStatus failed', err);
    return '';
  }
}

function getCurrentDate(): string {
  const date = new Date().toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short' });
  return `Bugünün tarihi: ${date}\n\n`;
}

/** Tam sistem istemi: çekirdek + proje kökü talimatları + otomatik bellek. */
export function buildSystemPrompt(cwd: string): string {
  let base = getCurrentDate() + SYSTEM_PROMPT_TR.replace('{{CWD}}', cwd).replace('{{OS_TYPE}}', osTypeLabel());
  base += getGitStatus(cwd);
  const extra = loadProjectInstructionBlock(cwd);
  if (extra) base += extra;
  return base;
}
