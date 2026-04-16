/**
 * @fileoverview SETH — Terminal çıktı işlemcisi.
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { Marked } from 'marked';
import markedTerminal from 'marked-terminal';
import stripAnsi from 'strip-ansi';
import * as os from 'os';
import { VERSION } from './version.js';
import { navyBright, navyDim, navyMuted, promptBright, toolAccent } from './theme.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const marked = new Marked();
let markedTerminalWidth = -1;

function ensureMarkedTerminalWidth(): void {
  const w = Math.max(40, Math.min(200, process.stdout.columns ?? 80));
  if (w === markedTerminalWidth) return;
  markedTerminalWidth = w;
  marked.setOptions({
    renderer: new (markedTerminal as any)({
      reflowText: true,
      width: w,
      showSectionPrefix: false,
    }),
  });
}

let spinner: Ora | null = null;
let cycleInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Ora stop() sırasında clear() birden fazla satırı yukarı siliyor; sarmalanmış
 * spinner metni kullanıcı satırını ve boşlukları siliyor. Tek satıra indir.
 */
function truncateForSpinnerOneLine(text: string): string {
  const cols = Math.max(24, process.stdout.columns ?? 80);
  const plain = stripAnsi(text).replace(/\s+/g, ' ').trim();
  const maxLen = Math.max(10, cols - 10);
  if (plain.length <= maxLen) return text;
  const cut = plain.slice(0, Math.max(1, maxLen - 1)) + '…';
  return chalk.dim(cut);
}

// ─────────────────────────────────────────────
// Spinner helpers
// ─────────────────────────────────────────────

const THINK_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const THINK_MESSAGES = [
  'Düşünüyor…',
  'Bağlam inceleniyor…',
  'Strateji planlanıyor…',
  'Seçenekler değerlendiriliyor…',
  'Derin analiz yapılıyor…',
  'Araçlar kontrol ediliyor…'
];

export type ThinkingSpinnerMode = 'minimal' | 'animated';

export interface StartSpinnerOptions {
  thinkingMode?: ThinkingSpinnerMode;
}

export function startSpinner(
  text: string,
  thinking = false,
  opts?: StartSpinnerOptions,
): void {
  text = truncateForSpinnerOneLine(text);
  const color = thinking ? 'gray' : 'blue';
  const thinkingMode = opts?.thinkingMode ?? 'animated';
  const useMinimalThinking = thinking && thinkingMode === 'minimal';

  if (cycleInterval) {
    clearInterval(cycleInterval);
    cycleInterval = null;
  }

  if (spinner) {
    spinner.color = color;
    spinner.text = text;
    if (thinking && !useMinimalThinking) spinner.spinner = { frames: THINK_FRAMES, interval: 80 };
    else spinner.spinner = 'dots';
  } else {
    spinner = ora({
      text,
      color,
      spinner:
        thinking && !useMinimalThinking
          ? { frames: THINK_FRAMES, interval: 80 }
          : 'dots',
    }).start();
  }

  if (thinking && !useMinimalThinking) {
    let i = 0;
    if (spinner && text === 'Düşünüyor…') {
      spinner.text = truncateForSpinnerOneLine(THINK_MESSAGES[0]!);
    }
    cycleInterval = setInterval(() => {
      if (spinner) {
        i = (i + 1) % THINK_MESSAGES.length;
        spinner.text = truncateForSpinnerOneLine(THINK_MESSAGES[i]!);
      }
    }, 3000);
  }
}

export function stopSpinner(success = true, text?: string): void {
  if (cycleInterval) { clearInterval(cycleInterval); cycleInterval = null; }
  if (!spinner) return;
  if (text) spinner.text = text;
  if (success) spinner.succeed();
  else spinner.fail();
  spinner = null;
}

export function clearSpinner(): void {
  if (cycleInterval) { clearInterval(cycleInterval); cycleInterval = null; }
  if (spinner) {
    spinner.stop();
    spinner = null;
  }
}

