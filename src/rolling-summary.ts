/**
 * @fileoverview Rolling Summary — context dolunca otomatik kayan özet üretir.
 * gemini-cli'nin rollingSummaryProcessor.ts'inden ilham alınmıştır.
 *
 * Strateji: Context %75 dolunca en eski mesajları AI ile özetler,
 * özeti tek mesaj olarak bırakır, son N mesajı korur.
 */

import type { ChatMessage, LLMProvider } from './types.js';

const ROLLING_SUMMARY_THRESHOLD = 0.75; // %75 dolunca tetikle
const KEEP_LAST_MESSAGES = 10;           // Son kaç mesajı koru
const MIN_MESSAGES_TO_SUMMARIZE = 6;     // En az kaç mesaj olsun

export interface RollingSummaryResult {
  messages: ChatMessage[];
  summarized: boolean;
  before: number;
  after: number;
}

/**
 * Gerekirse kayan özet uygula.
 */
export async function applyRollingSummary(
  messages: ChatMessage[],
  usedTokens: number,
  budgetTokens: number,
  provider: LLMProvider,
  model: string,
): Promise<RollingSummaryResult> {
  const pct = budgetTokens > 0 ? usedTokens / budgetTokens : 0;

  if (pct < ROLLING_SUMMARY_THRESHOLD || messages.length < MIN_MESSAGES_TO_SUMMARIZE + KEEP_LAST_MESSAGES) {
    return { messages, summarized: false, before: messages.length, after: messages.length };
  }

  const toSummarize = messages.slice(0, -KEEP_LAST_MESSAGES);
  const toKeep = messages.slice(-KEEP_LAST_MESSAGES);

  try {
    const transcript = toSummarize
      .map(m => `${m.role === 'user' ? 'Kullanıcı' : 'SETH'}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : '[araç çağrısı]'}`)
      .join('\n\n');

    const summaryResponse = await provider.chat(
      [{ role: 'user', content: `Bu konuşmayı 3-5 madde halinde özetle. Yapılan işler, alınan kararlar ve mevcut durumu belirt:\n\n${transcript}` }],
      { model, maxTokens: 800, temperature: 0.1 },
    );

    const summaryText = summaryResponse.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('');

    const newMessages: ChatMessage[] = [
      { role: 'user', content: `[Önceki konuşma özeti]\n${summaryText}` },
      { role: 'assistant', content: 'Özet alındı, devam ediyorum.' },
      ...toKeep,
    ];

    return { messages: newMessages, summarized: true, before: messages.length, after: newMessages.length };
  } catch {
    // Hata olursa dokunma
    return { messages, summarized: false, before: messages.length, after: messages.length };
  }
}
