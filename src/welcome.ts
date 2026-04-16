import chalk from 'chalk';
import * as os from 'os';
import { navyBright, navyDim, navyMuted } from './theme.js';
import { VERSION } from './version.js';
import { updateStatus } from './renderer.js';

// ─── SETH Merkezi Loglama Sistemi ────────────────────────────────────────────

export function sethLog(operation: string): void {
  // Terminale yeni satır basmak yerine spinner veya durum çubuğunu günceller.
  // Bu sayede ekran kirliliği önlenir ve otonom hissi pekişir.
  updateStatus(operation);
}

// ─── SETH ANSI Kırmızı Figlet Logo ───────────────────────────────────────────

// Her karakter ayrı ayrı çizildi — figlet "block" fontu türevleri
const SETH_LOGO = [
  ' ███████╗███████╗████████╗██╗  ██╗',
  ' ██╔════╝██╔════╝╚══██╔══╝██║  ██║',
  ' ███████╗█████╗     ██║   ███████║',
  ' ╚════██║██╔══╝     ██║   ██╔══██║',
  ' ███████║███████╗   ██║   ██║  ██║',
  ' ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝',
].map(l => `\x1b[1;31m${l}\x1b[0m`);

const SLOGAN = '\x1b[2;31m  HİÇBİR SİSTEM GÜVENLİ DEĞİLDİR\x1b[0m';

function shortenPath(fullPath: string): string {
  const home = os.homedir();
  if (fullPath.startsWith(home)) {
    return '~' + fullPath.slice(home.length).replace(/\\/g, '/');
  }
  return fullPath.replace(/\\/g, '/');
}

export function renderWelcomeAnimation(provider: string, model: string, userEmail?: string): void {
  console.clear();
  const cwd = shortenPath(process.cwd());
  const cols = Math.max(40, process.stdout.columns ?? 80);

  const showAscii = cols >= 40;

  const lines: string[] = [''];

  if (showAscii) {
    // ANSI kırmızı SETH figlet logosu
    for (const l of SETH_LOGO) {
      lines.push(l);
    }
    lines.push(SLOGAN);
    lines.push(navyDim(`  v${VERSION}`));
  } else {
    lines.push(`\x1b[1;31m  SETH\x1b[0m` + navyDim(` v${VERSION}`));
    lines.push(SLOGAN);
  }

  lines.push('');
  if (userEmail) {
    lines.push(`\x1b[38;5;121m  👤 ${userEmail}\x1b[0m`); // Yeşil email
  }

  lines.push(
    navyBright(`  ✦ ${provider}/${model}`),
    navyMuted(`  ⌂ ${cwd}`),
    '',
    navyDim('  /yardım → komutlar  •  Ctrl+C → iptal  •  Ctrl+D → çıkış'),
    '',
  );

  process.stdout.write(lines.join('\n'));
}
