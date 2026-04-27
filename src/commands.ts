/**
 * @fileoverview Slash command handlers.
 */

import chalk from 'chalk';
import { cmd, promptBright } from './theme.js';
import { setAlias, listAliases, deleteAlias, getAlias } from './commands/alias.js';
import { listTemplates, getTemplate, applyTemplate, setTemplate, deleteTemplate } from './commands/sablon.js';
import { logUsage, getUsageStats, getCostEstimate } from './commands/maliyet.js';
import { select, isCancel, confirm, text } from '@clack/prompts';
import { writeFile } from 'fs/promises';
import { resolve, join } from 'path';
import { homedir } from 'os';
import type {
  ProviderName,
  SETHConfig,
  ChatMessage,
  PermissionLevel,
  ThinkingStyle,
  SecurityProfile,
  EffortLevel,
} from './types.js';
import { VERSION } from './version.js';
import { todoListesiniOku } from './session-runtime.js';
import { runRepoOzetSummary } from './tools/repo-ozet.js';
import { runSorWizard } from './sor-wizard.js';
import { runNasilCalisirAnimation } from './nasilcalisir.js';
import { sethEngine } from './tools/seth-engine.js';
import { readMemory, writeMemory, appendMemory, loadAllMemories, type MemoryType } from './storage/memory.js';
import { loadHooks, getHooksExample } from './hooks.js';
import { loadHistory } from './storage/history.js';
import { exportSecurityReport } from './security-report.js';
import { 
  resolveModel, 
  loadConfig, 
  saveConfig, 
  persistProviderAndModel, 
  getEffectiveContextBudgetTokens,
  deleteApiKey,
} from './config/settings.js';
import { listSessions, setSessionTag } from './storage/session.js';
import { THEMES, type ThemeName, setTheme, getThemeColors } from './theme.js';
import { runDoktor } from './commands/doktor.js';
import { checkForUpdates, performSelfUpdate } from './update-check.js';
import { listModels } from './providers/factory.js';
import { getModelPrice, calculateCostUSD, formatCostUSD } from './model-cost.js';
import { listAllSkills, findSkill, renderSkill, formatSkillsTable } from './skills.js';
import { formatKeybindingsTable, loadKeybindings } from './keybindings.js';
import { getActiveSubAgentCount } from './agent/coordinator.js';

export interface CommandContext {
  config: SETHConfig;
  currentProvider: ProviderName;
  currentModel: string;
  toolsEnabled: boolean;
  agentEnabled: boolean;
  setProvider: (name: ProviderName) => Promise<void>;
  setModel: (model: string) => void;
  setToolsEnabled: (enabled: boolean) => void;
  setAgentEnabled: (enabled: boolean) => void;
  clearHistory: (scope?: 'active' | 'all') => void;
  getContextBudgetTokens: () => number;
  setContextBudgetTokens: (n: number) => void;
  getActiveLane: () => 'a' | 'b';
  setActiveLane: (lane: 'a' | 'b') => void;
  compactHistory: () => Promise<{ before: number; after: number } | null>;
  undoHistory: () => boolean;
  changeCwd: (dir: string) => string | null;
  getCwd: () => string;
  getHistory: () => ChatMessage[];
  getPermissionLevel: () => PermissionLevel;
  setPermissionLevel: (level: PermissionLevel) => void;
  getSecurityProfile: () => SecurityProfile;
  setSecurityProfile: (profile: SecurityProfile) => void;
  getStats: () => { messages: number; inputTokens: number; outputTokens: number; turns: number };
  getSessionId: () => string;
  setThinkingStyle: (style: ThinkingStyle) => void;
  setEffort: (level: EffortLevel) => void;
  setVimMode: (enabled: boolean) => void;
  getMessages?: () => ChatMessage[];
  setMaxConcurrentTools?: (n: number) => void;
  getMaxConcurrentTools?: () => number;
  setHistory?: (messages: ChatMessage[]) => void;
  getLaneHistoriesB?: () => ChatMessage[];
  approvePlanFromWeb?: () => void;
  rejectPlanFromWeb?: () => void;
  getDeepSeekThinking?: () => boolean;
  setDeepSeekThinking?: (enabled: boolean) => void;
}

export interface CommandResult {
  output?: string;
  shouldExit?: boolean;
  clearAndAnimate?: boolean;
  clearTerminal?: boolean;
  runAsUserMessage?: string;
}

const PERM_LABELS: Record<PermissionLevel, string> = {
  full: 'Tam — hiçbir şey sormaz',
  normal: 'Normal — yazma/çalıştırma işlemleri onay ister',
  dar: 'Dar — her araç onay ister',
};

type HelpSection = 'Bilgi & Analiz' | 'Bellek & Oturum' | 'Ayarlar' | 'Araçlar & Sistem';
interface CommandHelpItem {
  readonly section: HelpSection;
  readonly name: string;
  readonly usage?: string;
  readonly description: string;
}

const COMMAND_HELP_CONTRACT: readonly CommandHelpItem[] = [
  { section: 'Bilgi & Analiz', name: 'yardım', description: 'Tüm komutları göster' },
  { section: 'Bilgi & Analiz', name: 'özellikler', description: 'SETH yetenek raporunu göster' },
  { section: 'Bilgi & Analiz', name: 'harita', description: 'Canlı operasyon haritası (SETH Engine)' },
  { section: 'Bilgi & Analiz', name: 'istatistikler', description: 'Token kullanımı, maliyet tahmini, günlük kullanım' },
  { section: 'Bilgi & Analiz', name: 'kullanım', description: 'Bugünkü kullanım limitinizi göster' },
  { section: 'Bilgi & Analiz', name: 'bağlam', description: 'Token dağılımı, araç kullanım analizi' },
  { section: 'Bilgi & Analiz', name: 'ara', usage: '<kelime>', description: 'Mevcut konuşmada ara' },
  { section: 'Bilgi & Analiz', name: 'doktor', description: 'Ortam sağlığı + araç kontrolü + otomatik kurulum' },
  { section: 'Bilgi & Analiz', name: 'repo_özet', description: 'Git: dal, son commit, diff --stat, status' },
  { section: 'Bilgi & Analiz', name: 'güncelle', description: 'Yeni sürüm kontrolü (semver)' },
  { section: 'Bilgi & Analiz', name: 'provider-test', usage: '[--auto]', description: 'Provider latency/model/maliyet paneli' },
  { section: 'Bellek & Oturum', name: 'hafıza', description: 'Kalıcı belleği göster (user/project/feedback/reference)' },
  { section: 'Bellek & Oturum', name: 'hafıza', usage: 'ekle <tip> <içerik>', description: 'Belleğe yeni giriş ekle' },
  { section: 'Bellek & Oturum', name: 'hafıza', usage: 'sil <tip>', description: 'Belirli bellek tipini temizle' },
  { section: 'Bellek & Oturum', name: 'hafıza-temizle', description: 'Tüm kalıcı belleği sil (onay ister)' },
  { section: 'Bellek & Oturum', name: 'bellek', description: 'Görev listesi + oturum özeti' },
  { section: 'Bellek & Oturum', name: 'context-temizle', description: 'Konuşma geçmişini + terminali temizle' },
  { section: 'Bellek & Oturum', name: 'temizle', description: 'Terminali temizle (geçmiş korunur)' },
  { section: 'Bellek & Oturum', name: 'sıkıştır', description: 'Geçmişi AI ile özetle ve sıkıştır' },
  { section: 'Bellek & Oturum', name: 'geri', description: 'Son mesajı geri al' },
  { section: 'Bellek & Oturum', name: 'kaydet', usage: '[md|html|txt|cast] [dosya]', description: 'Konuşmayı dışa aktar' },
  { section: 'Bellek & Oturum', name: 'export', usage: '[json|md|html|obsidian] [dosya]', description: 'Oturumu dışa aktar' },
  { section: 'Bellek & Oturum', name: 'geçmiş', description: 'Önceki oturumu devam ettir' },
  { section: 'Bellek & Oturum', name: 'etiket', usage: '<isim>', description: 'Oturumu adlandır / etiketle' },
  { section: 'Ayarlar', name: 'değiştir', description: 'Etkileşimli ayar menüsü' },
  { section: 'Ayarlar', name: 'sağlayıcı', usage: '<isim>', description: 'Sağlayıcı değiştir' },
  { section: 'Ayarlar', name: 'model', usage: '<isim>', description: 'Model adını doğrudan ayarla' },
  { section: 'Ayarlar', name: 'profil', usage: '[liste|ekle <isim>|<isim>]', description: 'Kayıtlı sağlayıcı+model profilleri' },
  { section: 'Ayarlar', name: 'modeller', description: 'Mevcut modelleri listele ve seç' },
  { section: 'Ayarlar', name: 'araçlar', usage: '<açık|kapalı>', description: 'Araç kullanımını aç/kapat' },
  { section: 'Ayarlar', name: 'ajan', usage: '<açık|kapalı>', description: 'Çok tur ajan modunu aç/kapat' },
  { section: 'Ayarlar', name: 'yetki', usage: '<full|normal|dar>', description: 'İzin seviyesini ayarla' },
  { section: 'Ayarlar', name: 'güvenlik', usage: '<safe|standard|pentest>', description: 'Güvenlik profilini ayarla' },
  { section: 'Ayarlar', name: 'tema', description: 'Renk teması (dark, light, cyberpunk, retro, ocean, sunset)' },
  { section: 'Ayarlar', name: 'apikey', usage: '[liste|sil <provider>]', description: 'API anahtarlarını yönet / sil' },
  { section: 'Ayarlar', name: 'api-yaz', description: 'Etkileşimli API anahtarı ekleme menüsü' },
  { section: 'Ayarlar', name: 'context', usage: '<miktar>', description: 'Token bütçesi (örn: 500k, 2M)' },
  { section: 'Araçlar & Sistem', name: 'hook', usage: '[liste|örnek]', description: 'Hook sistemi (PreToolUse/PostToolUse)' },
  { section: 'Araçlar & Sistem', name: 'rapor', usage: 'pdf', description: 'Güvenlik taramasını LaTeX/PDF olarak aktar' },
  { section: 'Araçlar & Sistem', name: 'görevler', description: 'Arka plan görevlerini listele' },
  { section: 'Bellek & Oturum', name: 'checkpoint', usage: '[ad] | listele | yükle <ad> | sil <ad>', description: 'Konuşma anını kaydet / geri yükle' },
  { section: 'Ayarlar', name: 'plan-modu', usage: '<açık|kapalı>', description: 'Plan modu — karmaşık görevlerde önce plan onayı iste' },
  { section: 'Ayarlar', name: 'paralel', usage: '<1-20>', description: 'Eşzamanlı araç sayısını ayarla (varsayılan: 5)' },
  { section: 'Bilgi & Analiz', name: 'pr-incele', usage: '<PR numarası veya URL>', description: 'GitHub PR diff + yorumlarını AI ile değerlendir' },
  { section: 'Araçlar & Sistem', name: 'ide', usage: '[dosya:satır]', description: 'Dosyayı VS Code veya varsayılan editörde aç' },
  { section: 'Araçlar & Sistem', name: 'yan-sorgu', usage: '<soru>', description: 'Konuşmayı bozmadan hızlı soru sor' },
  { section: 'Araçlar & Sistem', name: 'sor', description: 'İstek sihirbazını başlat' },
  { section: 'Araçlar & Sistem', name: 'dusunme', usage: '[minimal|animated]', description: 'Düşünme göstergesini aç/kapat' },
  { section: 'Araçlar & Sistem', name: 'effort', usage: '[low|medium|high|max]', description: 'Düşünme derinliği' },
  { section: 'Araçlar & Sistem', name: 'cron', usage: '[liste|ekle|sil]', description: 'Periyodik görevleri yönet' },
  { section: 'Araçlar & Sistem', name: 'cd', usage: '<dizin>', description: 'Çalışma dizinini değiştir' },
  { section: 'Araçlar & Sistem', name: 'pwd', description: 'Mevcut dizini göster' },
  { section: 'Araçlar & Sistem', name: 'nasılçalışır', description: 'Canlı demo (typewriter animasyonu)' },
  { section: 'Araçlar & Sistem', name: 'kabuk-kurulum', description: 'Bash/Zsh/Fish shell tamamlamasını kur' },
  { section: 'Araçlar & Sistem', name: 'cikis', description: 'Uygulamadan çık' },
  // v3.9.2
  { section: 'Bilgi & Analiz', name: 'maliyet', description: 'Oturum maliyet tablosu (token × birim fiyat, saatlik tahmin)' },
  { section: 'Bellek & Oturum', name: 'paylaş', usage: '[son <N>] [json]', description: 'Konuşmayı ~/.seth/exports/ klasörüne aktar' },
  { section: 'Bilgi & Analiz', name: 'incele', usage: '[--staged|--head|<dosya>]', description: 'Staged/head diff\'i AI ile incele (code review)' },
  { section: 'Araçlar & Sistem', name: 'skills', description: 'Kullanılabilir skill\'leri listele' },
  { section: 'Araçlar & Sistem', name: 'skill', usage: '<ad> [parametreler]', description: 'Belirtilen skill\'i çalıştır' },
  { section: 'Ayarlar', name: 'keybindings', usage: '[sıfırla]', description: 'Tuş kısayollarını göster / sıfırla' },
  { section: 'Araçlar & Sistem', name: 'koordinator', usage: '<görev>', description: 'Koordinatör modu — görevi alt ajanlara bölerek paralel çalıştır' },
  { section: 'Araçlar & Sistem', name: 'ajanlar', description: 'Aktif alt ajan sayısını göster' },
  { section: 'Ayarlar', name: 'vim', description: 'Vim modu aç/kapat (INSERT/NORMAL)' },
];

