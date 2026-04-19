/**
 * @fileoverview Seth CTF Solver — Recursive çok katmanlı şifre/encoding çözücü
 * Encoding, hash, klasik kripto, modern kripto ve steganografi destekler.
 * Maksimum 7 katman derinliğe kadar recursive çalışır.
 */

import { createHash, createDecipheriv } from 'crypto';
import type { ToolDefinition, ToolResult } from '../types.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface SolveResult {
  flag: string | null;
  technique: string;
  explanation: string;
  layers: string[];
}

interface LayerResult {
  decoded: string;
  technique: string;
}

// ─── Yardımcı: Anlamlı mı? ───────────────────────────────────────────────────

function looksLikeFlag(s: string): boolean {
  return /flag\{[^}]+\}/i.test(s) || /ctf\{[^}]+\}/i.test(s);
}

function isPrintableAscii(s: string, threshold = 0.85): boolean {
  if (!s.length) return false;
  const printable = s.split('').filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127).length;
  return printable / s.length >= threshold;
}

function looksLikeEnglish(s: string): boolean {
  const words = ['the', 'and', 'flag', 'ctf', 'is', 'you', 'have', 'key', 'secret', 'password'];
  const lower = s.toLowerCase();
  return words.some(w => lower.includes(w));
}

function isMeaningful(s: string): boolean {
  return looksLikeFlag(s) || (isPrintableAscii(s) && (looksLikeEnglish(s) || s.length < 20));
}

// ─── 2.1 Encoding Teknikleri ─────────────────────────────────────────────────

function tryBase64(input: string): LayerResult | null {
  const clean = input.trim().replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(clean) || clean.length < 4) return null;
  // Padding düzelt
  const padded = clean + '='.repeat((4 - clean.length % 4) % 4);
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (decoded && isPrintableAscii(decoded, 0.7)) {
      return { decoded, technique: 'Base64' };
    }
  } catch { /* ignore */ }
  return null;
}

function tryBase32(input: string): LayerResult | null {
  const clean = input.trim().toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z2-7]+=*$/.test(clean) || clean.length < 8) return null;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const padded = clean + '='.repeat((8 - clean.length % 8) % 8);
    let bits = '';
    for (const c of padded.replace(/=/g, '')) {
      const idx = alphabet.indexOf(c);
      if (idx < 0) return null;
      bits += idx.toString(2).padStart(5, '0');
    }
    let result = '';
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      result += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    }
    if (isPrintableAscii(result, 0.7)) return { decoded: result, technique: 'Base32' };
  } catch { /* ignore */ }
  return null;
}

function tryHex(input: string): LayerResult | null {
  const clean = input.trim().replace(/\s|0x/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0 || clean.length < 4) return null;
  try {
    const decoded = Buffer.from(clean, 'hex').toString('utf8');
    if (isPrintableAscii(decoded, 0.7)) return { decoded, technique: 'Hex' };
  } catch { /* ignore */ }
  return null;
}

function tryBinary(input: string): LayerResult | null {
  const clean = input.trim().replace(/\s/g, '');
  if (!/^[01]+$/.test(clean) || clean.length % 8 !== 0) return null;
  try {
    let result = '';
    for (let i = 0; i < clean.length; i += 8) {
      result += String.fromCharCode(parseInt(clean.slice(i, i + 8), 2));
    }
    if (isPrintableAscii(result, 0.8)) return { decoded: result, technique: 'Binary' };
  } catch { /* ignore */ }
  return null;
}

function tryUrlDecode(input: string): LayerResult | null {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return null;
  try {
    const decoded = decodeURIComponent(input);
    if (decoded !== input && isPrintableAscii(decoded)) return { decoded, technique: 'URL Encoding' };
  } catch { /* ignore */ }
  return null;
}

function tryHtmlEntities(input: string): LayerResult | null {
  if (!(/&[a-z]+;/.test(input) || /&#\d+;/.test(input) || /&#x[0-9a-f]+;/i.test(input))) return null;
  const decoded = input
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (decoded !== input) return { decoded, technique: 'HTML Entities' };
  return null;
}

function tryAsciiDecimal(input: string): LayerResult | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length < 3) return null;
  if (!parts.every(p => /^\d+$/.test(p) && Number(p) >= 32 && Number(p) <= 126)) return null;
  const decoded = parts.map(p => String.fromCharCode(Number(p))).join('');
  if (isPrintableAscii(decoded)) return { decoded, technique: 'ASCII Decimal' };
  return null;
}

// ─── 2.2 Hash Kırma ──────────────────────────────────────────────────────────

