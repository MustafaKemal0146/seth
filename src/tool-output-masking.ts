/**
 * @fileoverview Tool Output Masking — araç çıktısındaki hassas bilgileri maskeler.
 * gemini-cli'nin toolOutputMaskingService.ts'inden ilham alınmıştır.
 */

// Hassas pattern'lar
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API key'ler
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g, replacement: 'sk-***' },
  { pattern: /\b(AIza[a-zA-Z0-9_-]{35})\b/g, replacement: 'AIza***' },
  { pattern: /\b(gsk_[a-zA-Z0-9]{20,})\b/g, replacement: 'gsk_***' },
  { pattern: /\b(xai-[a-zA-Z0-9]{20,})\b/g, replacement: 'xai-***' },
  // Bearer token'lar
  { pattern: /Bearer\s+([a-zA-Z0-9._-]{20,})/g, replacement: 'Bearer ***' },
  // Şifreler (key=value formatında)
  { pattern: /(?:password|passwd|secret|token|key)\s*[=:]\s*["']?([^\s"']{8,})["']?/gi, replacement: '***' },
  // JWT token'lar
  { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: 'eyJ***.[JWT]' },
  // Private key başlıkları
  { pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: '[PRIVATE KEY MASKELENDI]' },
];

/**
 * Araç çıktısındaki hassas bilgileri maskele.
 */
export function maskSensitiveOutput(output: string): { masked: string; count: number } {
  let masked = output;
  let count = 0;

  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    const before = masked;
    masked = masked.replace(pattern, replacement);
    if (masked !== before) count++;
  }

  return { masked, count };
}

/**
 * Çıktıda hassas bilgi var mı kontrol et.
 */
export function hasSensitiveContent(output: string): boolean {
  return SENSITIVE_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(output);
  });
}