const HELP_SECTION_ORDER: readonly HelpSection[] = ['Bilgi & Analiz', 'Bellek & Oturum', 'Ayarlar', 'Araçlar & Sistem'];

export function getPublicSlashCommands(): string[] {
  return Array.from(new Set(COMMAND_HELP_CONTRACT.map((x) => `/${x.name}`)));
}

export function getPublicCommandNames(): string[] {
  return Array.from(new Set(COMMAND_HELP_CONTRACT.map((x) => x.name)));
}

function formatHelpLines(): string[] {
  const lines: string[] = [];
  for (const section of HELP_SECTION_ORDER) {
    lines.push(chalk.dim(`  ─── ${section} ─────────────────────────────────────────`));
    const items = COMMAND_HELP_CONTRACT.filter((x) => x.section === section);
    for (const item of items) {
      const usage = item.usage ? ` ${chalk.dim(item.usage)}` : '';
      lines.push(`  ${cmd(`/${item.name}`)}${usage.padEnd(Math.max(1, 34 - item.name.length))} ${item.description}`);
    }
    lines.push('');
  }
  return lines;
}

function parseTokenBudget(input: string): number | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;
  const m = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const mult = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : m[2] === 'b' ? 1_000_000_000 : 1;
  return Math.round(base * mult);
}

