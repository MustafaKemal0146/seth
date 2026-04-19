/**
 * @fileoverview ThinkingFilter — intercepts <thinking>...</thinking> blocks
 * in the LLM text stream and suppresses them from terminal output.
 *
 * When the model is "thinking" inside a <thinking> block, we:
 *   - Show a gray spinner: ⠙ Düşünüyor...
 *   - Suppress all text inside the block (never print it)
 *
 * When </thinking> closes, the spinner stops and real output resumes.
 *
 * This prevents the model's internal planning monologue from polluting
 * the terminal while still allowing it to "think before acting".
 */

import chalk from 'chalk';
import { startSpinner, clearSpinner } from './renderer.js';

export type TextSink = (chunk: string) => void;

export class ThinkingFilter {
  private buffer = '';
  private isThinking = false;
  private readonly sink: TextSink;

  /**
   * @param sink - The downstream function that receives real (non-thinking) text.
   *               In practice this is the function that writes to the terminal.
   */
  constructor(sink: TextSink) {
    this.sink = sink;
  }

  /**
   * Feed a raw stream chunk from the LLM into the filter.
   * The filter processes it character by character (buffered) and either:
   *   - Suppresses it (if inside <thinking>)
   *   - Passes it to the sink (if outside <thinking>)
   */
  feed(chunk: string): void {
    this.buffer += chunk;
    this.flush();
  }

  /**
   * Call at the end of the stream to flush any remaining buffered text.
   */
  end(): void {
    if (this.buffer.length > 0 && !this.isThinking) {
      this.sink(this.buffer);
      this.buffer = '';
    } else {
      // Unclosed <thinking> block — silently discard and stop spinner
      this.buffer = '';
      if (this.isThinking) {
        this.isThinking = false;
        clearSpinner();
      }
    }
  }

  private flush(): void {
    while (this.buffer.length > 0) {
      if (this.isThinking) {
        // We're inside <thinking> — look for </thinking>
        const closeIdx = this.buffer.indexOf('</thinking>');
        if (closeIdx === -1) {
          // Haven't found the closing tag yet — keep buffering
          // (but make sure we don't buffer so much that we miss a split tag)
          // Leave up to 12 chars buffered in case the tag is split across chunks
          if (this.buffer.length > 12) {
            this.buffer = this.buffer.slice(this.buffer.length - 12);
          }
          return;
        }
        // Found closing tag — discard everything up to and including it
        this.buffer = this.buffer.slice(closeIdx + '</thinking>'.length);
        this.isThinking = false;
        clearSpinner();

        // Eat any leading newlines after </thinking> so output looks clean
        while (this.buffer.startsWith('\n')) {
          this.buffer = this.buffer.slice(1);
        }
      } else {
        // We're in normal mode — look for <thinking>
        const openIdx = this.buffer.indexOf('<thinking>');
        if (openIdx === -1) {
          // No thinking tag in buffer — check if we might have a partial tag at the end
          const partialMatch = this.findPartialOpenTag(this.buffer);
          if (partialMatch > 0) {
            // Flush everything before the potential partial tag
            const safe = this.buffer.slice(0, partialMatch);
            if (safe) this.sink(safe);
            this.buffer = this.buffer.slice(partialMatch);
            return; // Wait for more data to determine if it's really a tag
          }
          // No partial match — flush everything
          this.sink(this.buffer);
          this.buffer = '';
          return;
        }

        // There's a <thinking> tag — flush everything before it
        if (openIdx > 0) {
          this.sink(this.buffer.slice(0, openIdx));
        }
        this.buffer = this.buffer.slice(openIdx + '<thinking>'.length);
        this.isThinking = true;

        // Show the thinking spinner
        startSpinner(chalk.gray('Düşünüyor...'));
      }
    }
  }

  /**
   * Returns the index of the start of a *partial* `<thinking>` tag at the
   * end of the buffer, or -1 if there is none.
   * This prevents us from flushing text that might be the beginning of a tag.
   */
  private findPartialOpenTag(text: string): number {
    const tag = '<thinking>';
    for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) {
        return text.length - len;
      }
    }
    return -1;
  }

  /** Whether the filter is currently inside a <thinking> block. */
  get thinking(): boolean {
    return this.isThinking;
  }
}
