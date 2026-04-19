/**
 * @fileoverview /nasılçalışır — SETH canlı demo (typewriter animasyonu)
 */

import chalk from 'chalk';
import { VERSION } from './version.js';
import { cmd, navy, navyBright, navyDim } from './theme.js';

type Seg = { text: string; style: (s: string) => string };

const dim  = navyDim;
const hi   = navyBright;
const user = chalk.hex('#98FB98');
const ai   = chalk.hex('#64b5f6');
const tool = chalk.hex('#ffb74d');
const ok   = chalk.green;

function seg(text: string, style: (s: string) => string): Seg {
  return { text, style };
}
function nl(): Seg { return seg('\n', s => s); }
function sp(): Seg { return seg('  ', s => s); }

function buildSteps(): Seg[][] {
  return [
    // ─── Başlık ───────────────────────────────────────────────────────────
    [
      nl(),
      seg(`  SETH v${VERSION}`, (s) => chalk.bold(navy(s))),
      seg('  —  Türkçe Yapay Zeka Kodlama Ajanı', dim),
      nl(),
      seg('  Claude · Gemini · OpenAI · Ollama desteği', dim),
      nl(), nl(),
    ],

    // ─── Ne yapabilir? ────────────────────────────────────────────────────
    [
      seg('  ✦ Ne yapabilirim?', hi),
      nl(),
      sp(), seg('• Kod yazar, düzenler, hata ayıklar', dim), nl(),
      sp(), seg('• Dosya okur/yazar, dizinleri listeler', dim), nl(),
      sp(), seg('• Shell komutları çalıştırır (onayınla)', dim), nl(),
      sp(), seg('• Web araması yapar, URL içeriği çeker', dim), nl(),
      sp(), seg('• Git durumu, diff, log gösterir', dim), nl(),
      sp(), seg('• Siber güvenlik taraması yapar (nmap, nikto, ffuf, nuclei...)', dim), nl(),
      sp(), seg('• Arka planda paralel görevler çalıştırır', dim), nl(),
      sp(), seg('• Kalıcı belleğe bilgi kaydeder', dim), nl(),
      sp(), seg('• PDF okur, HTML/TXT olarak dışa aktarır', dim), nl(),
      nl(),
    ],

    // ─── Örnek 1: Kod sorusu ──────────────────────────────────────────────
    [
      seg('  ─── Örnek 1: Kod Sorusu ───────────────────────────────────────', dim), nl(),
      sp(), seg('> ', user), seg('src/index.ts dosyasındaki hataları düzelt', user), nl(),
      nl(),
      sp(), seg('⏺ file_read', tool), seg(' · src/index.ts', dim), nl(),
      sp(), seg('⏺ file_edit', tool), seg(' · 3 satır düzeltildi', dim), nl(),
      nl(),
      sp(), seg('✓ ', ok), seg('Düzeltmeler uygulandı. TypeScript hatası giderildi.', ai), nl(),
      nl(),
    ],

    // ─── Örnek 2: Siber güvenlik ──────────────────────────────────────────
    [
      seg('  ─── Örnek 2: Güvenlik Taraması ──────────────────────────────────', dim), nl(),
      sp(), seg('> ', user), seg('example.com üzerinde port taraması yap', user), nl(),
      nl(),
      sp(), seg('⏺ nmap', tool), seg(' · example.com -sV -p 1-1000', dim), nl(),
      sp(), seg('  22/tcp  open  ssh     OpenSSH 8.9', dim), nl(),
      sp(), seg('  80/tcp  open  http    nginx 1.24', dim), nl(),
      sp(), seg('  443/tcp open  https   nginx 1.24', dim), nl(),
      nl(),
      sp(), seg('✓ ', ok), seg('3 açık port bulundu. SSH, HTTP, HTTPS aktif.', ai), nl(),
      nl(),
    ],

    // ─── Örnek 3: Bellek ──────────────────────────────────────────────────
    [
      seg('  ─── Örnek 3: Kalıcı Bellek ────────────────────────────────────', dim), nl(),
      sp(), seg('> ', user), seg('/hafıza ekle project Bu proje Next.js + Prisma kullanıyor', user), nl(),
      sp(), seg('✓ ', ok), seg('Belleğe kaydedildi (project)', ai), nl(),
      nl(),
      sp(), seg('> ', user), seg('/hafıza', user), nl(),
      sp(), seg('🧠 project: Bu proje Next.js + Prisma kullanıyor', ai), nl(),
      nl(),
    ],

    // ─── Komutlar özeti ───────────────────────────────────────────────────
    [
      seg('  ─── Temel Komutlar ─────────────────────────────────────────────', dim), nl(),
      sp(), seg('/yardım', cmd as (s: string) => string),     seg('        Tüm komutları listele', dim), nl(),
      sp(), seg('/doktor', cmd as (s: string) => string),     seg('        Araç kontrolü + otomatik kurulum', dim), nl(),
      sp(), seg('/hafıza', cmd as (s: string) => string),     seg('        Kalıcı bellek yönetimi', dim), nl(),
      sp(), seg('/bağlam', cmd as (s: string) => string),     seg('        Token & araç kullanım analizi', dim), nl(),
      sp(), seg('/kaydet html', cmd as (s: string) => string),seg('   Konuşmayı HTML olarak kaydet', dim), nl(),
      sp(), seg('/görevler', cmd as (s: string) => string),   seg('      Arka plan görevleri', dim), nl(),
      sp(), seg('/tema', cmd as (s: string) => string),       seg('          6 renk teması', dim), nl(),
      nl(),
      seg('  Ctrl+R', chalk.cyan), seg(' geçmiş arama  ', dim),
      seg('Esc', chalk.cyan), seg(' yanıtı durdur  ', dim),
      seg('\\', chalk.cyan), seg(' çok satırlı girdi', dim), nl(),
      nl(),
      seg('  Tam liste için ', dim), seg('/yardım', cmd as (s: string) => string), seg(' yazın.', dim), nl(),
      nl(),
    ],
  ];
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function runNasilCalisirAnimation(): Promise<void> {
  const tty = process.stdout.isTTY;
  const charMs = tty ? 10 : 0;
  const stepMs = tty ? 200 : 0;

  for (const step of buildSteps()) {
    for (const seg of step) {
      for (const ch of seg.text) {
        process.stdout.write(seg.style(ch));
        if (charMs > 0) await delay(charMs);
      }
    }
    if (stepMs > 0) await delay(stepMs);
  }
}