// ─── Checkbox seçici (raw mode, boşluk=seç, Enter=onayla) ───────────────────
export const COMMANDS: Record<string, (args: string, ctx: CommandContext) => Promise<CommandResult> | CommandResult> = {
  yardım: (_args, ctx) => ({
    output: [
      chalk.bold(`SETH v${VERSION} — Komut Rehberi`),
      '',
      ...formatHelpLines(),
      chalk.dim('  ─── Kısayollar ───────────────────────────────────────────────'),
      chalk.dim('  Ctrl+C   İşlemi iptal et'),
      chalk.dim('  Ctrl+D   Çıkış'),
      chalk.dim('  Ctrl+R   Geçmiş fuzzy arama'),
      chalk.dim('  Esc      AI yanıtını durdur'),
      chalk.dim('  ↑↓       Geçmiş komutlar'),
      chalk.dim('  \\        Satır sonu — çok satırlı girdi'),
      '',
      chalk.dim(`  İzin: ${ctx.getPermissionLevel()}  •  Güvenlik: ${ctx.getSecurityProfile()}  •  Sağlayıcı: ${ctx.currentProvider}  •  Model: ${ctx.currentModel}`),
    ].join('\n'),
  }),
  özellikler: async () => ({
    output: `
🎯 SETH v${VERSION} 'LEVIATHAN' — Yetenek Raporu (v3.8.18)

1. Siber Harekat (Multi-Target Campaign)
   • IP aralıkları (CIDR) ve wildcard alan adları (*.site.com) üzerinde otonom harekat.
   • Ağdaki en zayıf halkayı (IoT, Printer, Legacy Server) otomatik tespit etme.

2. OSINT ve Sızıntı Verisi (Breach-Feeder)
   • breach_query: Hedef domain ile ilişkili sızdırılmış e-posta/şifre verilerini otonom çekme.
   • OSINT tabanlı akıllı brute-force saldırıları.
   • Shodan: Gerçek zamanlı ağ keşfi ve zafiyet tespiti.

3. Operasyon Haritası (Live Attack Map)
   • /harita: Operasyonun hangi aşamada olduğunu ve keşfedilen varlıkları görselleştirme.

4. Gelişmiş İstismar ve Denetim
   • bypass_cloudflare: Gerçek IP tespiti.
   • brute_force & exploit_search: Otonom sızma ve derinlemesine istismar (John/Hashcat).

SETH artık bir ordu gibi düşünen 'Leviathan' çekirdeğine sahip. Yaratıcısı: Mustafa Kemal Çıngıl 😈🐍🔥
`,
  }),

  harita: async () => {
    const res = await sethEngine({ target: 'STATE', action: 'get_map' });
    if (res.isError) return { output: chalk.red('Harita verisi alınamadı.') };
    
    const state = JSON.parse(res.output).data;
    let output = `\n${chalk.bold.cyan('🌐 SETH CANLI OPERASYON HARİTASI')}\n`;
    output += `${chalk.dim('Başlangıç:')} ${state.start_time}\n`;
    output += `─`.repeat(40) + '\n';

    for (const [target, info] of Object.entries(state.targets)) {
      const targetInfo = info as any;
      output += `${chalk.green('●')} ${chalk.bold(target)}\n`;
      if (targetInfo.subdomains.length) output += `  ├─ ${chalk.blue('Subdomainler:')} ${targetInfo.subdomains.length} adet\n`;
      if (targetInfo.ports.length) {
        output += `  ├─ ${chalk.yellow('Açık Portlar:')}\n`;
        targetInfo.ports.forEach((p: string) => output += `  │  └── ${p}\n`);
      }
      output += `  └─ ${chalk.magenta('Riskler:')} ${targetInfo.risks.length || 'Analiz Ediliyor'}\n`;
    }

    if (state.leaks.length) {
      output += `\n${chalk.red('🔥 SIZINTI VERİLERİ (BREACHES)')}\n`;
      state.leaks.forEach((l: any) => output += `  • ${l.user} [${l.source}]\n`);
    }

    return { output: output + '\n' };
  },

  kullanım: (_args, ctx) => {
    const s = ctx.getStats();
    const used = s.inputTokens + s.outputTokens;
    const budget = ctx.getContextBudgetTokens();
    const remain = Math.max(0, budget - used);
    const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
    return {
      output: [
        chalk.bold('📈 Kullanım'),
        '',
        `  Kullanılan token : ${chalk.cyan(used.toLocaleString())}`,
        `  Bütçe            : ${chalk.cyan(budget.toLocaleString())}`,
        `  Kalan            : ${chalk.cyan(remain.toLocaleString())}`,
        `  Doluluk          : ${pct >= 85 ? chalk.red(`${pct}%`) : pct >= 60 ? chalk.yellow(`${pct}%`) : chalk.green(`${pct}%`)}`,
      ].join('\n'),
    };
  },

  bağlam: (_args, ctx) => {
    const s = ctx.getStats();
    const used = s.inputTokens + s.outputTokens;
    const budget = ctx.getContextBudgetTokens();
    const lane = ctx.getActiveLane().toUpperCase();
    const messages = ctx.getHistory().length;
    const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
    return {
      output: [
        chalk.bold('🧭 Bağlam Durumu'),
        '',
        `  Aktif lane       : ${chalk.cyan(lane)}`,
        `  Mesaj sayısı     : ${chalk.cyan(messages.toLocaleString())}`,
        `  Giriş/Çıkış      : ${chalk.dim(s.inputTokens.toLocaleString())} / ${chalk.dim(s.outputTokens.toLocaleString())}`,
        `  Toplam token     : ${chalk.cyan(used.toLocaleString())} / ${chalk.cyan(budget.toLocaleString())}`,
        `  Bağlam doluluğu  : ${pct >= 85 ? chalk.red(`${pct}%`) : pct >= 60 ? chalk.yellow(`${pct}%`) : chalk.green(`${pct}%`)}`,
      ].join('\n'),
    };
  },

  doktor: async (_args, ctx) => runDoktor(ctx),

  repo_özet: async (_args, ctx) => runRepoOzetSummary(ctx.getCwd()),

  güncelle: async (args) => {
    // --auto flag'ı ile onaysız güncelleme
    const isAuto = args.includes('--auto');

    const result = await checkForUpdates();
    if (!result) {
      return { output: chalk.green(`✓ Güncel sürümdesiniz (v${VERSION})`) };
    }

    if (!result.hasUpdate) {
      return { output: chalk.green(`✓ Zaten en güncel sürümdesiniz (v${VERSION})`) };
    }

    // Yeni sürüm var — güncelleme teklifi
    const lines: string[] = [
      chalk.yellow('⬆️ Yeni sürüm mevcut!'),
      '',
      `  Güncel sürüm: ${chalk.cyan(VERSION)}`,
      `  Yeni sürüm  : ${chalk.green(result.latestVersion)}`,
      '',
    ];

    if (isAuto) {
      // Otomatik güncelleme
      lines.push(chalk.dim('🔄 Otomatik güncelleme başlatılıyor...'));

      const progressLines: string[] = [];
      const updateResult = await performSelfUpdate((msg) => {
        progressLines.push(msg);
      });

      lines.push(...progressLines.map(l => chalk.dim(l)));
      lines.push('');

      if (updateResult.success) {
        if (updateResult.method === 'none') {
          lines.push(chalk.green(updateResult.message));
        } else {
          lines.push(chalk.green(updateResult.message.split('\n')[0]!));
          lines.push(chalk.cyan(`  v${updateResult.previousVersion} → v${updateResult.newVersion}`));
          lines.push('');
          lines.push(chalk.yellow('  🔄 SETH yeniden başlatılmalı! (Ctrl+C → tekrar seth)'));
        }
      } else {
        lines.push(chalk.red(updateResult.message));
      }

      return { output: lines.join('\n') };
    }

    // Manuel mod — sadece bilgi ver
    lines.push(chalk.dim('  Otomatik güncelleme için:'));
    lines.push(chalk.dim(`    /güncelle --auto`));
    lines.push('');
    lines.push(chalk.dim('  Elle güncelleme:'));
    lines.push(chalk.dim('    npm install -g seth'));

    return { output: lines.join('\n') };
  },

  'provider-test': async (args, ctx) => {
    const auto = args.includes('--auto');
    const cfg = loadConfig();
    const localProviders: ProviderName[] = ['ollama', 'lmstudio', 'copilot'];
    const providers = Object.keys(cfg.providers) as ProviderName[];
    const testable = providers.filter((p) => localProviders.includes(p) || Boolean(cfg.providers[p]?.apiKey));

    if (testable.length === 0) {
      return { output: chalk.yellow('Test edilecek sağlayıcı bulunamadı. API anahtarı tanımlı değil.') };
    }

    type Probe = {
      provider: ProviderName;
      ok: boolean;
      latencyMs: number;
      model: string;
      modelCount: number;
      priceScore: number;
      error?: string;
    };
    const probes: Probe[] = [];

    for (const provider of testable) {
      const startedAt = Date.now();
      const cfgProvider = cfg.providers[provider];
      try {
        const models = await listModels(provider, cfgProvider);
        const latencyMs = Date.now() - startedAt;
        const selectedModel = models[0] ?? resolveModel(provider, cfg);
        const unitPrice = getModelPrice(selectedModel, provider);
        probes.push({
          provider,
          ok: true,
          latencyMs,
          model: selectedModel,
          modelCount: models.length,
          priceScore: unitPrice.input + unitPrice.output,
        });
      } catch (err) {
        probes.push({
          provider,
          ok: false,
          latencyMs: Date.now() - startedAt,
          model: resolveModel(provider, cfg),
          modelCount: 0,
          priceScore: Number.POSITIVE_INFINITY,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sorted = [...probes].sort((a, b) => (a.latencyMs + a.priceScore * 100) - (b.latencyMs + b.priceScore * 100));
    const fallback = sorted.find((p) => p.ok && p.provider !== ctx.currentProvider);

    if (auto && fallback) {
      saveConfig({ fallbackProvider: fallback.provider, fallbackModel: fallback.model });
    }

    const lines = [chalk.bold('🛰️ Provider Operasyon Paneli'), ''];
    for (const p of sorted) {
      const status = p.ok ? chalk.green('✓') : chalk.red('✗');
      const cost = Number.isFinite(p.priceScore) ? p.priceScore.toFixed(3) : 'n/a';
      const modelInfo = p.modelCount > 0 ? `${p.modelCount} model` : 'model yok';
      lines.push(`  ${status} ${p.provider.padEnd(10)} ${String(p.latencyMs).padStart(4)}ms  ${modelInfo.padEnd(12)}  birim-maliyet=${cost}`);
      if (!p.ok && p.error) lines.push(`      ${chalk.dim(p.error.slice(0, 140))}`);
    }
    lines.push('');
    if (fallback) {
      lines.push(`  Önerilen fallback: ${chalk.cyan(fallback.provider)} / ${chalk.cyan(fallback.model)}`);
      if (auto) lines.push(chalk.green('  ✓ Fallback ayarı otomatik kaydedildi.'));
      else lines.push(chalk.dim('  Otomatik kaydetmek için: /provider-test --auto'));
    } else {
      lines.push(chalk.dim('  Uygun fallback adayı bulunamadı.'));
    }
    return { output: lines.join('\n') };
  },

  yetki: async (args, ctx) => {
    const level = args.trim().toLowerCase();
    const valid: PermissionLevel[] = ['full', 'normal', 'dar'];
    if (!level) {
      const p = await select({
        message: 'İzin seviyesini seçin:',
        options: [
          { value: 'full',   label: 'Tam (onay istemez)' },
          { value: 'normal', label: 'Normal (yazma/çalıştırma onay ister)' },
          { value: 'dar',    label: 'Dar (her araç onay ister)' },
        ],
      });
      if (isCancel(p)) return { output: chalk.dim('İptal edildi.') };
      ctx.setPermissionLevel(p as PermissionLevel);
      saveConfig({ tools: { ...ctx.config.tools, requireConfirmation: p !== 'full' } });
      return { output: chalk.green(`✓ İzin seviyesi: ${p}`) };
    }
    if (!valid.includes(level as any)) return { output: chalk.red('Geçersiz seviye: full, normal, dar') };
    ctx.setPermissionLevel(level as PermissionLevel);
    saveConfig({ tools: { ...ctx.config.tools, requireConfirmation: level !== 'full' } });
    return { output: chalk.green(`✓ İzin seviyesi: ${level}`) };
  },

  sağlayıcı: async (args, ctx) => {
    const name = args.trim().toLowerCase() as ProviderName;

    // API anahtarı gereken sağlayıcılar ve env değişkenleri
    const API_KEY_ENV: Partial<Record<ProviderName, string>> = {
      claude:     'ANTHROPIC_API_KEY',
      openai:     'OPENAI_API_KEY',
      gemini:     'GEMINI_API_KEY',
      groq:       'GROQ_API_KEY',
      mistral:    'MISTRAL_API_KEY',
      xai:        'XAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      deepseek:   'DEEPSEEK_API_KEY',
    };

    // API anahtarı eksikse sor ve settings.json'a kaydet
    async function apiKeySorEkle(p: ProviderName): Promise<boolean> {
      const envVar = API_KEY_ENV[p];
      if (!envVar) return true;
      const cfg = loadConfig();
      if (cfg.providers[p]?.apiKey || process.env[envVar]) return true;
      const apiKey = await text({
        message: `${p.toUpperCase()} API anahtarınızı girin:`,
        placeholder: 'sk-...',
        validate: (v) => (!v?.trim() ? 'API anahtarı boş olamaz.' : undefined),
      });
      if (isCancel(apiKey)) return false;
      saveConfig({ providers: { [p]: { apiKey: (apiKey as string).trim() } } } as any);
      return true;
    }

    // Model seçim menüsü — listModels ile mevcut modelleri çek
    async function modelSec(p: ProviderName): Promise<string | null> {
      const cfg = loadConfig();
      let models: string[] = [];
      try { models = await listModels(p, cfg.providers[p]); } catch { /* fallback */ }
      if (models.length === 0) {
        const m = await text({ message: 'Model adını girin:' });
        if (isCancel(m)) return null;
        return (m as string).trim() || null;
      }
      if (models.length === 1) return models[0]!;
      const selected = await select({
        message: 'Model seçin:',
        options: models.map(m => ({ value: m, label: m })),
      });
      if (isCancel(selected)) return null;
      return selected as string;
    }

    // DeepSeek'e özel: thinking modu sorusu
    async function thinkingSec(): Promise<string | null> {
      const choice = await select({
        message: 'Thinking modu:',
        options: [
          { value: 'on',  label: 'Açık — reasoning_effort: high (varsayılan)' },
          { value: 'max', label: 'Açık — reasoning_effort: max (daha derin)' },
          { value: 'off', label: 'Kapalı — sadece yanıt, daha hızlı' },
        ],
      });
      if (isCancel(choice)) return null;
      return choice as string;
    }

    // Ortak akış: sağlayıcı ayarla + model seç
    async function saglaySec(p: ProviderName): Promise<{ output: string }> {
      // 1. API anahtarı
      const keyOk = await apiKeySorEkle(p);
      if (!keyOk) return { output: chalk.dim('İptal edildi.') };

      // 2. Provider'ı başlat
      try {
        await ctx.setProvider(p);
      } catch (err) {
        return { output: chalk.red(`✗ ${p} başlatılamadı: ${err instanceof Error ? err.message : String(err)}`) };
      }

      // 3. Model seç
      const model = await modelSec(p);
      if (!model) return { output: chalk.dim('İptal edildi.') };
      ctx.setModel(model);
      persistProviderAndModel(p, model);

      // 4. DeepSeek: thinking modu
      if (p === 'deepseek') {
        const thinking = await thinkingSec();
        if (!thinking) return { output: chalk.dim('İptal edildi.') };
        if (ctx.setDeepSeekThinking) ctx.setDeepSeekThinking(thinking !== 'off');
        // 'max' ve 'on' arasındaki effort farkını effort seviyesine yansıt
        if (thinking === 'max') { if (ctx.setEffort) ctx.setEffort('max'); }
        else if (thinking === 'on') { if (ctx.setEffort) ctx.setEffort('high'); }
        const thinkingLabel = thinking === 'off' ? 'kapalı' : thinking === 'max' ? 'açık (max)' : 'açık (high)';
        return { output: chalk.green(`✓ ${p} · ${model} · thinking: ${thinkingLabel}`) };
      }

      return { output: chalk.green(`✓ ${p} · ${model}`) };
    }

    // Argümansız: menü göster
    if (!name) {
      const p = await select({
        message: 'Sağlayıcı seçin:',
        options: [
          { value: 'claude',     label: 'Claude (Anthropic)' },
          { value: 'gemini',     label: 'Gemini (Google)' },
          { value: 'openai',     label: 'OpenAI' },
          { value: 'ollama',     label: 'Ollama (Yerel)' },
          { value: 'groq',       label: 'Groq' },
          { value: 'deepseek',   label: 'DeepSeek' },
          { value: 'mistral',    label: 'Mistral' },
          { value: 'xai',        label: 'xAI (Grok)' },
          { value: 'lmstudio',   label: 'LM Studio' },
          { value: 'openrouter', label: 'OpenRouter' },
        ],
      });
      if (isCancel(p)) return { output: chalk.dim('İptal edildi.') };
      return saglaySec(p as ProviderName);
    }

    const validProviders: ProviderName[] = ['claude', 'openai', 'gemini', 'ollama', 'groq', 'deepseek', 'mistral', 'xai', 'lmstudio', 'openrouter', 'copilot'];
    if (!validProviders.includes(name)) {
      return { output: chalk.red(`Bilinmeyen sağlayıcı: ${name}`) };
    }
    return saglaySec(name);
  },

  model: (args, ctx) => {
    const model = args.trim();
    if (!model) return { output: chalk.dim(`Mevcut model: ${ctx.currentModel}`) };
    ctx.setModel(model);
    persistProviderAndModel(ctx.currentProvider, model);
    return { output: chalk.green(`✓ Model ayarlandı: ${model}`) };
  },

  modeller: async (args, ctx) => {
    try {
      const { listModels } = await import('./providers/factory.js');
      const models = await listModels(ctx.currentProvider, ctx.config.providers[ctx.currentProvider]);
      if (!args.trim()) {
        if (models.length === 0) return { output: chalk.yellow('Model listesi alınamadı veya boş.') };
        const selected = await select({
          message: `${ctx.currentProvider} için model seçin:`,
          options: models.map((m: string) => ({ value: m, label: m })),
        });
        if (isCancel(selected)) return { output: chalk.dim('İptal edildi.') };
        ctx.setModel(selected as string);
        persistProviderAndModel(ctx.currentProvider, selected as string);
        // DeepSeek'teyken thinking modunu da sor
        if (ctx.currentProvider === 'deepseek' && ctx.setDeepSeekThinking) {
          const thinkingChoice = await select({
            message: 'Thinking modu:',
            options: [
              { value: 'on',  label: 'Açık — reasoning_effort: high (varsayılan)' },
              { value: 'max', label: 'Açık — reasoning_effort: max (daha derin)' },
              { value: 'off', label: 'Kapalı — sadece yanıt, daha hızlı' },
            ],
          });
          if (!isCancel(thinkingChoice)) {
            ctx.setDeepSeekThinking(thinkingChoice !== 'off');
            const label = thinkingChoice === 'off' ? 'kapalı' : thinkingChoice === 'max' ? 'açık (max)' : 'açık (high)';
            return { output: chalk.green(`✓ Model: ${selected} · thinking: ${label}`) };
          }
        }
        return { output: chalk.green(`✓ Model seçildi: ${selected}`) };
      }
      const model = args.trim();
      ctx.setModel(model);
      persistProviderAndModel(ctx.currentProvider, model);
      return { output: chalk.green(`✓ Model seçildi: ${model}`) };
    } catch (err) {
      return { output: chalk.red(`Hata: ${err instanceof Error ? err.message : String(err)}`) };
    }
  },

  değiştir: async (_args, ctx) => {
    const action = await select({
      message: 'Ayar seçin:',
      options: [
        { value: 'provider', label: 'Sağlayıcı (Provider)' },
        { value: 'model',    label: 'Model' },
        { value: 'perm',     label: 'İzin Seviyesi' },
        { value: 'security', label: 'Güvenlik Profili' },
        { value: 'theme',    label: 'Tema' },
        { value: 'tools',    label: 'Araçlar (Aç/Kapat)' },
      ],
    });
    if (isCancel(action)) return { output: chalk.gray('İptal edildi.') };

    switch (action) {
      case 'provider': return COMMANDS.sağlayıcı('', ctx);
      case 'model':    return COMMANDS.modeller('', ctx);
      case 'perm':     return COMMANDS.yetki('', ctx);
      case 'security': return COMMANDS.güvenlik('', ctx);
      case 'theme':    return COMMANDS.tema('', ctx);
      case 'tools': {
        const toggle = ctx.toolsEnabled ? 'Kapat' : 'Aç';
        const ok = await confirm({ message: `Araç kullanımı ${toggle.toLowerCase()}ılsın mı?` });
        if (ok) {
          ctx.setToolsEnabled(!ctx.toolsEnabled);
          return { output: chalk.green(`✓ Araçlar: ${!ctx.toolsEnabled ? 'Kapalı' : 'Açık'}`) };
        }
        return { output: chalk.gray('Değişiklik yapılmadı.') };
      }
    }
    return { output: '' };
  },

  araçlar: async (args, ctx) => {
    const sub = args.trim().toLowerCase();
    if (!sub) {
      return { output: chalk.dim(`Araçlar: ${ctx.toolsEnabled ? 'açık' : 'kapalı'} (kullanım: /araçlar <açık|kapalı>)`) };
    }
    if (!['açık', 'acik', 'kapalı', 'kapali'].includes(sub)) {
      return { output: chalk.red('Kullanım: /araçlar <açık|kapalı>') };
    }
    const enabled = sub === 'açık' || sub === 'acik';
    ctx.setToolsEnabled(enabled);
    return { output: chalk.green(`✓ Araçlar ${enabled ? 'açıldı' : 'kapatıldı'}.`) };
  },

  ajan: async (args, ctx) => {
    const sub = args.trim().toLowerCase();
    if (!sub) {
      return { output: chalk.dim(`Ajan modu: ${ctx.agentEnabled ? 'açık' : 'kapalı'} (kullanım: /ajan <açık|kapalı>)`) };
    }
    if (!['açık', 'acik', 'kapalı', 'kapali'].includes(sub)) {
      return { output: chalk.red('Kullanım: /ajan <açık|kapalı>') };
    }
    const enabled = sub === 'açık' || sub === 'acik';
    ctx.setAgentEnabled(enabled);
    return { output: chalk.green(`✓ Ajan modu ${enabled ? 'açıldı' : 'kapatıldı'}.`) };
  },

  güvenlik: async (args, ctx) => {
    const sub = args.trim().toLowerCase();
    const profiles: SecurityProfile[] = ['safe', 'standard', 'pentest'];
    if (!sub) {
      const selected = await select({
        message: `Güvenlik profilini seçin (mevcut: ${ctx.getSecurityProfile()}):`,
        options: profiles.map((p) => ({ value: p, label: p })),
      });
      if (isCancel(selected)) return { output: chalk.dim('İptal edildi.') };
      ctx.setSecurityProfile(selected as SecurityProfile);
      saveConfig({ tools: { ...ctx.config.tools, securityProfile: selected as SecurityProfile } });
      return { output: chalk.green(`✓ Güvenlik profili: ${selected}`) };
    }
    if (!profiles.includes(sub as SecurityProfile)) {
      return { output: chalk.red('Geçersiz profil: safe, standard, pentest') };
    }
    ctx.setSecurityProfile(sub as SecurityProfile);
    saveConfig({ tools: { ...ctx.config.tools, securityProfile: sub as SecurityProfile } });
    return { output: chalk.green(`✓ Güvenlik profili: ${sub}`) };
  },

  apikey: async (args, _ctx) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase() ?? 'liste';
    const cfg = loadConfig();
    const providers = Object.keys(cfg.providers) as ProviderName[];

    if (sub === 'liste') {
      const lines = [chalk.bold('🔑 API Key Durumu'), ''];
      for (const p of providers) {
        const has = Boolean(cfg.providers[p]?.apiKey);
        lines.push(`  ${has ? chalk.green('✓') : chalk.red('✗')} ${p}`);
      }
      lines.push('', chalk.dim('Silmek için: /apikey sil <provider>'));
      return { output: lines.join('\n') };
    }

    if (sub === 'set') {
      const providerArg = parts[1] as ProviderName | undefined;
      const key = parts.slice(2).join(' ').trim();
      if (!providerArg || !providers.includes(providerArg) || !key) {
        return { output: chalk.red('Kullanım: /apikey set <provider> <key>') };
      }
      saveConfig({ providers: { [providerArg]: { apiKey: key } } as SETHConfig['providers'] });
      return { output: chalk.green(`✓ ${providerArg} API anahtarı kaydedildi.`) };
    }

    if (sub === 'sil') {
      const providerArg = parts[1] as ProviderName | undefined;
      if (!providerArg || !providers.includes(providerArg)) {
        return { output: chalk.red(`Geçersiz provider. Seçenekler: ${providers.join(', ')}`) };
      }
      const ok = await confirm({ message: `${providerArg} API anahtarı silinsin mi?` });
      if (isCancel(ok) || !ok) return { output: chalk.dim('İptal edildi.') };
      deleteApiKey(providerArg);
      return { output: chalk.green(`✓ ${providerArg} API anahtarı silindi.`) };
    }

    return { output: chalk.red('Kullanım: /apikey [liste|set <provider> <key>|sil <provider>]') };
  },

  'api-yaz': async (_args, _ctx) => {
    const allProviders: ProviderName[] = ['claude', 'openai', 'gemini', 'deepseek', 'openrouter', 'groq', 'mistral', 'xai', 'copilot'];
    const chosen = await select({
      message: 'Hangi sağlayıcı için API anahtarı ekleyeceksiniz?',
      options: allProviders.map(p => ({ value: p, label: p })),
    });
    if (isCancel(chosen)) return { output: chalk.dim('İptal edildi.') };

    const provider = chosen as ProviderName;
    const apiKey = await text({
      message: `${provider} API anahtarını girin:`,
      placeholder: 'sk-...',
      validate: (v) => (!v?.trim() ? 'API anahtarı boş olamaz.' : undefined),
    });
    if (isCancel(apiKey)) return { output: chalk.dim('İptal edildi.') };

    const trimmed = (apiKey as string).trim();
    saveConfig({ providers: { [provider]: { apiKey: trimmed } } } as any);
    return { output: chalk.green(`✓ ${provider} API anahtarı kaydedildi.`) };
  },

  context: (args, ctx) => {
    const raw = args.trim();
    if (!raw) {
      return { output: chalk.dim(`Context bütçesi: ${ctx.getContextBudgetTokens().toLocaleString()} token`) };
    }
    const value = parseTokenBudget(raw);
    if (!value || value < 10_000) {
      return { output: chalk.red('Geçersiz değer. Örnek: 500k, 2m, 100000') };
    }
    ctx.setContextBudgetTokens(value);
    return { output: chalk.green(`✓ Context bütçesi ayarlandı: ${value.toLocaleString()} token`) };
  },

  temizle: (_args, _ctx) => {
    return { clearTerminal: true, output: chalk.dim('Terminal temizlendi.') };
  },

  'context-temizle': async (_args, ctx) => {
    ctx.clearHistory('all');
    return { clearTerminal: true, output: chalk.green('✓ Context temizlendi.') };
  },

  geri: (_args, ctx) => {
    const ok = ctx.undoHistory();
    return { output: ok ? chalk.green('✓ Son mesaj geri alındı.') : chalk.yellow('Geri alınacak mesaj yok.') };
  },

  sıkıştır: async (_args, ctx) => {
    const res = await ctx.compactHistory();
    if (!res) return { output: chalk.yellow('Geçmiş henüz sıkıştırmak için yeterince uzun değil.') };
    return { output: chalk.green(`✓ Sıkıştırıldı: ${res.before} -> ${res.after} mesaj.`) };
  },

  kaydet: async (args, ctx) => {
    const parts = args.trim().split(' ');
    const fmt = ['md', 'html', 'txt', 'cast'].includes(parts[0] ?? '') ? parts.shift()! : 'md';
    const filename = parts.join(' ') || `seth_chat_${Date.now()}.${fmt}`;
    const messages = ctx.getHistory();

    let content = '';
    if (fmt === 'html') {
      const rows = messages.map(m => {
        const role = m.role === 'user' ? 'Sen' : 'SETH';
        const cls = m.role === 'user' ? 'user' : 'assistant';
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `<div class="msg ${cls}"><span class="role">${role}</span><pre>${text}</pre></div>`;
      }).join('\n');
      
      content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SETH Chat</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0d;color:#e0e0e0;font-family:'Courier New',monospace;max-width:900px;margin:0 auto;padding:24px}
  h1{color:#cc0000;font-size:1.4rem;margin-bottom:20px;border-bottom:1px solid #333;padding-bottom:10px}
  .msg{padding:14px 18px;margin:10px 0;border-radius:8px;border-left:3px solid transparent}
  .user{background:#1e1e1e;border-color:#555}
  .assistant{background:#0f1a2e;border-color:#cc0000}
  .role{font-size:.75rem;font-weight:bold;text-transform:uppercase;letter-spacing:.1em;opacity:.6;display:block;margin-bottom:6px}
  .user .role{color:#aaa}
  .assistant .role{color:#cc4444}
  pre{white-space:pre-wrap;word-break:break-word;font-size:.9rem;line-height:1.6}
</style>
</head>
<body>
<h1>🐍 SETH — Sohbet Kaydı</h1>
${rows}
</body></html>`;
    } else if (fmt === 'txt') {
      content = messages.map(m => `[${m.role.toUpperCase()}]\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}\n`).join('\n---\n\n');
    } else if (fmt === 'cast') {
      const { exportAsAsciicast } = await import('./asciicast.js');
      content = exportAsAsciicast(messages, ctx.currentProvider, ctx.currentModel);
    } else {
      content = messages.map(m => `### ${m.role.toUpperCase()}\n\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n---\n\n');
    }

    await writeFile(resolve(ctx.getCwd(), filename), content);
    return { output: chalk.green(`✓ Kaydedildi: ${filename} (${fmt.toUpperCase()})`) };
  },

  // #18 /export — oturum export/import
  export: async (args, ctx) => {
    const parts = args.trim().split(' ');
    const fmt = ['json', 'md', 'html', 'obsidian'].includes(parts[0] ?? '') ? parts.shift()! : 'json';
    const filename = parts.join(' ') || `seth_export_${Date.now()}.${fmt === 'obsidian' ? 'md' : fmt}`;
    const messages = ctx.getHistory();
    const stats = ctx.getStats();

    let content: string;
    if (fmt === 'json') {
      content = JSON.stringify({
        version: VERSION,
        provider: ctx.currentProvider,
        model: ctx.currentModel,
        exportedAt: new Date().toISOString(),
        stats,
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
      }, null, 2);
    } else if (fmt === 'obsidian') {
      const fm = `---\ntitle: SETH Oturum Kaydı\ntags: [seth, ai-session, security]\nprovider: ${ctx.currentProvider}\nmodel: ${ctx.currentModel}\ndate: ${new Date().toISOString()}\n---\n\n`;
      content = fm + messages.map(m => {
        const role = m.role === 'user' ? '# User' : '# SETH';
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
        return `${role}\n\n${text}`;
      }).join('\n\n---\n\n');
    } else if (fmt === 'md') {
      const header = `# SETH Oturum Kaydı\n\n**Provider:** ${ctx.currentProvider} / ${ctx.currentModel}  \n**Tarih:** ${new Date().toLocaleString('tr-TR')}  \n**Mesaj:** ${stats.messages}  \n\n---\n\n`;
      content = header + messages.map(m => {
        const role = m.role === 'user' ? '**Sen**' : '**SETH**';
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
        return `${role}\n\n${text}`;
      }).join('\n\n---\n\n');
    } else {
      // HTML
      const rows = messages.map(m => {
        const role = m.role === 'user' ? 'Sen' : 'SETH';
        const cls = m.role === 'user' ? 'user' : 'assistant';
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `<div class="msg ${cls}"><span class="role">${role}</span><pre>${text}</pre></div>`;
      }).join('\n');
      content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{background:#0d0d0d;color:#eee;font-family:monospace;padding:20px}.msg{margin:10px 0;padding:10px;border-radius:5px}.user{background:#222}.assistant{background:#111;border-left:3px solid #cc0000}.role{font-weight:bold;display:block;margin-bottom:5px}pre{white-space:pre-wrap}</style></head><body>${rows}</body></html>`;
    }

    await writeFile(resolve(ctx.getCwd(), filename), content);
    return { output: chalk.green(`✓ Oturum ihraç edildi: ${filename}`) };
  },

  hafıza: async (args, ctx) => {
    const parts = args.trim().split(' ');
    const sub = parts[0];
    const tip = parts[1];
    const icerik = parts.slice(2).join(' ');

    if (sub === 'ekle' && tip && icerik) {
      appendMemory(tip as MemoryType, icerik);
      return { output: chalk.green(`✓ Belleğe eklendi (${tip})`) };
    }
    if (sub === 'sil' && tip) {
      writeMemory(tip as MemoryType, '');
      return { output: chalk.green(`✓ Bellek temizlendi (${tip})`) };
    }

    const all = loadAllMemories();
    if (!all) return { output: chalk.gray('Kalıcı bellek boş.') };
    return { output: [chalk.bold('🧠 Kalıcı Bellek'), '', all].join('\n') };
  },

  'hafıza-temizle': async () => {
    const sure = await confirm({ message: 'Tüm kalıcı bellek silinsin mi? (geri alınamaz)' });
    if (isCancel(sure) || !sure) return { output: chalk.dim('İptal edildi.') };
    for (const tip of ['user', 'project', 'feedback', 'reference'] as const) {
      writeMemory(tip, '');
    }
    return { output: chalk.green('✓ Tüm kalıcı bellek temizlendi.') };
  },

  // ─── Konuşma İçi Arama ───────────────────────────────────────────────────
  ara: (_args, ctx) => {
    const query = _args.trim().toLowerCase();
    if (!query) return { output: chalk.dim('Kullanım: /ara <kelime>') };
    const messages = ctx.getMessages?.() ?? [];
    const results: string[] = [];
    messages.forEach((msg, i) => {
      const content = typeof msg.content === 'string' ? msg.content
        : Array.isArray(msg.content) ? msg.content.map((b: any) => b.text ?? '').join(' ')
        : '';
      if (content.toLowerCase().includes(query)) {
        const preview = content.slice(0, 120).replace(/\n/g, ' ');
        const role = msg.role === 'user' ? chalk.cyan('Sen') : chalk.green('SETH');
        results.push(`  ${chalk.dim(`#${i + 1}`)} ${role}: ${preview}…`);
      }
    });
    if (results.length === 0) return { output: chalk.dim(`"${query}" bulunamadı.`) };
    return { output: [chalk.bold(`🔍 "${query}" — ${results.length} sonuç:`), '', ...results].join('\n') };
  },

  // #10 Tüm oturumlarda arama
  'oturum-ara': async (args) => {
    const query = args.trim();
    if (!query) return { output: chalk.dim('Kullanım: /oturum-ara <kelime>') };
    const { searchAllSessions } = await import('./session-search.js');
    const results = await searchAllSessions(query);
    if (results.length === 0) return { output: chalk.dim(`"${query}" hiçbir oturumda bulunamadı.`) };
    const lines = [chalk.bold(`🔍 "${query}" — ${results.length} oturumda bulundu:`), ''];
    for (const r of results.slice(0, 10)) {
      lines.push(`  ${chalk.cyan(r.sessionId.slice(0, 8))} ${chalk.dim(r.createdAt.slice(0, 10))} ${r.provider}/${r.model} — ${r.matchCount} eşleşme`);
      lines.push(`    ${chalk.dim('...' + r.preview.slice(0, 80) + '...')}`);
    }
    return { output: lines.join('\n') };
  },

  // #9 Diff görüntüleme
  diff: async (args, ctx) => {
    const { gitDiffTool } = await import('./tools/git/git-diff.js');
    const staged = args.includes('--staged') || args.includes('-s');
    const stat = args.includes('--stat');
    return gitDiffTool.execute({ staged, stat_only: stat }, ctx.getCwd());
  },

  // #7 Cron yönetimi
  cron: async (args) => {
    const { addCronJob, listCronJobs, removeCronJob, toggleCronJob, parseIntervalStr } = await import('./cron.js');
    const parts = args.trim().split(' ');
    const sub = parts[0];

    if (!sub || sub === 'liste') {
      const jobs = listCronJobs();
      if (jobs.length === 0) return { output: chalk.dim('  Kayıtlı cron görevi yok. /cron ekle <isim> <interval> <prompt>') };
      const lines = [chalk.bold('⏰ Cron Görevleri:'), ''];
      for (const j of jobs) {
        const status = j.enabled ? chalk.green('✓') : chalk.red('✗');
        const interval = `${j.intervalMs / 60000}dk`;
        lines.push(`  ${status} ${j.id.slice(-6)} ${j.name.padEnd(15)} ${chalk.dim(interval)} — ${j.prompt.slice(0, 50)}`);
      }
      return { output: lines.join('\n') };
    }

    if (sub === 'ekle') {
      const name = parts[1];
      const intervalStr = parts[2];
      const prompt = parts.slice(3).join(' ');
      if (!name || !intervalStr || !prompt) return { output: chalk.red('Kullanım: /cron ekle <isim> <interval(1m/1h/1d)> <prompt>') };
      const ms = parseIntervalStr(intervalStr);
      if (!ms) return { output: chalk.red('Geçersiz interval. Örnek: 30m, 2h, 1d') };
      const job = addCronJob(name, prompt, ms);
      return { output: chalk.green(`✓ Cron görevi eklendi: ${job.id}`) };
    }

    if (sub === 'sil') {
      const id = parts[1];
      if (!id) return { output: chalk.red('Kullanım: /cron sil <id>') };
      const ok = removeCronJob(id);
      return { output: ok ? chalk.green(`✓ Silindi: ${id}`) : chalk.red(`Bulunamadı: ${id}`) };
    }

    return { output: chalk.dim('/cron [liste|ekle|sil]') };
  },

  // #4 Paste — panodan yapıştır
  yapıştır: async (_args, ctx) => {
    const { getClipboardText, hasImageInClipboard, getImageFromClipboard, PASTE_THRESHOLD } = await import('./paste.js');

    // Önce görüntü var mı kontrol et
    if (await hasImageInClipboard()) {
      const img = await getImageFromClipboard();
      if (img) {
        return { 
          output: chalk.green(`🖼️ Panodan görüntü alındı (${Math.round(img.base64.length * 0.75 / 1024)} KB)`),
          runAsUserMessage: `[PASTE_IMAGE]${img.base64}`
        };
      }
    }

    const text = await getClipboardText();
    if (!text) return { output: chalk.yellow('Pano boş.') };
    
    if (text.length > PASTE_THRESHOLD) {
      return {
        output: chalk.cyan(`📋 Büyük metin yapıştırıldı (${text.length} karakter).`),
        runAsUserMessage: text
      };
    }
    return { runAsUserMessage: text };
  },

  hook: async (args) => {
    const sub = args.trim().toLowerCase();
    if (sub === 'örnek') return { output: `Hook örneği (~/.seth/hooks.json):\n\n${JSON.stringify(getHooksExample(), null, 2)}` };
    
    const hooks = loadHooks();
    if (hooks.length === 0) return { output: chalk.gray('Tanımlı hook yok. Örnek için: /hook örnek') };
    const lines = [chalk.bold('🪝 Aktif Hooklar:'), ''];
    hooks.forEach((h, i) => lines.push(`  ${i+1}. ${chalk.cyan(h.event)} ${h.tool ? `[${h.tool}]` : ''} -> ${h.command}`));
    return { output: lines.join('\n') };
  },

  rapor: async (args, ctx) => {
    if (args.trim().toLowerCase() === 'pdf') {
      const history = ctx.getHistory();
      const reportText = history.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n\n');
      const filename = await exportSecurityReport(reportText, ctx.getCwd());
      return { output: chalk.green(`✓ Güvenlik raporu oluşturuldu: ${filename}`) };
    }
    return { output: chalk.dim('Kullanım: /rapor pdf') };
  },

  cd: (args, ctx) => {
    const newDir = ctx.changeCwd(args.trim());
    return { output: newDir ? chalk.green(`✓ Dizin değiştirildi: ${newDir}`) : chalk.red(`Geçersiz dizin: ${args}`) };
  },

  pwd: (_args, ctx) => ({ output: ctx.getCwd() }),

  'web-aç': async () => {
    const { startWebServer } = await import('./web/server.js');
    await startWebServer();
    return { output: chalk.cyan('  🌐 Web arayüzü başlatılıyor...') };
  },

  nasılçalışır: async () => {
    await runNasilCalisirAnimation();
    return { output: '' };
  },

  istatistikler: async (_args, ctx) => {
    const s = ctx.getStats();
    const history = loadHistory();
    const totalTokens = s.inputTokens + s.outputTokens;

    // #1 Gerçek maliyet hesabı
    const { calculateCostUSD, formatCostUSD } = await import('./model-cost.js');
    const costUSD = calculateCostUSD(s.inputTokens, s.outputTokens, ctx.currentModel, ctx.currentProvider);

    const lines = [
      chalk.bold('📊 SETH İstatistikleri'),
      '',
      `  Sağlayıcı     : ${chalk.cyan(ctx.currentProvider)} / ${chalk.cyan(ctx.currentModel)}`,
      `  Mesaj sayısı  : ${chalk.cyan(s.messages)}`,
      `  Toplam token  : ${chalk.cyan(totalTokens.toLocaleString())}`,
      `    ↳ Giriş     : ${chalk.dim(s.inputTokens.toLocaleString())}`,
      `    ↳ Çıkış     : ${chalk.dim(s.outputTokens.toLocaleString())}`,
      `  Tur sayısı    : ${chalk.cyan(s.turns)}`,
      `  Gerçek maliyet: ${chalk.yellow(formatCostUSD(costUSD))}`,
      '',
      `  Geçmiş kayıt  : ${chalk.cyan(history.length)} komut`,
    ];

    // En çok kullanılan komutlar (v3.8.17)
    const counts: Record<string, number> = {};
    history.forEach(h => {
      const cmd = h.split(' ')[0] || '';
      if (cmd.startsWith('/')) {
        counts[cmd] = (counts[cmd] || 0) + 1;
      }
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length > 0) {
      lines.push('', chalk.dim('  Top Komutlar:'));
      top.forEach(([c, n]) => lines.push(`    ${c.padEnd(15)} : ${n} kez`));
    }

    // #17 Tool metrics
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const { homedir } = await import('os');
      const summaryPath = join(homedir(), '.seth', 'metrics', 'tool-metrics-summary.json');
      const raw = await readFile(summaryPath, 'utf-8').catch(() => null);
      if (raw) {
        const data = JSON.parse(raw);
        lines.push('', chalk.bold('🛠️  Araç Kullanımı (En Çok)'));
        Object.entries(data.usageCount)
          .sort((a: any, b: any) => b[1] - a[1])
          .slice(0, 5)
          .forEach(([name, count]) => {
            lines.push(`  ${name.padEnd(15)} : ${count} kez`);
          });
      }
    } catch { /* ignore */ }

    return { output: lines.join('\n') };
  },

  bellek: async (sub, ctx) => {
    const validTypes: MemoryType[] = ['user', 'project', 'feedback', 'reference'];
    
    // /bellek kaydet <tip> <icerik>
    if (sub.startsWith('kaydet ')) {
      const parts = sub.slice(7).trim().split(' ');
      const tip = parts[0];
      const contentParts = parts.slice(1);
      if (!validTypes.includes(tip as MemoryType)) {
        return { output: chalk.red(`Geçersiz tip. Kullanım: /bellek kaydet <user|project|feedback|reference> <içerik>`) };
      }
      appendMemory(tip as MemoryType, contentParts.join(' '));
      return { output: chalk.green(`✓ Belleğe kaydedildi (${tip})`) };
    }
    // /bellek oku <tip>
    if (sub.startsWith('oku ')) {
      const tip = sub.slice(4).trim() as MemoryType;
      const content = readMemory(tip);
      return { output: content || chalk.dim('(boş)') };
    }
    // /bellek tümü
    if (sub === 'tümü' || sub === 'hepsi') {
      return { output: loadAllMemories() || chalk.dim('(bellek boş)') };
    }
    // Varsayılan: görev listesi + bellek özeti
    const todos = todoListesiniOku(ctx.getSessionId());
    const memSummary = loadAllMemories();
    const lines: string[] = [chalk.bold('📋 Görevler')];
    if (todos.length > 0) lines.push(...todos.map(t => `  [${t.durum}] ${t.baslik}`));
    else lines.push(chalk.dim('  (görev yok)'));
    if (memSummary) {
      lines.push('', chalk.bold('🧠 Bellek'));
      lines.push(memSummary.slice(0, 500));
    }
    lines.push('', chalk.dim('  /bellek kaydet <user|project|feedback|reference> <içerik>'));
    return { output: lines.join('\n') };
  },

  yan: async (args, ctx) => {
    // Yan sorgu (side-query)
    if (!args.trim()) return { output: chalk.dim('Kullanım: /yan <soru>') };
    return { runAsUserMessage: args.trim() };
  },

  'yan-sorgu': async (args, ctx) => COMMANDS.yan(args, ctx),

  sor: async (args) => {
    const result = await runSorWizard(args.trim());
    if (result.cancelled) return { output: chalk.dim('İptal edildi.') };
    const prompt = [
      `Hedef: ${result.goal}`,
      `Yığın: ${result.dil}`,
      result.note || 'Ek not yok.',
    ].join('\n');
    return { output: chalk.green('✓ Sihirbaz tamamlandı.'), runAsUserMessage: prompt };
  },

  dusunme: async (args, ctx) => {
    const sub = args.trim().toLowerCase();
    if (!sub) {
      return { output: chalk.dim('Kullanım: /dusunme [minimal|animated]') };
    }
    if (sub !== 'minimal' && sub !== 'animated') {
      return { output: chalk.red('Geçersiz seçenek: minimal veya animated') };
    }
    ctx.setThinkingStyle(sub as ThinkingStyle);
    return { output: chalk.green(`✓ Düşünme stili: ${sub}`) };
  },

  görevler: async (_args, ctx) => {
    const { taskListTool } = await import('./tools/background-tasks.js');
    return taskListTool.execute({}, ctx.getCwd());
  },

  effort: async (args, ctx) => {
    const level = args.trim().toLowerCase();
    const levels = ['low', 'medium', 'high', 'max'];
    const desc: Record<string, string> = {
      low: 'Hızlı — kısa yanıtlar, az token',
      medium: 'Dengeli — varsayılan',
      high: 'Derin — uzun, detaylı yanıtlar',
      max: 'Maksimum — en derin düşünme ve analiz',
    };
    if (!level) {
      const selected = await select({
        message: 'Düşünme seviyesini seçin:',
        options: levels.map(l => ({ value: l, label: `${l.padEnd(8)} — ${desc[l]}` })),
      });
      if (isCancel(selected)) return { output: chalk.gray('İptal edildi.') };
      ctx.setEffort(selected as EffortLevel);
      return { output: chalk.green(`✓ Effort seviyesi: ${selected}`) };
    }
    if (!levels.includes(level)) return { output: chalk.red('Geçersiz seviye: low, medium, high, max') };
    ctx.setEffort(level as EffortLevel);
    return { output: chalk.green(`✓ Effort seviyesi: ${level}`) };
  },

  tema: async (args, _ctx) => {
    const themeNames = Object.keys(THEMES) as ThemeName[];
    const descriptions: Record<string, string> = {
      dark: 'Varsayılan koyu mavi', light: 'Açık tema',
      cyberpunk: 'Matrix / neon', retro: 'Retro turuncu',
      ocean: 'Okyanus mavisi', sunset: 'Gün batımı pembe',
    };
    if (!args.trim()) {
      const options = themeNames.map(name => ({
        value: name,
        label: `${name.padEnd(10)} — ${descriptions[name] ?? name}`,
      }));
      const selected = await select({ message: 'Tema seçin:', options });
      if (isCancel(selected)) return { output: chalk.gray('İptal edildi.') };
      setTheme(selected as ThemeName);
      saveConfig({ theme: selected as string });
      const colors = getThemeColors();
      const preview = [
        colors.navy('■ Ana'), colors.navyBright('■ İkincil'),
        colors.success('■ Başarı'), colors.warning('■ Uyarı'),
        colors.error('■ Hata'), colors.cmd('■ Komut'),
        colors.toolAccent('■ Araç'), colors.sparkle('■ Vurgu'),
      ].join('  ');
      return { output: `${colors.success('✓')} Tema: ${colors.navyBright(selected as string)}\n\n  ${preview}` };
    }
    const themeName = args.trim().toLowerCase() as ThemeName;
    if (!themeNames.includes(themeName)) {
      return { output: chalk.red(`Bilinmeyen tema: ${themeName}\nSeçenekler: ${themeNames.join(', ')}`) };
    }
    setTheme(themeName);
    saveConfig({ theme: themeName });
    const colors = getThemeColors();
    const preview = [
      colors.navy('■ Ana'), colors.navyBright('■ İkincil'),
      colors.success('■ Başarı'), colors.warning('■ Uyarı'),
      colors.error('■ Hata'), colors.cmd('■ Komut'),
      colors.toolAccent('■ Araç'), colors.sparkle('■ Vurgu'),
    ].join('  ');
    return { output: `${colors.success('✓')} Tema: ${colors.navyBright(themeName)}\n\n  ${preview}` };
  },

  geçmiş: async () => {
    const sessions = listSessions()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20);

    if (sessions.length === 0) return { output: chalk.gray('Kayıtlı oturum yok.') };

    const options = sessions.map(s => {
      const date = new Date(s.updatedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      const tag = s.tag ? ` ${chalk.bgBlue.white(` ${s.tag} `)}` : '';
      return { value: s.id, label: `${chalk.dim(s.id.slice(0, 8))}  ${s.provider}/${s.model}${tag}  ${chalk.dim(date)}` };
    });

    const selected = await select({ message: 'Oturum seçin:', options });
    if (isCancel(selected)) return { output: chalk.gray('İptal edildi.') };

    return {
      output: chalk.green(`✓ Yeniden başlatılıyor...`),
      runAsUserMessage: `__RESUME__${selected as string}`,
    };
  },

  etiket: async (args, ctx) => {
    const tag = args.trim();
    if (!tag) return { output: chalk.dim('Kullanım: /etiket <isim>') };
    const ok = setSessionTag(ctx.getSessionId(), tag);
    return { output: ok ? chalk.green(`✓ Oturum etiketlendi: ${tag}`) : chalk.red('Hata: Oturum bulunamadı.') };
  },

  profil: async (args, ctx) => {
    const parts = args.trim().split(' ');
    const sub = parts[0];
    const cfg = loadConfig();
    const profiles = cfg.profiles || {};

    if (!sub || sub === 'liste') {
      const names = Object.keys(profiles);
      if (names.length === 0) return { output: chalk.dim('  Kayıtlı profil yok. /profil ekle <isim>') };
      const lines = [chalk.bold('👤 Kayıtlı Profiller:'), ''];
      for (const name of names) {
        const p = profiles[name];
        lines.push(`  • ${chalk.cyan(name.padEnd(15))} : ${p.provider} / ${p.model}`);
      }
      return { output: lines.join('\n') };
    }

    if (sub === 'ekle') {
      const name = parts[1];
      if (!name) return { output: chalk.red('Kullanım: /profil ekle <isim>') };
      const newProfiles = { ...profiles, [name]: { provider: ctx.currentProvider, model: ctx.currentModel } };
      saveConfig({ profiles: newProfiles });
      return { output: chalk.green(`✓ Profil eklendi: ${name}`) };
    }

    if (profiles[sub]) {
      const p = profiles[sub];
      await ctx.setProvider(p.provider);
      ctx.setModel(p.model);
      return { output: chalk.green(`✓ Profile geçildi: ${sub} (${p.provider}/${p.model})`) };
    }

    return { output: chalk.red(`Profil bulunamadı: ${sub}`) };
  },

  çıkış: async () => {
    return { output: '', shouldExit: true };
  },

  yapımcı: () => ({
    output: `
${chalk.bold.red('🐍 SETH v' + VERSION + ' — Strategic Exploitation & Tactical Hybrid')}

${chalk.bold.cyan('👨‍💻 Yapımcı:')} ${chalk.bold('Mustafa Kemal Çıngıl')}
${chalk.dim('GitHub:')} ${chalk.underline('https://github.com/MustafaKemal0146')}

${chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${chalk.yellow('🎓 Eğitim:')}
  • Bitlis Eren Üniversitesi Mühendislik Fakültesi
  • Bilgisayar Mühendisliği (2. sınıf)

${chalk.green('🔬 Uzmanlık Alanları:')}
  • Yapay Zeka Araştırmaları & Machine Learning
  • Computer Vision & RAG Tuning  
  • Modern Web Development (React, TypeScript)
  • Otomasyon ve Workflow Optimizasyonu
  • Siber Güvenlik Araçları

${chalk.blue('📊 İstatistikler:')}
  • 30+ Aktif Proje
  • 800+ Test Ortamı
  • 3+ Yıl Deneyim
  • GitHub'da Açık Kaynak Katkıları

${chalk.magenta('🌐 İletişim:')}
  • Web: ${chalk.underline('https://mustafakemalcingil.site')}
  • LinkedIn: ${chalk.underline('https://linkedin.com/in/mustafakemalcingil')}
  • E-posta: ${chalk.underline('ismustafakemal0146@gmail.com')}

${chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${chalk.red.bold('⚡ SETH')} — Teknoloji ile hayatı kolaylaştıran, etik hacker ruhuyla geliştirilmiş
otonom siber operasyon aracı. Bitlis'ten dünyaya açılan bir yapay zeka projesi.

${chalk.dim('Yanıt süresi: 24 saat içinde • Çalışma dili: Türkçe, İngilizce')}
`,
  }),

  cikis: async (_args, _ctx) => COMMANDS.çıkış('', _ctx),

  // ─── Checkpoint ────────────────────────────────────────────────────────────
  checkpoint: async (args, ctx) => {
    const { saveCheckpoint, loadCheckpoint, listCheckpoints, deleteCheckpoint } = await import('./checkpoints.js');
    const sub = args.trim().toLowerCase();
    const sessionId = ctx.getSessionId();

    if (!sub || (!sub.startsWith('listele') && !sub.startsWith('yükle') && !sub.startsWith('yukle') && !sub.startsWith('sil'))) {
      // Kaydet
      const name = args.trim() || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const messages = ctx.getHistory();
      const laneB = ctx.getLaneHistoriesB?.() ?? [];
      const activeLane = ctx.getActiveLane();
      const stats = ctx.getStats();
      saveCheckpoint(sessionId, name, messages, laneB, activeLane, { inputTokens: stats.inputTokens, outputTokens: stats.outputTokens });
      return { output: chalk.green(`  ✓ Checkpoint kaydedildi: "${name}" (${messages.length} mesaj)`) };
    }

    if (sub === 'listele') {
      const list = listCheckpoints(sessionId);
      if (list.length === 0) return { output: chalk.dim('  (Kayıtlı checkpoint yok)') };
      const lines = list.map(c => `  ${chalk.yellow(c.name.padEnd(30))} ${chalk.dim(c.savedAt.slice(0, 19))} ${chalk.cyan(`${c.messages} msg`)}`);
      return { output: lines.join('\n') };
    }

    const parts = args.trim().split(/\s+/);
    const action = parts[0]!.toLowerCase();
    const cpName = parts.slice(1).join(' ');

    if ((action === 'yükle' || action === 'yukle') && cpName) {
      const data = loadCheckpoint(sessionId, cpName);
      if (!data) return { output: chalk.red(`  ✗ Checkpoint bulunamadı: "${cpName}"`) };
      ctx.setHistory?.(data.messages);
      return { output: chalk.green(`  ✓ Checkpoint yüklendi: "${cpName}" (${data.messages.length} mesaj, ${data.savedAt.slice(0, 19)})`) };
    }

    if (action === 'sil' && cpName) {
      const ok = deleteCheckpoint(sessionId, cpName);
      return { output: ok ? chalk.green(`  ✓ Silindi: "${cpName}"`) : chalk.red(`  ✗ Bulunamadı: "${cpName}"`) };
    }

    return { output: chalk.dim('  Kullanım: /checkpoint [ad] | listele | yükle <ad> | sil <ad>') };
  },

  // ─── Plan Modu ─────────────────────────────────────────────────────────────
  'plan-modu': async (args, _ctx) => {
    const { setPlanModeEnabled, isPlanModeEnabled } = await import('./plan-mode-state.js');
    const sub = args.trim().toLowerCase();
    if (!sub) {
      const current = isPlanModeEnabled();
      return { output: chalk.dim(`  Plan modu: ${current ? chalk.green('açık') : chalk.gray('kapalı')}`) };
    }
    if (sub === 'açık' || sub === 'acik' || sub === 'on' || sub === '1') {
      setPlanModeEnabled(true);
      return { output: chalk.green('  ✓ Plan modu açıldı — karmaşık görevlerde önce plan onayı istenir.') };
    }
    if (sub === 'kapalı' || sub === 'kapali' || sub === 'off' || sub === '0') {
      setPlanModeEnabled(false);
      return { output: chalk.yellow('  Plan modu kapatıldı.') };
    }
    return { output: chalk.dim('  Kullanım: /plan-modu açık|kapalı') };
  },

  onayla: async (_args, ctx) => {
    ctx.approvePlanFromWeb?.();
    const { approvePlan } = await import('./plan-mode-state.js');
    approvePlan();
    return { output: chalk.green('  ✓ Plan onaylandı.') };
  },

  reddet: async (_args, ctx) => {
    ctx.rejectPlanFromWeb?.();
    const { rejectPlan } = await import('./plan-mode-state.js');
    rejectPlan();
    return { output: chalk.yellow('  Plan reddedildi.') };
  },

  // ─── Paralel araç ayarı ────────────────────────────────────────────────────
  paralel: async (args, ctx) => {
    const n = parseInt(args.trim(), 10);
    if (isNaN(n) || n < 1 || n > 20) {
      const current = ctx.getMaxConcurrentTools?.() ?? 5;
      return { output: chalk.dim(`  Mevcut paralel araç sayısı: ${current}\n  Kullanım: /paralel <1-20>`) };
    }
    ctx.setMaxConcurrentTools?.(n);
    return { output: chalk.green(`  ✓ Paralel araç sayısı: ${n}`) };
  },

  // ─── PR Review ─────────────────────────────────────────────────────────────
  'pr-incele': async (args, _ctx) => {
    const { execSync } = await import('child_process');
    const prRef = args.trim();
    if (!prRef) return { output: chalk.dim('  Kullanım: /pr-incele <PR numarası veya URL>') };

    // gh CLI varlık kontrolü
    try { execSync('which gh', { encoding: 'utf-8', stdio: 'pipe' }); } catch {
      return { output: chalk.red('  ✗ gh CLI bulunamadı. Yüklemek için: https://cli.github.com') };
    }

    // PR numarasını URL'den çıkar
    const prNum = prRef.replace(/.*\/pull\//, '').replace(/[^0-9].*/, '').trim() || prRef;

    try {
      const meta = execSync(`gh pr view ${prNum} --json title,body,additions,deletions,changedFiles,author,url 2>/dev/null`, { encoding: 'utf-8', stdio: 'pipe' });
      const diff = execSync(`gh pr diff ${prNum} 2>/dev/null`, { encoding: 'utf-8', stdio: 'pipe' });
      const diffSlice = diff.slice(0, 8000) + (diff.length > 8000 ? '\n... (diff kısaltıldı)' : '');
      const context = `GitHub PR ${prNum} için kod incelemesi yap:\n\nMETA:\n${meta}\n\nDIFF:\n\`\`\`diff\n${diffSlice}\n\`\`\`\n\nBu PR'ı kod kalitesi, güvenlik, performans ve best practices açısından değerlendir.`;
      return { runAsUserMessage: context };
    } catch (err: any) {
      return { output: chalk.red(`  ✗ PR alınamadı: ${err.message?.slice(0, 200) ?? String(err)}`) };
    }
  },

  // ─── IDE Bridge ────────────────────────────────────────────────────────────
  ide: async (args, ctx) => {
    const { execSync, spawn } = await import('child_process');
    const target = args.trim() || ctx.getCwd();

    // VS Code varsa kullan
    try {
      execSync('which code', { encoding: 'utf-8', stdio: 'pipe' });
      spawn('code', [target], { detached: true, stdio: 'ignore' }).unref();
      return { output: chalk.green(`  ✓ VS Code açıldı: ${target}`) };
    } catch { /* VS Code yok */ }

    // xdg-open dene (Linux)
    try {
      execSync('which xdg-open', { encoding: 'utf-8', stdio: 'pipe' });
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
      return { output: chalk.green(`  ✓ Editörde açıldı: ${target}`) };
    } catch { /* xdg-open yok */ }

    return { output: chalk.yellow(`  ⚠ Editör bulunamadı. Dosya: ${target}`) };
  },

  'kabuk-kurulum': async (_args, _ctx) => {
    const { setupShellCompletion } = await import('./shell-completion.js');
    const result = await setupShellCompletion();
    const output = result.lines
      .map((l: string) => l.startsWith('✓') ? chalk.green(l) : chalk.dim(l))
      .join('\n');
    return { output };
  },

  // ─── Maliyet (v3.9.2) ──────────────────────────────────────────────────────
  maliyet: (_args, ctx) => {
    const stats = ctx.getStats();
    const { inputTokens, outputTokens } = stats;
    const model = ctx.currentModel;
    const provider = ctx.currentProvider;

    if (inputTokens === 0 && outputTokens === 0) {
      return { output: chalk.dim('  Henüz token kullanımı yok.') };
    }

    const inputCost = calculateCostUSD(inputTokens, 0, model, provider);
    const outputCost = calculateCostUSD(0, outputTokens, model, provider);
    const total = inputCost + outputCost;

    const lines: string[] = [
      chalk.bold('\n  Oturum Maliyeti'),
      chalk.dim('  ' + '─'.repeat(44)),
      `  ${'Model:'.padEnd(20)} ${model}`,
      `  ${'Provider:'.padEnd(20)} ${provider}`,
      chalk.dim('  ' + '─'.repeat(44)),
      `  ${'Input:'.padEnd(20)} ${inputTokens.toLocaleString()} token  →  ${formatCostUSD(inputCost)}`,
      `  ${'Output:'.padEnd(20)} ${outputTokens.toLocaleString()} token  →  ${formatCostUSD(outputCost)}`,
      chalk.dim('  ' + '─'.repeat(44)),
      `  ${chalk.bold('Toplam:').padEnd(20 + 9)} ${chalk.green(formatCostUSD(total))}`,
    ];

    return { output: lines.join('\n') };
  },

  // ─── Paylaş (v3.9.2) ───────────────────────────────────────────────────────
  paylaş: async (args, ctx) => {
    const { writeFile: fsWrite, mkdir } = await import('fs/promises');
    const { join: pjoin } = await import('path');
    const { homedir: phome } = await import('os');

    const trimmed = args.trim();
    const isJson = trimmed.includes('json');
    const lastNMatch = trimmed.match(/son\s+(\d+)/i);
    const lastN = lastNMatch ? parseInt(lastNMatch[1]!) : 0;

    const history = ctx.getHistory();
    const messages = lastN > 0 ? history.slice(-lastN) : history;

    const exportDir = pjoin(phome(), '.seth', 'exports');
    await mkdir(exportDir, { recursive: true });

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sessionId = ctx.getSessionId().slice(0, 8);
    const ext = isJson ? 'json' : 'md';
    const filePath = pjoin(exportDir, `${sessionId}-${dateStr}.${ext}`);

    if (isJson) {
      await fsWrite(filePath, JSON.stringify({ sessionId, exportedAt: now.toISOString(), model: ctx.currentModel, provider: ctx.currentProvider, messages }, null, 2), 'utf-8');
    } else {
      const lines: string[] = [
        `# Konuşma — ${now.toLocaleString('tr-TR')}`,
        `**Oturum**: ${sessionId}  **Model**: ${ctx.currentModel}  **Provider**: ${ctx.currentProvider}`,
        '',
      ];
      for (const m of messages) {
        const role = m.role === 'user' ? '## Kullanıcı' : '## SETH';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2);
        lines.push(role, '', content, '');
      }
      await fsWrite(filePath, lines.join('\n'), 'utf-8');
    }

    return { output: chalk.green(`  ✓ Konuşma aktarıldı: ${filePath}`) };
  },

  // ─── Kod İnceleme (v3.9.2) ─────────────────────────────────────────────────
  incele: async (args, ctx) => {
    const { execSync } = await import('child_process');
    const trimmed = args.trim();

    let diff = '';
    let label = '';

    try {
      if (trimmed === '--head' || trimmed === 'head') {
        diff = execSync('git diff HEAD~1', { encoding: 'utf-8', stdio: 'pipe', cwd: ctx.getCwd() });
        label = 'Son commit';
      } else if (trimmed && !trimmed.startsWith('--')) {
        // Belirli dosya
        diff = execSync(`git diff HEAD -- ${trimmed}`, { encoding: 'utf-8', stdio: 'pipe', cwd: ctx.getCwd() });
        label = `Dosya: ${trimmed}`;
      } else {
        // --staged veya varsayılan
        diff = execSync('git diff --staged', { encoding: 'utf-8', stdio: 'pipe', cwd: ctx.getCwd() });
        label = 'Staged değişiklikler';
        if (!diff.trim()) {
          diff = execSync('git diff', { encoding: 'utf-8', stdio: 'pipe', cwd: ctx.getCwd() });
          label = 'Unstaged değişiklikler';
        }
      }
    } catch (err: any) {
      return { output: chalk.red(`  ✗ Git diff alınamadı: ${err.message?.slice(0, 200) ?? String(err)}`) };
    }

    if (!diff.trim()) {
      return { output: chalk.dim('  İncelenecek değişiklik bulunamadı.') };
    }

    const diffSlice = diff.slice(0, 10000) + (diff.length > 10000 ? '\n... (diff kısaltıldı)' : '');
    const context = `KOD İNCELEME İSTEĞİ — ${label}\n\nAşağıdaki diff'i kod kalitesi, güvenlik, performans ve best practices açısından incele:\n\n\`\`\`diff\n${diffSlice}\n\`\`\``;

    return { runAsUserMessage: context };
  },

  // ─── Skills (v3.9.2) ───────────────────────────────────────────────────────
  skills: (_args, _ctx) => {
    const allSkills = listAllSkills();
    return { output: formatSkillsTable(allSkills) };
  },

  skill: (args, _ctx) => {
    const parts = args.trim().split(/\s+/);
    const skillName = parts[0] ?? '';
    const params = parts.slice(1).join(' ');

    if (!skillName) {
      const allSkills = listAllSkills();
      return { output: formatSkillsTable(allSkills) };
    }

    const skill = findSkill(skillName);
    if (!skill) {
      return { output: chalk.red(`  ✗ Skill bulunamadı: "${skillName}"\n  /skills ile mevcut skill'leri listele.`) };
    }

    const prompt = renderSkill(skill, params);
    return { runAsUserMessage: prompt };
  },

  // ─── Keybindings (v3.9.2) ──────────────────────────────────────────────────
  keybindings: async (args, _ctx) => {
    const trimmed = args.trim().toLowerCase();

    if (trimmed === 'sıfırla' || trimmed === 'sifirla' || trimmed === 'reset') {
      const { unlink } = await import('fs/promises');
      const { join: pjoin } = await import('path');
      const { homedir: phome } = await import('os');
      const kbPath = pjoin(phome(), '.seth', 'keybindings.json');
      try {
        await unlink(kbPath);
        return { output: chalk.green('  ✓ Keybindinglar varsayılana sıfırlandı.') };
      } catch {
        return { output: chalk.dim('  Özel keybinding dosyası zaten yok.') };
      }
    }

    const bindings = loadKeybindings();
    return { output: formatKeybindingsTable(bindings) };
  },

  // ─── Koordinatör (v3.9.2) ──────────────────────────────────────────────────
  koordinator: (args, _ctx) => {
    const task = args.trim();
    if (!task) {
      return { output: chalk.dim('  Kullanım: /koordinator <görev>\n  Örnek: /koordinator "src/ dizinindeki tüm TODO\'ları bul ve özetle"') };
    }

    // Koordinatör modu mesajı — ajan alt görevlere bölerek çalışır
    const coordinatorMsg =
      `KOORDİNATÖR MODU: Aşağıdaki görevi analiz et, bağımsız alt görevlere böl ve her birini ` +
      `agent_spawn aracıyla paralel olarak çalıştır. Tüm sonuçları birleştirerek kapsamlı özet sun.\n\n` +
      `GÖREV: ${task}`;

    return { runAsUserMessage: coordinatorMsg };
  },

  ajanlar: (_args, _ctx) => {
    const depth = getActiveSubAgentCount();
    if (depth === 0) {
      return { output: chalk.dim('  Aktif alt ajan yok.') };
    }
    return { output: chalk.cyan(`  Aktif alt ajan derinliği: ${depth}`) };
  },

  // ─── Vim modu (v3.9.2) ─────────────────────────────────────────────────────
  vim: (_args, ctx) => {
    const current = ctx.config.repl?.vimMode ?? false;
    ctx.setVimMode(!current);
    const newState = !current;
    return {
      output: newState
        ? chalk.green('  ✓ Vim modu AKTİF — INSERT: yazma, Esc: NORMAL moda geç')
        : chalk.dim('  Vim modu kapalı.'),
    };
  },
};

export const COMMAND_ALIASES: Record<string, string> = {
  yardim: 'yardım',
  ozellikler: 'özellikler',
  saglayici: 'sağlayıcı',
  saglayicilar: 'sağlayıcı',
  araclar: 'araçlar',
  degistir: 'değiştir',
  sikistir: 'sıkıştır',
  repo_ozet: 'repo_özet',
  nasilcalisir: 'nasılçalışır',
  gecmis: 'geçmiş',
  guncelle: 'güncelle',
  istatistik: 'istatistikler',
  rapor_pdf: 'rapor',
  hafiza: 'hafıza',
  'hafiza-temizle': 'hafıza-temizle',
  baglam: 'bağlam',
  gorevler: 'görevler',
  yan: 'yan-sorgu',
  guvenlik: 'güvenlik',
  provider_test: 'provider-test',
  'plan-mode': 'plan-modu',
  planmodu: 'plan-modu',
  cp: 'checkpoint',
  approve: 'onayla',
  reject: 'reddet',
  pr: 'pr-incele',
  'pr-review': 'pr-incele',
  editor: 'ide',
  vscode: 'ide',
  // v3.9.2
  cost: 'maliyet',
  maliyet_goster: 'maliyet',
  paylas: 'paylaş',
  share: 'paylaş',
  review: 'incele',
  'code-review': 'incele',
  'skill-list': 'skills',
  kb: 'keybindings',
  agent: 'koordinator',
  agents: 'ajanlar',
  koordinatör: 'koordinator',
  'vim-mode': 'vim',
};

for (const [alias, target] of Object.entries(COMMAND_ALIASES)) {
  const targetHandler = COMMANDS[target];
  if (typeof targetHandler !== 'function') {
    throw new Error(`Alias hedefi bulunamadı: ${alias} -> ${target}`);
  }
  if (!COMMANDS[alias]) {
    COMMANDS[alias] = (args, ctx) => targetHandler(args, ctx);
  }
}

export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult | null> {
  const { cmd, args } = parseCommand(input);
  const handler = COMMANDS[cmd];
  if (!handler) return { output: chalk.red(`  Bilinmeyen komut: /${cmd}`) };
  return handler(args, ctx);
}

export function parseCommand(input: string): { cmd: string; args: string } {
  const parts = input.trim().substring(1).split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const args = parts.slice(1).join(' ');
  return { cmd, args };
}