const WORDLIST = [
  'password', '123456', 'admin', 'test', 'hello', 'secret', 'letmein',
  'welcome', 'monkey', 'dragon', 'master', 'abc123', 'pass', 'qwerty',
  'superman', 'batman', 'trustno1', 'shadow', 'sunshine', 'princess',
  'flag', 'ctf', 'hacker', 'root', 'toor', 'alpine', 'changeme',
  'p@ssw0rd', 'Password1', '1234', '12345', '0000', '1111', 'password123',
];

function detectHashType(input: string): string | null {
  const clean = input.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  if (clean.length === 32) return 'md5';
  if (clean.length === 40) return 'sha1';
  if (clean.length === 64) return 'sha256';
  if (clean.length === 128) return 'sha512';
  return null;
}

function tryHashCrack(input: string): LayerResult | null {
  const hashType = detectHashType(input);
  if (!hashType) return null;
  const target = input.trim().toLowerCase();
  for (const word of WORDLIST) {
    const hash = createHash(hashType).update(word).digest('hex');
    if (hash === target) {
      return { decoded: word, technique: `${hashType.toUpperCase()} Hash (wordlist: "${word}")` };
    }
  }
  return { decoded: `[${hashType.toUpperCase()} hash — wordlist'te bulunamadı. crackstation.net dene]`, technique: `${hashType.toUpperCase()} Hash (kırılamadı)` };
}

// ─── 2.3 Klasik Kripto ───────────────────────────────────────────────────────

function rot(input: string, n: number): string {
  return input.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base);
  });
}

function tryROT13(input: string): LayerResult | null {
  if (!/[a-zA-Z]/.test(input)) return null;
  const decoded = rot(input, 13);
  if (decoded !== input && isMeaningful(decoded)) return { decoded, technique: 'ROT13' };
  return null;
}

function tryROT47(input: string): LayerResult | null {
  const decoded = input.replace(/[\x21-\x7e]/g, c =>
    String.fromCharCode(((c.charCodeAt(0) - 33 + 47) % 94) + 33)
  );
  if (decoded !== input && isMeaningful(decoded)) return { decoded, technique: 'ROT47' };
  return null;
}

function tryCaesar(input: string): LayerResult | null {
  if (!/[a-zA-Z]/.test(input)) return null;
  for (let shift = 1; shift <= 25; shift++) {
    const decoded = rot(input, shift);
    if (isMeaningful(decoded)) return { decoded, technique: `Caesar (shift=${shift})` };
  }
  return null;
}

function tryAtbash(input: string): LayerResult | null {
  if (!/[a-zA-Z]/.test(input)) return null;
  const decoded = input.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + 25 - (c.charCodeAt(0) - base));
  });
  if (decoded !== input && isMeaningful(decoded)) return { decoded, technique: 'Atbash' };
  return null;
}

const MORSE_TABLE: Record<string, string> = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
  '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
  '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
};

function tryMorse(input: string): LayerResult | null {
  if (!/^[.\-\s/]+$/.test(input.trim())) return null;
  const words = input.trim().split(/\s*\/\s*/);
  const decoded = words.map(word =>
    word.trim().split(/\s+/).map(code => MORSE_TABLE[code] ?? '?').join('')
  ).join(' ');
  if (!decoded.includes('?') && isPrintableAscii(decoded)) {
    return { decoded, technique: 'Morse Code' };
  }
  return null;
}

function tryPolybius(input: string): LayerResult | null {
  const clean = input.trim().replace(/\s/g, '');
  if (!/^[1-5]{2,}$/.test(clean) || clean.length % 2 !== 0) return null;
  const table = 'ABCDEFGHIKLMNOPQRSTUVWXYZ'; // I=J
  let decoded = '';
  for (let i = 0; i < clean.length; i += 2) {
    const row = parseInt(clean[i]!) - 1;
    const col = parseInt(clean[i + 1]!) - 1;
    const idx = row * 5 + col;
    if (idx < 0 || idx >= 25) return null;
    decoded += table[idx];
  }
  if (isPrintableAscii(decoded)) return { decoded, technique: 'Polybius Square' };
  return null;
}

function tryBacon(input: string): LayerResult | null {
  const clean = input.trim().replace(/\s/g, '').toUpperCase();
  if (!/^[AB]+$/.test(clean) || clean.length % 5 !== 0) return null;
  let decoded = '';
  for (let i = 0; i < clean.length; i += 5) {
    const bits = clean.slice(i, i + 5).replace(/A/g, '0').replace(/B/g, '1');
    const idx = parseInt(bits, 2);
    if (idx < 0 || idx > 25) return null;
    decoded += String.fromCharCode(65 + idx);
  }
  if (isPrintableAscii(decoded)) return { decoded, technique: 'Bacon Cipher' };
  return null;
}

