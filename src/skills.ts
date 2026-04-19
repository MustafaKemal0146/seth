/**
 * @fileoverview Skills sistemi — .seth/skills/ dizininden özel komutlar yükler.
 * gemini-cli'nin skillLoader.ts'inden ilham alınmıştır.
 *
 * Skill formatı (markdown frontmatter):
 * ---
 * name: skill-adi
 * description: Ne yapar
 * ---
 * Skill içeriği buraya...
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  location: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?/;

function parseFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const fm = match[1] ?? '';
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descMatch) return null;
  return { name: nameMatch[1]!.trim(), description: descMatch[1]!.trim() };
}

/**
 * Skills dizinlerinden skill'leri yükle.
 * Sıra: ~/.seth/skills/ → ./.seth/skills/
 */
export function loadSkills(cwd: string): SkillDefinition[] {
  const dirs = [
    join(homedir(), '.seth', 'skills'),
    join(cwd, '.seth', 'skills'),
  ];

  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
      for (const file of files) {
        const filePath = join(dir, file);
        const content = readFileSync(filePath, 'utf-8');
        const fm = parseFrontmatter(content);
        if (!fm) continue;
        if (seen.has(fm.name)) continue; // cwd override
        seen.add(fm.name);
        const bodyMatch = content.match(FRONTMATTER_RE);
        const body = bodyMatch?.[2]?.trim() ?? content.trim();
        skills.push({ name: fm.name, description: fm.description, body, location: filePath });
      }
    } catch { /* ignore */ }
  }

  return skills;
}

/**
 * Skill'i sistem promptuna eklenecek formata çevir.
 */
export function formatSkillsForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';
  const lines = ['', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'YÜKLÜ SKİLL\'LER', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
  for (const s of skills) {
    lines.push(`\n## ${s.name}\n${s.description}\n\n${s.body}`);
  }
  return lines.join('\n');
}
