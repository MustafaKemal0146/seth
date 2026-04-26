/**
 * @fileoverview SETH Context Engine — v3.9.5
 * AGPL-3.0
 * Token-aware context windowing, prioritization, compression.
 * AGPL-3.0
 */

import type { ChatMessage, ContentBlock } from '../types.js';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface ContextWindow {
  messages: ChatMessage[];
  totalTokens: number;
  estimatedTokens: number;
  priority: number;
  summary?: string;
}

export interface ContextEngineConfig {
  maxTokens: number;
  compressionEnabled: boolean;
  priorityThreshold: number;
  summaryEnabled: boolean;
  windowStrategy: 'sliding' | 'priority' | 'hybrid';
}

export interface ContextStats {
  totalMessages: number;
  totalTokens: number;
  windowsCount: number;
  oldestMessage: string | null;
  newestMessage: string | null;
  compressionRatio: number;
}

// ---------------------------------------------------------------------------
// Token Tahmini
// ---------------------------------------------------------------------------

const TOKENS_PER_CHAR = 0.25; // Türkçe için yaklaşık değer
const TOKENS_PER_WORD = 1.3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

export function estimateMessageTokens(msg: ChatMessage): number {
  if (typeof msg.content === 'string') {
    return estimateTokens(msg.content);
  }
  return msg.content.reduce((sum, block) => {
    if (block.type === 'text') return sum + estimateTokens(block.text);
    if (block.type === 'tool_result') return sum + estimateTokens(block.content);
    return sum + 50; // Tool use blocks ≈ 50 tokens
  }, 0);
}

// ---------------------------------------------------------------------------
// Varsayılan Konfigürasyon
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ContextEngineConfig = {
  maxTokens: 200_000,
  compressionEnabled: true,
  priorityThreshold: 0.3,
  summaryEnabled: true,
  windowStrategy: 'hybrid',
};

// ---------------------------------------------------------------------------
// Context Engine
// ---------------------------------------------------------------------------

export class ContextEngine {
  private config: ContextEngineConfig;
  private windows: ContextWindow[] = [];
  private summaryCache = new Map<string, string>();