function tryRailFence(input: string, rails?: number): LayerResult | null {
  if (!/^[a-zA-Z0-9{}_!@#$%^&*]+$/.test(input.trim())) return null;
  const maxRails = rails ? rails + 1 : 8;
  const minRails = rails ?? 2;
  for (let r = minRails; r < maxRails; r++) {
    const decoded = railFenceDecode(input.trim(), r);
    if (isMeaningful(decoded)) return { decoded, technique: `Rail Fence (rails=${r})` };
  }
  return null;
}

function railFenceDecode(cipher: string, rails: number): string {
  const n = cipher.length;
  const pattern = Array.from({ length: n }, (_, i) => {
    const cycle = 2 * (rails - 1);
    const pos = i % cycle;
    return pos < rails ? pos : cycle - pos;
  });
  const counts = Array(rails).fill(0);
  pattern.forEach(r => counts[r]++);
  const rows: string[] = [];
  let idx = 0;
  for (let r = 0; r < rails; r++) {
    rows.push(cipher.slice(idx, idx + counts[r]!));
    idx += counts[r]!;
  }
  const rowIdx = Array(rails).fill(0);
  return pattern.map(r => {
    const c = rows[r]![rowIdx[r]!] ?? '';
    rowIdx[r]!++;
    return c;
  }).join('');
}

// ─── 2.4 Modern Kripto ───────────────────────────────────────────────────────

function tryXorSingleByte(input: string): LayerResult | null {
  // Hex string olarak geldiğini varsay
  const clean = input.trim().replace(/\s/g, '');
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  let bestKey = 0;
  let bestScore = -1;
  let bestResult = '';
  for (let key = 0; key <= 255; key++) {
    const decoded = bytes.map(b => String.fromCharCode(b ^ key)).join('');
    const printable = decoded.split('').filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127).length;
    const score = printable / decoded.length;
    if (score > bestScore) { bestScore = score; bestKey = key; bestResult = decoded; }
  }
  if (bestScore > 0.85 && isMeaningful(bestResult)) {
    return { decoded: bestResult, technique: `XOR (key=0x${bestKey.toString(16).padStart(2, '0')})` };
  }
  return null;
}

function tryRSA(input: string): LayerResult | null {
  // Format: p=X q=X e=X c=X veya JSON
  const pMatch = /p\s*=\s*(\d+)/i.exec(input);
  const qMatch = /q\s*=\s*(\d+)/i.exec(input);
  const eMatch = /e\s*=\s*(\d+)/i.exec(input);
  const cMatch = /c\s*=\s*(\d+)/i.exec(input);
  if (!pMatch || !qMatch || !eMatch || !cMatch) return null;
  try {
    const p = BigInt(pMatch[1]!);
    const q = BigInt(qMatch[1]!);
    const e = BigInt(eMatch[1]!);
    const c = BigInt(cMatch[1]!);
    const n = p * q;
    const phi = (p - 1n) * (q - 1n);
    const d = modInverse(e, phi);
    if (d === null) return null;
    const m = modPow(c, d, n);
    // Sayıyı string'e çevir
    let hex = m.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const decoded = Buffer.from(hex, 'hex').toString('utf8');
    if (isPrintableAscii(decoded, 0.6)) {
      return { decoded, technique: `RSA (p=${p}, q=${q}, e=${e})` };
    }
    return { decoded: m.toString(), technique: `RSA (p=${p}, q=${q}, e=${e}) → m=${m}` };
  } catch { return null; }
}

function modInverse(a: bigint, m: bigint): bigint | null {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) return null;
  return ((old_s % m) + m) % m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = result * base % mod;
    exp = exp / 2n;
    base = base * base % mod;
  }
  return result;
}

// ─── 3. Steganografi ─────────────────────────────────────────────────────────

function tryWhitespaceStego(input: string): LayerResult | null {
  if (!/[\t ]/.test(input)) return null;
  const bits = input.split('').filter(c => c === ' ' || c === '\t').map(c => c === '\t' ? '1' : '0').join('');
  if (bits.length < 8) return null;
  let decoded = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    decoded += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
  }
  if (isPrintableAscii(decoded, 0.8)) return { decoded, technique: 'Whitespace Steganography' };
  return null;
}

// ─── Ana Orchestrator ─────────────────────────────────────────────────────────

