/**
 * @fileoverview REPL canlı çıktı — main-code StreamingMarkdown fikri (stable/unstable lexer),
 * TTY’de blok yeniden çizimi; plain modda ham chunk yazımı.
 */

import { marked } from 'marked';
import stripAnsi from 'strip-ansi';
import type { ReplStreamMode } from './types.js';

export type { ReplStreamMode };

export function defaultStreamModeForTTY(isTTY: boolean): ReplStreamMode {
  return isTTY ? 'markdown' : 'off';
}

export function resolveStreamMode(explicit: ReplStreamMode | undefined): ReplStreamMode {
  if (explicit === 'off' || explicit === 'plain' || explicit === 'markdown') return explicit;
  return defaultStreamModeForTTY(Boolean(process.stdout.isTTY));
}

export interface ReplStreamingControllerOptions {
  streamMode: ReplStreamMode;
  /** Son eksik satırı gizle (main-code visibleStreamingText). */
  hideIncompleteLine: boolean;
  /** Markdown redraw için ms (0 = her chunk). */
  throttleMs: number;
  renderMarkdown: (text: string) => string;
}

/** TTY satır sayısı — uzun satırlar sütun sarmasıyla birden fazla görsel satır olabilir. */
function countRenderedLines(ansi: string): number {
  const plain = stripAnsi(ansi);
  if (!plain) return 0;
  const cols = Math.max(1, process.stdout.columns ?? 80);
  let n = 0;
  for (const line of plain.split('\n')) {
    const len = line.length;
    n += Math.max(1, Math.ceil(len / cols));
  }
  return n;
}

/** marked.lexer ile tamamlanan blokların önekini ilerlet (main-code StreamingMarkdown). */
function advanceStablePrefix(
  fullText: string,
  stablePrefixRef: { current: string },
): { stable: string; unstable: string } {
  let stripped = fullText;
  if (!stripped.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }
  const boundary = stablePrefixRef.current.length;
  const tokens = marked.lexer(stripped.substring(boundary));
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += (tokens[i] as { raw: string }).raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = stripped.substring(0, boundary + advance);
  }
  const stable = stablePrefixRef.current;
  const unstable = stripped.substring(stable.length);
  return { stable, unstable };
}

export class ReplStreamingController {
  private readonly renderMd: (text: string) => string;
  private readonly hideIncompleteLine: boolean;
  private readonly throttleMs: number;
  readonly mode: ReplStreamMode;

  private segmentBuffer = '';
  private stablePrefixRef = { current: '' };
  private printedStableRaw = '';
  private lastUnstableLines = 0;
  private plainSegmentAccum = '';
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMarkdownFlush = false;

  // Echo stripping state
  private userInputForEchoStripping: string | null = null;
  private echoStripped = false;
  private streamInitialBuffer = '';

  /** finalize sonrası son konsol markdown’unu atla */
  skipFinalMarkdown = false;

  constructor(opts: ReplStreamingControllerOptions) {
    this.mode = opts.streamMode;
    this.hideIncompleteLine = opts.hideIncompleteLine;
    this.throttleMs = opts.throttleMs;
    this.renderMd = opts.renderMarkdown;
  }

  onTurnStart(userInput?: string): void {
    this.cancelThrottle();
    this.segmentBuffer = '';
    this.stablePrefixRef.current = '';
    this.printedStableRaw = '';
    this.lastUnstableLines = 0;
    this.plainSegmentAccum = '';
    this.userInputForEchoStripping = userInput ?? null;
    this.echoStripped = false;
    this.streamInitialBuffer = '';
  }

  private cancelThrottle(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingMarkdownFlush = false;
  }

