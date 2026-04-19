/**
 * @fileoverview Prompt öneri sistemi — geçmiş komutlardan akıllı öneri.
 */

import { loadHistory } from './storage/history.js';

/**
 * Kullanıcının yazmaya başladığı metne göre geçmişten öneri döndür.
 */
export function getPromptSuggestions(prefix: string, limit = 5): string[] {
  if (!prefix || prefix.length < 2) return [];
  const history = loadHistory();
  const q = prefix.toLowerCase();
  
  // Tam prefix eşleşmesi önce
  const exact = history.filter(h => h.toLowerCase().startsWith(q));
  // Sonra içeren
  const contains = history.filter(h => !h.toLowerCase().startsWith(q) && h.toLowerCase().includes(q));
  
  return [...exact, ...contains].slice(0, limit);
}

/**
 * Sık kullanılan komutları döndür.
 */
export function getFrequentCommands(limit = 5): string[] {
  const history = loadHistory();
  const freq: Record<string, number> = {};
  
  for (const h of history) {
    const key = h.slice(0, 50); // İlk 50 karakter
    freq[key] = (freq[key] ?? 0) + 1;
  }
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cmd]) => cmd);
}
