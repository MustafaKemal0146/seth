/**
 * @fileoverview web_fetch tool — fetches a URL and returns its content as Markdown.
 * Adapted from main-code/src/tools/WebFetchTool (claude-code source).
 *
 * Key design decisions vs. the original:
 *   1. No axios dependency (uses native fetch, available in Node 18+)
 *   2. No LRU cache dependency (simple in-memory Map with TTL)
 *   3. No Anthropic domain-blocklist preflight check (too coupled)
 *   4. HTML → Markdown conversion via regex-based stripper (no turndown dep)
 *   5. Truncates to 40 000 chars to avoid burning context
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { VERSION } from '../version.js';

// ── Config ───────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 20_000;
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5 MB
const MAX_OUTPUT_CHARS = 40_000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Simple TTL cache ─────────────────────────────────────────────────────────

const cache = new Map<string, { ts: number; text: string }>();

function cachedGet(url: string): string | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(url); return undefined; }
  return entry.text;
}

function setCached(url: string, text: string): void {
  // Evict old entries if cache grows too large
  if (cache.size > 100) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(url, { ts: Date.now(), text });
}

// ── HTML → plain text ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    // Remove <script> / <style> blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Convert common block tags to newlines
    .replace(/<\/(p|div|li|br|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert links: <a href="url">text</a> → text (url)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t ? `${t} (${href})` : href;
    })
    // Strip all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse 3+ consecutive blank lines → 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Tool definition ──────────────────────────────────────────────────────────

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Bir URL’nin içeriğini düz metin / Markdown benzeri olarak çeker. ' +
    'Dokümantasyon okumak, güncel veri veya sayfa incelemek için kullan. ' +
    'HTML otomatik sadeleştirilir; çıktı en fazla 40.000 karakter. ' +
    'Sonuçlar 10 dakika önbelleğe alınır.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'İstek URL’si; http:// veya https:// ile başlamalı.',
      },
      prompt: {
        type: 'string',
        description:
          'İsteğe bağlı: sayfada aranacak konu. ' +
          'Verilirse yalnızca ilgili bölüm döndürülür.',
      },
    },
    required: ['url'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = String(input.url ?? '').trim();
    const prompt = input.prompt ? String(input.prompt).trim() : undefined;

    if (!url) return { output: 'Hata: URL boş olamaz.', isError: true };

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { output: `Geçersiz URL: "${url}"`, isError: true };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { output: `Desteklenmeyen protokol: ${parsed.protocol}`, isError: true };
    }

    // Check cache
    const cacheKey = url + (prompt ?? '');
    const cached = cachedGet(cacheKey);
    if (cached) return { output: cached, isError: false };

    // Fetch
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let rawText: string;
    let contentType = '';
    let status = 0;

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': `SETH/${VERSION} (Terminal AI Agent)`,
          Accept: 'text/html,text/markdown,text/plain,*/*',
        },
        redirect: 'follow',
      });

      clearTimeout(timer);
      status = res.status;
      contentType = res.headers.get('content-type') ?? '';

      if (!res.ok) {
        return { output: `HTTP ${status}: ${res.statusText} — ${url}`, isError: true };
      }

      // Guard content length
      const lengthHeader = res.headers.get('content-length');
      if (lengthHeader && parseInt(lengthHeader, 10) > MAX_CONTENT_LENGTH) {
        return {
          output: `İçerik çok büyük (${lengthHeader} byte). Maksimum: ${MAX_CONTENT_LENGTH / 1024 / 1024} MB`,
          isError: true,
        };
      }

      const raw = await res.text();
      rawText = raw;

      // Resim desteği: image/* content-type ise base64 olarak döndür
      if (contentType.startsWith('image/')) {
        const imgRes = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': `SETH/${VERSION} (Terminal AI Agent)` },
        });
        const buf = await imgRes.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        const ext = contentType.split('/')[1]?.split(';')[0] ?? 'png';
        return {
          output: `[Resim: ${url}]\nTür: ${contentType}\nBoyut: ${buf.byteLength} byte\nBase64 (${ext}): data:${contentType};base64,${b64.slice(0, 100)}…`,
          isError: false,
          data: { mediaType: contentType, base64: b64 } as any,
        };
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        return { output: `Zaman aşımı: ${url} (${FETCH_TIMEOUT_MS}ms)`, isError: true };
      }
      return { output: `Bağlantı hatası: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }

    // Convert HTML to text
    let text: string;
    if (contentType.includes('text/html')) {
      text = htmlToText(rawText);
    } else {
      text = rawText;
    }

    // Filter by prompt if provided (simple keyword search)
    if (prompt) {
      const keywords = prompt.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      const paragraphs = text.split(/\n{2,}/);
      const relevant = paragraphs.filter(p =>
        keywords.some(kw => p.toLowerCase().includes(kw)),
      );
      if (relevant.length > 0) {
        text = relevant.join('\n\n');
      }
    }

    // Truncate
    if (text.length > MAX_OUTPUT_CHARS) {
      text = text.slice(0, MAX_OUTPUT_CHARS) + `\n\n… [${text.length - MAX_OUTPUT_CHARS} karakter kırpıldı]`;
    }

    const header = `# ${url}\n_HTTP ${status} • ${contentType.split(';')[0]?.trim()}_\n\n`;
    const result = header + text;

    setCached(cacheKey, result);
    return { output: result, isError: false };
  },
};