  /**
   * @param chunk — ThinkingFilter’dan gelen metin
   * @param onFirstChunk — spinner temizle vb.
   */
  onText(chunk: string, onFirstChunk: () => void): void {
    if (this.mode === 'off' || !chunk) return;

    // ── Echo Stripping Logic ────────────────────────────────────────────────
    if (this.userInputForEchoStripping && !this.echoStripped) {
      this.streamInitialBuffer += chunk;
      
      // Eğer tampon henüz kullanıcı mesajı kadar büyümediyse beklemeye devam et
      // (Kullanıcı mesajı + tolerans payı olarak 200 karakter)
      if (this.streamInitialBuffer.length < this.userInputForEchoStripping.length + 200) {
        // Eğer tampon içinde kullanıcı mesajına benzemeyen bir şey gelirse (örn. doğrudan cevap)
        // hemen pes et ve ekrana bas.
        const normalizedBuffer = this.streamInitialBuffer.trim().toLowerCase();
        const normalizedUser = this.userInputForEchoStripping.trim().toLowerCase();
        
        if (normalizedBuffer.length > 10 && !normalizedUser.startsWith(normalizedBuffer.slice(0, 10))) {
          // Bu bir echo değil, doğrudan cevap. Tamponu serbest bırak.
          this.echoStripped = true;
          chunk = this.streamInitialBuffer;
          this.streamInitialBuffer = '';
        } else {
          // Echo olma ihtimali yüksek, biriktirmeye devam et.
          return;
        }
      } else {
        // Tampon doldu, echo ayıklama yap
        const normalizedUser = this.userInputForEchoStripping.trim().toLowerCase();
        const b = this.streamInitialBuffer.trimStart();
        
        // Model bazen tam echo yapar, bazen başına 'naber' gibi bir şey koyar
        if (b.toLowerCase().startsWith(normalizedUser)) {
          // Echo yakalandı! Onu atla.
          let afterEcho = b.slice(normalizedUser.length).trimStart();
          // Echo sonrası boşlukları/yeni satırları temizle
          this.echoStripped = true;
          this.streamInitialBuffer = '';
          if (!afterEcho) return; // Henüz asıl cevap gelmedi
          chunk = afterEcho;
        } else {
          // Echo değilmiş, her şeyi bas.
          this.echoStripped = true;
          chunk = this.streamInitialBuffer;
          this.streamInitialBuffer = '';
        }
      }
    }
    // ── End Echo Stripping ──────────────────────────────────────────────────

    if (this.mode === 'plain') {
      if (!this.plainSegmentAccum && chunk) onFirstChunk();
      this.plainSegmentAccum += chunk;
      process.stdout.write(chunk);
      return;
    }

    // markdown
    if (!this.segmentBuffer && chunk) onFirstChunk();
    this.segmentBuffer += chunk;

    if (!process.stdout.isTTY) {
      return;
    }

    if (this.throttleMs > 0) {
      this.pendingMarkdownFlush = true;
      if (this.segmentBuffer === chunk) {
        this.flushMarkdownDisplay(false);
        return;
      }
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          if (this.pendingMarkdownFlush) {
            this.pendingMarkdownFlush = false;
            this.flushMarkdownDisplay(false);
          }
        }, this.throttleMs);
      }
      return;
    }
    this.flushMarkdownDisplay(false);
  }

  private flushMarkdownDisplay(forceShowLastLine: boolean): void {
    if (this.mode !== 'markdown' || !process.stdout.isTTY) return;
    let displayRaw = this.segmentBuffer;
    if (!forceShowLastLine && this.hideIncompleteLine && displayRaw.includes('\n')) {
      displayRaw = displayRaw.slice(0, displayRaw.lastIndexOf('\n') + 1);
    }
    if (!displayRaw) return;

    const { stable, unstable } = advanceStablePrefix(displayRaw, this.stablePrefixRef);
    
    // Yalnızca eski "unstable" kısmını sil
    if (this.lastUnstableLines > 0) {
      if (this.lastUnstableLines === 1) {
        process.stdout.write('\x1b[1G\x1b[0J'); // Same line clear
      } else {
        process.stdout.write(`\x1b[${this.lastUnstableLines - 1}A\x1b[1G\x1b[0J`); // Go up and clear
      }
    }

    // Yeni kilitlenen (stable) satırları kalıcı olarak yazdır
    const newStableRaw = stable.substring(this.printedStableRaw.length);
    if (newStableRaw) {
      process.stdout.write(this.renderMd(newStableRaw));
      this.printedStableRaw = stable;
    }

    // Geçici (unstable) satırları yazdır ve büyüklüğünü kaydet
    if (unstable) {
      const mdUnstable = this.renderMd(unstable);
      process.stdout.write(mdUnstable);
      this.lastUnstableLines = countRenderedLines(mdUnstable);
    } else {
      this.lastUnstableLines = 0;
    }
  }

  /** Araç çağrısından önce — segmenti kilitle, tamponu sıfırla. */
  commitSegmentBeforeTool(): void {
    this.cancelThrottle();
    if (this.mode === 'off') return;

    if (this.mode === 'plain') {
      if (this.plainSegmentAccum) process.stdout.write('\n');
      this.plainSegmentAccum = '';
      return;
    }

    if (this.mode === 'markdown' && this.segmentBuffer.trim()) {
      if (process.stdout.isTTY) {
        this.flushMarkdownDisplay(true);
        process.stdout.write('\n');
      } else {
        process.stdout.write(this.renderMd(this.segmentBuffer) + '\n');
      }
    }
    this.segmentBuffer = '';
    this.stablePrefixRef.current = '';
    this.printedStableRaw = '';
    this.lastUnstableLines = 0;
  }

  /**
   * runAgentLoop bittiğinde — son segmenti tam göster, final markdown tekrarını gerekip gerekmediğini hesapla.
   */
  finalize(
    userInput: string,
    finalText: string,
    stripEcho: (assistant: string, user: string) => string,
  ): void {
    this.cancelThrottle();
    this.skipFinalMarkdown = false;

    if (this.mode === 'off') return;

    const finalTrim = finalText.trim();
    if (!finalTrim) {
      this.segmentBuffer = '';
      this.plainSegmentAccum = '';
      this.stablePrefixRef.current = '';
      this.printedStableRaw = '';
      return;
    }

    if (this.mode === 'markdown' && !process.stdout.isTTY) {
      const raw = this.segmentBuffer.trim();
      if (!raw) return;
      const forCompareStream = stripEcho(raw, userInput).trim();
      const forCompareFinal = stripEcho(finalTrim, userInput).trim();
      process.stdout.write(this.renderMd(this.segmentBuffer) + '\n');
      this.skipFinalMarkdown = forCompareStream === forCompareFinal;
      this.segmentBuffer = '';
      this.stablePrefixRef.current = '';
      this.printedStableRaw = '';
      return;
    }

    if (this.mode === 'plain') {
      const streamed = this.plainSegmentAccum.trim();
      const forCompareStream = stripEcho(streamed, userInput).trim();
      const forCompareFinal = stripEcho(finalTrim, userInput).trim();
      this.skipFinalMarkdown =
        streamed.length > 0 && forCompareStream === forCompareFinal;
      if (streamed && !this.skipFinalMarkdown) process.stdout.write('\n');
      this.plainSegmentAccum = '';
      return;
    }

    // markdown + TTY
    if (!this.segmentBuffer.trim()) {
      return;
    }
    const streamedRaw = this.segmentBuffer.trim();
    this.flushMarkdownDisplay(true);

    const forCompareStream = stripEcho(streamedRaw, userInput).trim();
    const forCompareFinal = stripEcho(finalTrim, userInput).trim();
    // Markdown+TTY modunda streaming zaten yazdırdı — her zaman skip
    this.skipFinalMarkdown = streamedRaw.length > 0;

    this.segmentBuffer = '';
    this.stablePrefixRef.current = '';
    this.printedStableRaw = '';
    this.lastUnstableLines = 0;
  }
}

export function createReplStreamingController(
  opts: ReplStreamingControllerOptions,
): ReplStreamingController {
  return new ReplStreamingController(opts);
}
