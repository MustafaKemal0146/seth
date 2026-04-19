/**
 * @fileoverview Omission Placeholder Detector — AI'nın "..." veya placeholder
 * bırakıp bırakmadığını tespit eder.
 * gemini-cli'nin omissionPlaceholderDetector.ts'inden ilham alınmıştır.
 */

const OMITTED_PREFIXES = new Set([
  'rest of',
  'rest of method',
  'rest of code',
  'unchanged code',
  'unchanged method',
  'existing code',
  'previous code',
  'kalan kod',
  'geri kalan',
  'değişmeyen kod',
]);

const OMISSION_PATTERNS = [
  /^\s*\.{3,}\s*$/m,                          // sadece "..."
  /^\s*\/\/\s*\.{3,}\s*$/m,                   // // ...
  /^\s*#\s*\.{3,}\s*$/m,                      // # ...
  /^\s*\/\*\s*\.{3,}\s*\*\/\s*$/m,            // /* ... */
  /\[\s*\.{3,}\s*\]/,                          // [...]
  /\(\s*\.{3,}\s*\)/,                          // (...)
  /\/\/\s*TODO.*omit/i,
  /\/\/\s*rest of/i,
  /#\s*rest of/i,
];

/**
 * AI yanıtında omission placeholder var mı kontrol et.
 */
export function detectOmissionPlaceholder(text: string): boolean {
  // Pattern kontrolü
  for (const pattern of OMISSION_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  // Satır bazlı kontrol
  const lines = text.split('\n');
  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    for (const prefix of OMITTED_PREFIXES) {
      if (normalized.startsWith(prefix)) return true;
    }
  }

  return false;
}

/**
 * Omission uyarı mesajı üret.
 */
export function getOmissionWarning(): string {
  return '\n⚠️  Yanıtta eksik/kısaltılmış kod tespit edildi. Tam kodu yazmamı ister misiniz?';
}