const TECHNIQUES: Array<(input: string) => LayerResult | null> = [
  tryBase64,
  tryHex,
  tryBinary,
  tryBase32,
  tryUrlDecode,
  tryHtmlEntities,
  tryAsciiDecimal,
  tryROT13,
  tryROT47,
  tryCaesar,
  tryAtbash,
  tryMorse,
  tryPolybius,
  tryBacon,
  tryRailFence,
  tryXorSingleByte,
  tryRSA,
  tryHashCrack,
  tryWhitespaceStego,
];

export function solve(input: string, maxLayers = 7): SolveResult {
  const layers: string[] = [];

  function recurse(data: string, depth: number, usedTechniques: Set<string>): string | null {
    if (depth > maxLayers) return null;
    if (looksLikeFlag(data)) return data;

    for (const technique of TECHNIQUES) {
      const result = technique(data);
      if (!result) continue;
      // Aynı tekniği aynı dalda tekrar kullanma (döngü önleme)
      if (usedTechniques.has(result.technique)) continue;

      layers.push(result.technique);
      const nextUsed = new Set(usedTechniques).add(result.technique);

      // Flag bulundu mu?
      if (looksLikeFlag(result.decoded)) return result.decoded;

      // Hash kırma veya kırılamadı mesajı → daha derin gitme
      if (result.technique.includes('Hash')) {
        return result.decoded;
      }

      // Anlamlı sonuç → daha derin git
      if (isMeaningful(result.decoded) && result.decoded !== data) {
        const deeper = recurse(result.decoded, depth + 1, nextUsed);
        if (deeper) return deeper;
        // Derin çözüm yoksa bu katmanı kabul et
        return result.decoded;
      }

      // Anlamsız ama decode edildi → recursive dene
      if (result.decoded !== data && result.decoded.length > 0) {
        const deeper = recurse(result.decoded, depth + 1, nextUsed);
        if (deeper) return deeper;
      }

      // Bu teknik işe yaramadı, layer'ı geri al
      layers.pop();
    }
    return null;
  }

  const finalResult = recurse(input.trim(), 1, new Set());
  const techniqueChain = layers.join(' → ') || 'Tanınamadı';

  if (finalResult) {
    const flag = looksLikeFlag(finalResult) ? (finalResult.match(/(?:flag|ctf)\{[^}]+\}/i)?.[0] ?? finalResult) : finalResult;
    return {
      flag,
      technique: techniqueChain,
      explanation: `${layers.length} katman uygulandı: ${techniqueChain}`,
      layers,
    };
  }

  return {
    flag: null,
    technique: techniqueChain || 'Hiçbir teknik işe yaramadı',
    explanation: 'Veri çözülemedi. Manuel analiz veya ek bilgi gerekebilir.',
    layers,
  };
}

// ─── Tool Tanımı ─────────────────────────────────────────────────────────────

export const ctfSolverTool: ToolDefinition = {
  name: 'ctf_solver',
  description:
    'CTF şifre/encoding çözücü. Base64, Hex, Binary, ROT13/47, Caesar, Atbash, Morse, ' +
    'Polybius, Rail Fence, Bacon, XOR, RSA, MD5/SHA hash kırma, URL/HTML decode ve ' +
    'whitespace steganografi destekler. Çok katmanlı (max 7 katman) recursive çözüm yapar. ' +
    'RSA için "p=X q=X e=X c=X" formatında gir.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Çözülecek şifreli/kodlanmış veri',
      },
      maxLayers: {
        type: 'number',
        description: 'Maksimum katman derinliği (varsayılan: 7)',
      },
    },
    required: ['input'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(rawInput: Record<string, unknown>): Promise<ToolResult> {
    const input = String(rawInput['input'] ?? '').trim();
    const maxLayers = Number(rawInput['maxLayers'] ?? 7);

    if (!input) {
      return { output: 'Hata: input boş olamaz.', isError: true };
    }

    const result = solve(input, maxLayers);

    const lines = [
      '┌─ CTF SOLVER SONUCU ─────────────────────────────────────────┐',
      `│ Flag    : ${(result.flag ?? 'Bulunamadı').slice(0, 55)}`,
      `│ Teknik  : ${result.technique.slice(0, 55)}`,
      `│ Açıklama: ${result.explanation.slice(0, 55)}`,
      `│ Katmanlar (${result.layers.length}): ${result.layers.join(' → ').slice(0, 45)}`,
      '└─────────────────────────────────────────────────────────────┘',
      '',
      JSON.stringify(result, null, 2),
    ];

    return { output: lines.join('\n') };
  },
};