  constructor(config?: Partial<ContextEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Mesaj İşleme
  // -----------------------------------------------------------------------

  ingest(messages: ChatMessage[]): void {
    const window = this.createWindow(messages);
    this.windows.push(window);
    this.maintain();
  }

  ingestBatch(batch: ChatMessage[][]): void {
    for (const msgs of batch) {
      this.ingest(msgs);
    }
  }

  // -----------------------------------------------------------------------
  // Pencere Yönetimi
  // -----------------------------------------------------------------------

  private createWindow(messages: ChatMessage[]): ContextWindow {
    const totalTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
    
    // Öncelik hesapla: sistem mesajları yüksek, eski mesajlar düşük
    const priority = messages.some(m => m.role === 'system') ? 1.0 : 0.5;

    return {
      messages,
      totalTokens,
      estimatedTokens: totalTokens,
      priority,
    };
  }

  private maintain(): void {
    let totalTokens = this.windows.reduce((sum, w) => sum + w.totalTokens, 0);

    // Token limitini aşmayacak şekilde sıkıştır
    if (totalTokens > this.config.maxTokens && this.config.compressionEnabled) {
      // Düşük öncelikli pencereleri sıkıştır
      this.windows.sort((a, b) => b.priority - a.priority);

      while (totalTokens > this.config.maxTokens && this.windows.length > 2) {
        const lowest = this.windows[this.windows.length - 1];
        if (lowest.priority < this.config.priorityThreshold) {
          if (this.config.summaryEnabled) {
            this.compressWindow(lowest);
          }
          totalTokens -= lowest.totalTokens;
          this.windows.pop();
        } else {
          break;
        }
      }
    }

    // Hibrit: sliding window
    if (this.config.windowStrategy === 'sliding' || this.config.windowStrategy === 'hybrid') {
      while (totalTokens > this.config.maxTokens && this.windows.length > 1) {
        const removed = this.windows.shift();
        if (removed && this.config.summaryEnabled) {
          this.cacheSummary(removed);
        }
        totalTokens = this.windows.reduce((sum, w) => sum + w.totalTokens, 0);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Sıkıştırma
  // -----------------------------------------------------------------------

  private compressWindow(window: ContextWindow): void {
    const summary = this.summarize(window.messages);
    window.messages = [{
      role: 'system',
      content: `[Özet: ${summary}]`,
    }];
    window.totalTokens = estimateTokens(summary);
    window.summary = summary;
  }

  private summarize(messages: ChatMessage[]): string {
    const textParts: string[] = [];
    
    for (const msg of messages.slice(-5)) {
      if (typeof msg.content === 'string') {
        textParts.push(`${msg.role}: ${msg.content.slice(0, 200)}`);
      }
    }

    return textParts.join(' | ').slice(0, 500);
  }

  private cacheSummary(window: ContextWindow): void {
    const key = `win_${Date.now()}`;
    const summary = this.summarize(window.messages);
    this.summaryCache.set(key, summary);

    // Cache temizliği
    if (this.summaryCache.size > 100) {
      const firstKey = this.summaryCache.keys().next().value;
      if (firstKey) this.summaryCache.delete(firstKey);
    }
  }

  // -----------------------------------------------------------------------
  // Bağlam İnşaası
  // -----------------------------------------------------------------------

  assemble(systemPrompt?: string): ChatMessage[] {
    const result: ChatMessage[] = [];

    // System prompt
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    // Özetlenmiş pencereler
    for (const window of this.windows) {
      if (window.summary) {
        result.push({
          role: 'system',
          content: `[Önceki bağlam: ${window.summary}]`,
        });
      } else {
        result.push(...window.messages);
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // İstatistikler
  // -----------------------------------------------------------------------

  getStats(): ContextStats {
    const allMessages = this.windows.flatMap(w => w.messages);
    const dates = allMessages
      .map(m => m.content)
      .filter((c): c is string => typeof c === 'string')
      .map(c => c.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/))
      .filter(Boolean)
      .map(m => m![0]);

    return {
      totalMessages: allMessages.length,
      totalTokens: this.windows.reduce((s, w) => s + w.totalTokens, 0),
      windowsCount: this.windows.length,
      oldestMessage: dates[0] || null,
      newestMessage: dates[dates.length - 1] || null,
      compressionRatio: this.windows.length > 0
        ? this.windows.reduce((s, w) => s + w.estimatedTokens, 0) /
          Math.max(1, this.windows.reduce((s, w) => s + w.totalTokens, 0))
        : 1,
    };
  }

  // -----------------------------------------------------------------------
  // Konfigürasyon
  // -----------------------------------------------------------------------

  updateConfig(config: Partial<ContextEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ContextEngineConfig {
    return { ...this.config };
  }

  // -----------------------------------------------------------------------
  // Temizlik
  // -----------------------------------------------------------------------

  clear(): void {
    this.windows = [];
    this.summaryCache.clear();
  }

  // -----------------------------------------------------------------------
  // Dışa Aktar
  // -----------------------------------------------------------------------

  exportState(): { windows: ContextWindow[]; config: ContextEngineConfig } {
    return {
      windows: this.windows,
      config: this.config,
    };
  }

  importState(state: { windows: ContextWindow[]; config: ContextEngineConfig }): void {
    this.windows = state.windows;
    this.config = state.config;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let engine: ContextEngine | null = null;

export function getContextEngine(config?: Partial<ContextEngineConfig>): ContextEngine {
  if (!engine) {
    engine = new ContextEngine(config);
  }
  return engine;
}

export function initContextEngine(config?: Partial<ContextEngineConfig>): ContextEngine {
  engine = new ContextEngine(config);
  return engine;
}
