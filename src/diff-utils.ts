/**
 * @fileoverview Diff Utils — dosya değişikliklerini context'li gösterir.
 * gemini-cli'nin diff-utils.ts'inden ilham alınmıştır.
 */

/**
 * İki metin arasındaki farkı context satırlarıyla göster.
 */
export function getDiffContextSnippet(
  original: string,
  updated: string,
  contextLines = 3,
): string {
  if (!original) return updated;
  if (original === updated) return '(değişiklik yok)';

  const origLines = original.split('\n');
  const newLines = updated.split('\n');

  // Basit satır bazlı diff
  const result: string[] = [];
  const maxLen = Math.max(origLines.length, newLines.length);
  const changedRanges: Array<{ start: number; end: number }> = [];

  let i = 0;
  while (i < maxLen) {
    if (origLines[i] !== newLines[i]) {
      const start = i;
      while (i < maxLen && origLines[i] !== newLines[i]) i++;
      changedRanges.push({ start, end: i });
    } else {
      i++;
    }
  }

  if (changedRanges.length === 0) return '(değişiklik yok)';

  // Context ile birleştir
  const shown = new Set<number>();
  for (const { start, end } of changedRanges) {
    for (let j = Math.max(0, start - contextLines); j < Math.min(newLines.length, end + contextLines); j++) {
      shown.add(j);
    }
  }

  let lastShown = -1;
  for (const lineIdx of [...shown].sort((a, b) => a - b)) {
    if (lastShown !== -1 && lineIdx > lastShown + 1) result.push('...');
    const origLine = origLines[lineIdx];
    const newLine = newLines[lineIdx];
    if (origLine !== newLine) {
      if (origLine !== undefined) result.push(`- ${origLine}`);
      if (newLine !== undefined) result.push(`+ ${newLine}`);
    } else {
      result.push(`  ${newLine ?? ''}`);
    }
    lastShown = lineIdx;
  }

  return result.join('\n');
}

/**
 * Değişiklik özetini üret.
 */
export function getDiffSummary(original: string, updated: string): string {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');
  let added = 0, removed = 0;

  const maxLen = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] === undefined) added++;
    else if (newLines[i] === undefined) removed++;
    else if (origLines[i] !== newLines[i]) { added++; removed++; }
  }

  return `+${added} -${removed} satır`;
}
