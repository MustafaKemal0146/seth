/**
 * @fileoverview Oturum başlığı otomatik üretme.
 * İlk kullanıcı mesajından kısa, anlamlı başlık üretir.
 */

import type { LLMProvider } from './types.js';

/**
 * İlk mesajdan oturum başlığı üret.
 * Provider yoksa basit truncate kullan.
 */
export async function generateSessionTitle(
  firstMessage: string,
  provider?: LLMProvider,
  model?: string,
): Promise<string> {
  // Kısa mesajlar için direkt kullan
  if (firstMessage.length <= 50) return firstMessage.trim();

  // Provider varsa AI ile üret
  if (provider && model) {
    try {
      let title = '';
      for await (const event of provider.stream(
        [{ role: 'user', content: `Bu mesaj için 5 kelimeyi geçmeyen Türkçe başlık üret, sadece başlığı yaz:\n\n${firstMessage.slice(0, 300)}` }],
        { model, maxTokens: 30, temperature: 0.3 },
      )) {
        if (event.type === 'text') title += event.data as string;
        if (event.type === 'done') break;
      }
      const clean = title.trim().replace(/^["']|["']$/g, '').slice(0, 60);
      if (clean.length > 3) return clean;
    } catch { /* fallback */ }
  }

  // Fallback: ilk 50 karakter
  return firstMessage.slice(0, 50).trim() + (firstMessage.length > 50 ? '…' : '');
}
