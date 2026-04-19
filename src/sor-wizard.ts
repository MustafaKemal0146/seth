/**
 * @fileoverview /sor sihirbazı — clack kullanmaz; ana REPL readline duraklatıldığında
 * geçici readline ile sorar (Windows’ta çift çizim / tuş çakışması olmaz).
 */

import * as readline from 'readline/promises';

function dim(s: string): string {
  return `\u001b[2m${s}\u001b[22m`;
}

const GOALS = [
  { value: 'kod', label: 'Kod yaz / üret' },
  { value: 'debug', label: 'Hata ayıkla' },
  { value: 'refactor', label: 'Refactor / düzenle' },
  { value: 'aciklama', label: 'Açıkla / özetle' },
  { value: 'serbest', label: 'Serbest' },
] as const;

const STACKS = [
  { value: 'any', label: 'Farketmez / otomatik' },
  { value: 'ts', label: 'TypeScript / Node' },
  { value: 'py', label: 'Python' },
  { value: 'web', label: 'Web (HTML/CSS/JS)' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
] as const;

export type SorWizardResult =
  | { cancelled: true }
  | {
      cancelled: false;
      goal: (typeof GOALS)[number]['value'];
      dil: (typeof STACKS)[number]['value'];
      note: string;
    };

function parseChoice(line: string, max: number): number | null {
  const t = line.trim();
  if (t === '') return null;
  const n = parseInt(t, 10);
  if (Number.isNaN(n) || n < 1 || n > max) return null;
  return n;
}

/**
 * @param initialNote — /sor sonrası argüman metni (isteğe bağlı metin alanı için başlangıç)
 */
export async function runSorWizard(initialNote: string): Promise<SorWizardResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    process.stdout.write('\n');
    GOALS.forEach((g, i) => {
      process.stdout.write(`  ${i + 1}) ${g.label}\n`);
    });
    const gLine = await rl.question('  Seçim (1–5): ');
    const gNum = parseChoice(gLine, GOALS.length);
    if (gNum === null) return { cancelled: true };
    const goal = GOALS[gNum - 1]!.value;

    process.stdout.write('\n');
    STACKS.forEach((s, i) => {
      process.stdout.write(`  ${i + 1}) ${s.label}\n`);
    });
    const sLine = await rl.question('  Seçim (1–6): ');
    const sNum = parseChoice(sLine, STACKS.length);
    if (sNum === null) return { cancelled: true };
    const dil = STACKS[sNum - 1]!.value;

    process.stdout.write('\n');
    const hint = initialNote
      ? dim(`  (komut satırından: ${initialNote.slice(0, 120)}${initialNote.length > 120 ? '…' : ''})\n`)
      : '';
    process.stdout.write(`  İsteğinizi yazın (Enter = yalnızca yukarıdaki bağlamı kullan)\n${hint}`);
    const noteLine = await rl.question('  > ');
    const note = noteLine.trim() || initialNote.trim();

    return { cancelled: false, goal, dil, note };
  } finally {
    rl.close();
  }
}