export function renderMarkdown(text: string): string {
  try {
    ensureMarkedTerminalWidth();
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}

/**
 * Model bazen yanıtın başına kullanıcı cümlesini tekrarlar; yalnızca ekranda kırpılır.
 */
export function stripLeadingUserEchoFromAssistantDisplay(
  assistantText: string,
  userMessageSent: string,
): string {
  const userTrim = userMessageSent.trim();
  if (!userTrim || userTrim.length > 600) return assistantText;

  const userSingleLine = userTrim.replace(/\s+/g, ' ').slice(0, 400);
  const userNormLower = userSingleLine.toLowerCase();
  let t = assistantText.trimStart();

  const firstLine = (t.split('\n', 1)[0] ?? '').trim();
  const firstNorm = firstLine.replace(/\s+/g, ' ');
  const firstNormLower = firstNorm.toLowerCase();
  if (
    firstNorm === userSingleLine ||
    firstLine === userTrim ||
    firstNormLower === userNormLower
  ) {
    const idx = t.indexOf('\n');
    t = idx === -1 ? '' : t.slice(idx + 1).trimStart();
  }

  if (!t.trim()) return assistantText;

  const firstPara = (t.split(/\n\n/, 1)[0] ?? '').trim();
  if (firstPara.length > 0 && firstPara.length < 500) {
    const paraNorm = firstPara.replace(/\s+/g, ' ');
    if (paraNorm === userSingleLine || paraNorm.toLowerCase() === userNormLower) {
      const restIdx = t.indexOf('\n\n');
      t = restIdx === -1 ? '' : t.slice(restIdx + 2).trimStart();
    }
  }

  return t.trim() ? t : assistantText;
}

// ─────────────────────────────────────────────
// Welcome screen — Claude Code style
// ─────────────────────────────────────────────

function shortenPath(fullPath: string): string {
  const home = os.homedir();
  if (fullPath.startsWith(home)) {
    return '~' + fullPath.slice(home.length).replace(/\\/g, '/');
  }
  return fullPath.replace(/\\/g, '/');
}

export function renderWelcome(provider: string, model: string): string {
  const cwd = shortenPath(process.cwd());
  const shortModel = model.length > 30 ? model.slice(0, 27) + '…' : model;

  return [
    '',
    navyBright(chalk.bold('  SETH')) + navyDim(` v${VERSION}`),
    navyBright(`  ✦ ${provider}/${shortModel}`),
    navyMuted(`  ⌂ ${cwd}`),
    '',
    navyDim('  /yardim → komutlar  •  Ctrl+C → iptal  •  Ctrl+D → çıkış'),
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────
// Tool call / result rendering
// ─────────────────────────────────────────────

/** Human-readable spinner text for a tool being executed. */
export function getToolSpinnerText(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'shell': {
      const cmd = String(input.command ?? '').slice(0, 50);
      return `Komut çalıştırılıyor: ${chalk.dim(cmd)}`;
    }
    case 'file_write': return `Dosya yazılıyor: ${chalk.dim(String(input.path ?? ''))}`;
    case 'file_read':  return `Dosya okunuyor: ${chalk.dim(String(input.path ?? ''))}`;
    case 'file_edit':  return `Dosya düzenleniyor: ${chalk.dim(String(input.path ?? ''))}`;
    case 'search':
    case 'grep':
      return `Aranıyor: ${chalk.dim(String(input.query ?? ''))}`;
    case 'list_directory': return `Dizine bakılıyor: ${chalk.dim(String(input.path ?? '.'))}`;
    case 'glob':       return `Dosyalar taranıyor: ${chalk.dim(String(input.pattern ?? ''))}`;
    case 'batch_read': {
      const paths = input.paths as string[] | undefined;
      return `Çoklu okuma yapılıyor: ${chalk.dim(`${paths?.length ?? 0} dosya`)}`;
    }
    default: return `${name} çalıştırılıyor…`;
  }
}

export function renderToolCall(name: string, input: Record<string, unknown>): string {
  const detail = formatToolInput(name, input);
  const humanName = getToolDisplayName(name);
  return toolAccent('  ⏺ ') + chalk.bold.white(humanName) + chalk.dim(` · ${detail}`);
}

function getToolDisplayName(name: string): string {
  switch (name) {
    case 'shell': return 'Terminal';
    case 'file_write': return 'Yazma';
    case 'file_read': return 'Okuma';
    case 'file_edit': return 'Düzenleme';
    case 'list_directory': return 'Dizin';
    case 'search':
    case 'grep': return 'Arama';
    case 'glob': return 'Tarama';
    case 'agent_spawn': return 'Alt-Ajan';
    case 'enter_plan_mode': return 'Plan Modu Gir';
    case 'exit_plan_mode': return 'Plan Modu Çık';
    case 'web_search': return 'Gerçek Web Arama';
    case 'web_ara': return 'Web Arama';
    default: return name;
  }
}

const MAX_PREVIEW_LINES = 10;

export function renderToolResult(
  name: string,
  output: string,
  isError: boolean,
  data?: import('./types.js').FileToolData | import('./types.js').AgentToolData,
): string {
  if (isError) {
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    const first = lines[0] ?? '';
    const preview = first.length > 110 ? first.slice(0, 110) + '…' : first;
    const extra = lines.length > 1 ? chalk.dim(` +${lines.length - 1}`) : '';
    return chalk.dim('      ') + chalk.redBright('● ') + chalk.red(`${preview}${extra}\n`);
  }

  // Özel premium (Apple-like) çıktılar
  if (name === 'gorev_ekle' || name === 'gorev_guncelle' || name === 'gorev_yaz') {
    return chalk.dim('      ') + chalk.greenBright('✓ ') + chalk.whiteBright(output.trim().split('\n')[0] ?? '') + '\n';
  }

  // ── Alt-Ajan Sonucu (data varsa) ───────────────────────────────────────────
  if (name === 'agent_spawn' && data && 'toolCalls' in data) {
    const agentData = data as unknown as import('./types.js').AgentToolData;
    const totalTokens = (agentData.inputTokens ?? 0) + (agentData.outputTokens ?? 0);
    const kStr = totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : `${totalTokens}`;
    const tokenStr = totalTokens > 0 ? ` · ${kStr} token` : '';
    const turnStr = ` · ${agentData.turns} tur`;
    
    return chalk.dim('      ') + chalk.blueBright('└─ ') + chalk.bold.white('Alt-Ajan Tamamlandı') + '\n' +
           chalk.dim('         ') + chalk.dim(`Özet: ${agentData.toolCalls} araç kullanımı${tokenStr}${turnStr}`) + '\n\n' +
           chalk.dim('         ') + chalk.dim('Çıktı: ') + output.split('\n\n').slice(1).join('\n\n').replace(/\n/g, '\n         ') + '\n';
  }

  // ── Akıllı dosya önizlemesi (data varsa) ──────────────────────────────────
  if ((name === 'file_write' || name === 'file_edit') && data) {
    return renderFileToolResult(name, data as import('./types.js').FileToolData);
  }

  // Eski yol: data yoksa sade satır
  if (name === 'file_write' || name === 'file_edit') {
    return chalk.dim('      ') + chalk.cyanBright('✓ ') + chalk.white('Dosya başarıyla güncellendi.') + '\n';
  }

  const lines = output.split('\n').filter(l => l.trim().length > 0);
  const first = lines[0] ?? '';
  const preview = first.length > 110 ? first.slice(0, 110) + '…' : first;
  const extra = lines.length > 1 ? chalk.dim(` +${lines.length - 1}`) : '';

  return chalk.dim('      ') + chalk.greenBright('● ') + chalk.dim(`${preview}${extra}\n`);
}

/**
 * file_write / file_edit için truncated önizleme.
 * İlk MAX_PREVIEW_LINES satırı gösterir, kalanı "… +N satır daha" ile kapatır.
 */
function renderFileToolResult(name: string, data: import('./types.js').FileToolData): string {
  const indent = '      ';
  const lines: string[] = [];

  if (data.type === 'create') {
    // Yeni dosya oluşturuldu
    lines.push(
      indent + chalk.cyanBright('✦ ') +
      chalk.bold.white(data.path) +
      chalk.dim(` · ${data.lineCount} satır yazıldı`),
    );

    if (data.content) {
      const contentLines = data.content.split('\n');
      const preview = contentLines.slice(0, MAX_PREVIEW_LINES);
      const remaining = contentLines.length - preview.length;

      lines.push(indent + chalk.dim('┌' + '─'.repeat(48)));
      for (const line of preview) {
        const truncated = line.length > 80 ? line.slice(0, 79) + '…' : line;
        lines.push(indent + chalk.dim('│ ') + chalk.white(truncated));
      }
      if (remaining > 0) {
        lines.push(indent + chalk.dim(`│ … +${remaining} satır daha`));
      }
      lines.push(indent + chalk.dim('└' + '─'.repeat(48)));
    }
  } else {
    // Dosya güncellendi (file_edit)
    const summaryText = data.summary ?? 'Güncellendi';
    lines.push(
      indent + chalk.greenBright('✦ ') +
      chalk.bold.white(data.path) +
      chalk.dim(` · ${summaryText} · toplam ${data.lineCount} satır`),
    );

    if (data.diff) {
      // Diff'ten sadece +/- satırlarını al, MAX_PREVIEW_LINES kadar göster
      const diffLines = data.diff.split('\n').filter(l =>
        l.startsWith('\x1b[31m-') || l.startsWith('\x1b[32m+'),
      );
      const preview = diffLines.slice(0, MAX_PREVIEW_LINES);
      const remaining = diffLines.length - preview.length;

      lines.push(indent + chalk.dim('┌' + '─'.repeat(48)));
      for (const line of preview) {
        // Satır zaten ANSI renkli (kırmızı/yeşil), sadece indent ekle
        lines.push(indent + chalk.dim('│ ') + line);
      }
      if (remaining > 0) {
        lines.push(indent + chalk.dim(`│ … +${remaining} satır daha`));
      }
      lines.push(indent + chalk.dim('└' + '─'.repeat(48)));
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Spinner metnini veya otonom durumu günceller.
 */
export function updateStatus(operation: string): void {
  const text = `${operation}…`;
  if (spinner && spinner.isSpinning) {
    spinner.text = truncateForSpinnerOneLine(text);
    if (cycleInterval) {
      clearInterval(cycleInterval);
      cycleInterval = setInterval(() => {
        if (spinner) {
          const i = Math.floor(Math.random() * THINK_MESSAGES.length);
          spinner.text = truncateForSpinnerOneLine(THINK_MESSAGES[i]!);
        }
      }, 4000);
    }
  } else {
    // Başlangıçta veya araç geçişlerinde kirlilik yaratmamak için sadece stderr'e çok kısa basıyoruz.
    // Ancak REPL prompt'u ile çakışmaması için 800ms sonra kesin kapatıyoruz.
    startSpinner(text, false);
    setTimeout(() => {
      if (spinner && spinner.text.includes(operation)) {
        clearSpinner();
      }
    }, 800);
  }
}

// ─────────────────────────────────────────────
// Error / stats / misc
// ─────────────────────────────────────────────

export function renderError(error: Error | string): string {
  const message = typeof error === 'string' ? error : error.message;
  return chalk.red(`\n  ✗ ${message}\n`);
}

export function renderStats(
  inputTokens: number,
  outputTokens: number,
  turns: number,
): string {
  const total = inputTokens + outputTokens;
  const parts: string[] = [];

  if (total > 0) {
    const kStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
    parts.push(chalk.dim(`${kStr} token`));
  }
  if (turns > 1) parts.push(chalk.dim(`${turns} tur`));

  return parts.length > 0 ? chalk.dim('  ') + parts.join(chalk.dim(' · ')) : '';
}

export function renderProviderSwitch(from: string, to: string): string {
  return chalk.dim(`\n  ↻ ${from} → ${to}\n`);
}

// ─────────────────────────────────────────────
// Prompt string — with token context
// ─────────────────────────────────────────────

export function getPromptString(
  _provider: string,
  _model: string,
  context?: { messages: number; tokens: number; lane?: 'a' | 'b'; budgetTokens?: number },
): string {
  const promptSymbol = promptBright('>');

  if (context && (context.messages > 0 || context.tokens > 0)) {
    const tokenStr = context.tokens >= 1000
      ? `${(context.tokens / 1000).toFixed(1)}k`
      : String(context.tokens);
    const budgetStr =
      context.budgetTokens !== undefined
        ? (context.budgetTokens >= 1000
          ? `${(context.budgetTokens / 1000).toFixed(0)}k`
          : String(context.budgetTokens))
        : '';

    const lanePart = context.lane ? `${context.lane.toUpperCase()} · ` : '';
    const msgPart = `${context.messages}msg`;
    const tokPart = `${tokenStr}tok`;
    const budgetPart = budgetStr ? ` / ${budgetStr}` : '';

    const tag = chalk.dim(`[${lanePart}${msgPart} · ${tokPart}${budgetPart}]`);

    // Claude Code stilinde: önce sembol, sonra bar (biraz boşlukla)
    return `\n${promptSymbol} ${tag} `;
  }

  return `\n${promptSymbol} `;
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

function formatToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'shell':          return String(input.command ?? '').slice(0, 72);
    case 'file_read':      return String(input.path ?? '');
    case 'file_write':     return String(input.path ?? '');
    case 'file_edit':      return String(input.path ?? '');
    case 'search':
    case 'grep':
      return `"${input.query}" in ${input.dir ?? '.'}`;
    case 'list_directory': return String(input.path ?? '.');
    case 'glob':           return String(input.pattern ?? '');
    case 'batch_read': {
      const paths = input.paths as string[] | undefined;
      return paths ? `${paths.length} dosya` : '';
    }
    case 'web_ara': return String(input.sorgu ?? '');
    case 'arac_ara': return String(input.sorgu ?? '');
    case 'mcp_arac': return `${input.islem} @ ${input.sunucu}`;
    case 'takim_olustur':
    case 'takim_oku':
      return String(input.takim_adi ?? '');
    case 'gorev_ekle':
      return `${input.id} ${input.baslik}`;
    case 'gorev_guncelle':
      return String(input.id ?? '');
    case 'agent_spawn': return String(input.task ?? '');
    case 'web_search': return String(input.sorgu ?? '');
    default: return JSON.stringify(input).slice(0, 72);
  }
}
