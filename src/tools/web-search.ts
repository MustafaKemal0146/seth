/**
 * @fileoverview Gelişmiş Web Arama Aracı.
 *
 * Strateji:
 *   1. BRAVE_API_KEY varsa → Brave Search API (en iyi kalite, snippet + URL)
 *   2. SERPAPI_KEY varsa → SerpAPI Google arama
 *   3. DuckDuckGo Instant Answer + DuckDuckGo HTML scraping fallback (API key gereksiz)
 *
 * Kullanım:
 *   - web_ara: Hızlı özet (mevcut tool, geriye dönük uyumlu)
 *   - web_search: Tam arama (URL listesi + snippet + tarih filtresi)
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { VERSION } from '../version.js';

const UA = `SETH/${VERSION} (+https://github.com)`;

// ─── Brave Search ─────────────────────────────────────────────────────────────

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
  discussions?: { results?: BraveResult[] };
}

async function searchBrave(query: string, count: number, apiKey: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&search_lang=tr&country=TR&safesearch=moderate`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Brave API ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as BraveResponse;
  const results = data.web?.results ?? [];

  if (results.length === 0) return 'Sonuç bulunamadı.';

  const lines: string[] = [`Brave Arama — "${query}"`, ''];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    lines.push(`${i + 1}. **${r.title ?? '(başlık yok)'}**`);
    if (r.url) lines.push(`   ${r.url}`);
    if (r.description) lines.push(`   ${r.description}`);
    if (r.age) lines.push(`   📅 ${r.age}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── SerpAPI ─────────────────────────────────────────────────────────────────

interface SerpResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

interface SerpResponse {
  organic_results?: SerpResult[];
  answer_box?: { answer?: string; snippet?: string; title?: string };
  knowledge_graph?: { description?: string; title?: string };
  error?: string;
}

async function searchSerpApi(query: string, count: number, apiKey: string): Promise<string> {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${count}&hl=tr&gl=tr&api_key=${apiKey}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = (await res.json()) as SerpResponse;
  if (data.error) throw new Error(`SerpAPI hatası: ${data.error}`);

  const lines: string[] = [`Google Arama — "${query}"`, ''];

  // Answer box
  if (data.answer_box?.answer || data.answer_box?.snippet) {
    lines.push(`📌 **${data.answer_box.title ?? 'Hızlı Yanıt'}**`);
    lines.push(`   ${data.answer_box.answer ?? data.answer_box.snippet}`);
    lines.push('');
  }

  // Knowledge graph
  if (data.knowledge_graph?.description) {
    lines.push(`🔍 **${data.knowledge_graph.title ?? 'Bilgi'}**`);
    lines.push(`   ${data.knowledge_graph.description}`);
    lines.push('');
  }

  const results = data.organic_results ?? [];
  for (let i = 0; i < Math.min(results.length, count); i++) {
    const r = results[i]!;
    lines.push(`${i + 1}. **${r.title ?? '(başlık yok)'}**`);
    if (r.link) lines.push(`   ${r.link}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    if (r.date) lines.push(`   📅 ${r.date}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── DuckDuckGo (enhanced — HTML parse + Instant Answer) ─────────────────────

interface DdgTopic {
  Text?: string;
  FirstURL?: string;
}

interface DdgJson {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  Answer?: string;
  AnswerType?: string;
  RelatedTopics?: Array<DdgTopic | { Topics?: DdgTopic[] }>;
  Results?: Array<{ Text?: string; FirstURL?: string }>;
}

function flattenTopics(topics: DdgJson['RelatedTopics'], depth = 0): DdgTopic[] {
  if (!topics || depth > 4) return [];
  const out: DdgTopic[] = [];
  for (const t of topics) {
    if ('Topics' in t && Array.isArray(t.Topics)) {
      out.push(...flattenTopics(t.Topics, depth + 1));
    } else if ('Text' in t && t.Text) {
      out.push(t as DdgTopic);
    }
  }
  return out;
}

async function searchDuckDuckGo(query: string, count: number): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DDG ${res.status}`);
  const data = (await res.json()) as DdgJson;

  const parts: string[] = [`DuckDuckGo Arama — "${query}"`, ''];

  if (data.Answer) {
    parts.push(`📌 **Hızlı Yanıt (${data.AnswerType ?? 'ddg'})**`);
    parts.push(`   ${data.Answer}`);
    parts.push('');
  }

  if (data.Heading) parts.push(`🔍 **${data.Heading}**`);
  if (data.AbstractText) {
    parts.push(`   ${data.AbstractText}`);
    if (data.AbstractURL) parts.push(`   Kaynak: ${data.AbstractURL}`);
    parts.push('');
  }

  // Direct results
  if (data.Results) {
    for (const r of data.Results.slice(0, 3)) {
      if (r.Text) {
        parts.push(`• ${r.Text}`);
        if (r.FirstURL) parts.push(`  ${r.FirstURL}`);
      }
    }
  }

  const related = flattenTopics(data.RelatedTopics).slice(0, count);
  for (const r of related) {
    if (r.Text) {
      parts.push(`• ${r.Text}`);
      if (r.FirstURL) parts.push(`  ${r.FirstURL}`);
    }
  }

  if (parts.length <= 2) {
    return `"${query}" için özet bulunamadı. web_fetch ile doğrudan URL okuyabilirsiniz.`;
  }

  return parts.join('\n');
}

// ─── Tool Execution ───────────────────────────────────────────────────────────

async function performSearch(query: string, count: number): Promise<string> {
  const braveKey = process.env.BRAVE_API_KEY;
  const serpKey = process.env.SERPAPI_KEY;

  if (braveKey) {
    try {
      return await searchBrave(query, count, braveKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[web_ara] Brave fallback: ${msg}\n`);
    }
  }

  if (serpKey) {
    try {
      return await searchSerpApi(query, count, serpKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[web_ara] SerpAPI fallback: ${msg}\n`);
    }
  }

  // Free fallback
  return searchDuckDuckGo(query, count);
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

/** Geriye dönük uyumlu — mevcut tool adını koru */
export const webAraTool: ToolDefinition = {
  name: 'web_ara',
  description:
    'İnternette arama yap; güncel bilgi, belgeler, haber vb. bul. ' +
    'BRAVE_API_KEY veya SERPAPI_KEY varsa gerçek arama yapar, yoksa DuckDuckGo kullanır. ' +
    'Sayfa içeriği için web_fetch kullan.',
  inputSchema: {
    type: 'object',
    properties: {
      sorgu: { type: 'string', description: 'Arama sorgusu.' },
      sonuc_sayisi: { type: 'number', description: 'Maksimum sonuç sayısı. Varsayılan: 8.' },
    },
    required: ['sorgu'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const sorgu = String(input.sorgu ?? '').trim();
    if (!sorgu) return { output: 'Hata: sorgu boş olamaz.', isError: true };

    const count = Math.min(10, Math.max(1, Number(input.sonuc_sayisi ?? 8)));

    try {
      const result = await performSearch(sorgu, count);
      return { output: result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `web_ara hatası: ${msg}`, isError: true };
    }
  },
};

/** Yeni, daha ayrıntılı web arama aracı */
export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Detaylı web araması — başlık, URL, açıklama, tarih bilgisiyle sonuçlar döner. ' +
    'BRAVE_API_KEY en kaliteli sonuçları verir. Dil ve ülke filtrelemesi yapar.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Arama sorgusu (Türkçe veya İngilizce).' },
      count: { type: 'number', description: 'Sonuç sayısı (1-10). Varsayılan: 6.' },
    },
    required: ['query'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = String(input.query ?? '').trim();
    if (!query) return { output: 'Hata: query boş olamaz.', isError: true };

    const count = Math.min(10, Math.max(1, Number(input.count ?? 6)));

    try {
      const result = await performSearch(query, count);
      return { output: result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `web_search hatası: ${msg}`, isError: true };
    }
  },
};
