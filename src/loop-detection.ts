/**
 * @fileoverview Loop Detection — AI'nın sonsuz döngüye girip girmediğini tespit eder.
 * gemini-cli'nin loopDetectionService.ts'inden ilham alınmıştır.
 */

import { createHash } from 'crypto';

const TOOL_CALL_LOOP_THRESHOLD = 5;   // Aynı araç çağrısı kaç kez tekrarlanırsa döngü
const CONTENT_LOOP_THRESHOLD = 10;    // Aynı içerik kaç kez tekrarlanırsa döngü
const CONTENT_CHUNK_SIZE = 50;        // İçerik karşılaştırma chunk boyutu

export interface LoopDetectionResult {
  isLoop: boolean;
  detail?: string;
  type?: 'tool_call' | 'content';
}

export class LoopDetectionService {
  private lastToolCallKey: string | null = null;
  private toolCallRepetitionCount = 0;
  private contentHistory = '';
  private contentStats = new Map<string, number>();
  private detectedCount = 0;

  reset(): void {
    this.lastToolCallKey = null;
    this.toolCallRepetitionCount = 0;
    this.contentHistory = '';
    this.contentStats.clear();
  }

  /**
   * Araç çağrısı döngüsü kontrolü.
   */
  checkToolCall(toolName: string, input: Record<string, unknown>): LoopDetectionResult {
    const key = createHash('sha256')
      .update(`${toolName}:${JSON.stringify(input)}`)
      .digest('hex');

    if (key === this.lastToolCallKey) {
      this.toolCallRepetitionCount++;
      if (this.toolCallRepetitionCount >= TOOL_CALL_LOOP_THRESHOLD) {
        this.detectedCount++;
        return {
          isLoop: true,
          type: 'tool_call',
          detail: `"${toolName}" aracı ${this.toolCallRepetitionCount} kez aynı parametrelerle çağrıldı.`,
        };
      }
    } else {
      this.lastToolCallKey = key;
      this.toolCallRepetitionCount = 1;
    }

    return { isLoop: false };
  }

  /**
   * İçerik döngüsü kontrolü — streaming sırasında.
   */
  checkContent(chunk: string): LoopDetectionResult {
    this.contentHistory += chunk;

    // Son CONTENT_CHUNK_SIZE karakteri al
    const recent = this.contentHistory.slice(-CONTENT_CHUNK_SIZE * 3);
    const chunkKey = recent.slice(-CONTENT_CHUNK_SIZE).trim();
    if (!chunkKey || chunkKey.length < 10) return { isLoop: false };

    const count = (this.contentStats.get(chunkKey) ?? 0) + 1;
    this.contentStats.set(chunkKey, count);

    if (count >= CONTENT_LOOP_THRESHOLD) {
      this.detectedCount++;
      return {
        isLoop: true,
        type: 'content',
        detail: `Tekrar eden içerik tespit edildi: "${chunkKey.slice(0, 40)}..."`,
      };
    }

    return { isLoop: false };
  }

  getDetectedCount(): number { return this.detectedCount; }
}

// Singleton — her oturum için bir tane
export const loopDetector = new LoopDetectionService();
