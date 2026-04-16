/**
 * @fileoverview Slash command handlers.
 */

import chalk from 'chalk';
import { cmd, navyBright, promptBright } from './theme.js';
import { select, isCancel, confirm, text } from '@clack/prompts';
import { writeFile } from 'fs/promises';
import { resolve, join } from 'path';
import { homedir } from 'os';
import type { ProviderName, SETHConfig, ChatMessage, PermissionLevel, ThinkingStyle } from './types.js';
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
import { listSessions } from './storage/session.js';
import { THEMES, type ThemeName, setTheme, getThemeColors } from './theme.js';

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
  getStats: () => { messages: number; inputTokens: number; outputTokens: number; turns: number };
  getSessionId: () => string;
  setThinkingStyle: (style: ThinkingStyle) => void;
  setVimMode: (enabled: boolean) => void;
  getMessages?: () => ChatMessage[];
}

export interface CommandResult {
  output?: string;
  shouldExit?: boolean;
  clearAndAnimate?: boolean;
  runAsUserMessage?: string;
}

const PERM_LABELS: Record<PermissionLevel, string> = {
  full: 'Tam — hiçbir şey sormaz',
  normal: 'Normal — yazma/çalıştırma işlemleri onay ister',
  dar: 'Dar — her araç onay ister',
};

// ─── Checkbox seçici (raw mode, boşluk=seç, Enter=onayla) ───────────────────
async function checkboxSelect<T extends [string, string, string, string, boolean]>(
  items: T[]
): Promise<T[]> {
  return new Promise(resolve => {
    const selected = new Set<number>(items.map((_, i) => i));
    let cursor = 0;

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(chalk.bold('  Kurulacak araçları seçin:\n'));
      process.stdout.write(chalk.dim('  Boşluk: seç/kaldır  •  Enter: onayla  •  ↑↓: gezin\n\n'));
      items.forEach((item, i) => {
        const isSel = selected.has(i);
        const isCur = i === cursor;
        const box = isSel ? chalk.green('◉') : chalk.dim('○');
        const line = `  ${box} ${item[0].padEnd(12)} ${chalk.dim(item[1])}`;
        process.stdout.write(isCur ? chalk.bgHex('#2a2a2a').white(line.padEnd(50)) + '\n' : line + '\n');
      });
      process.stdout.write(`\n  ${chalk.green(selected.size + ' araç seçili')} — Enter ile kur\n`);
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    render();

    const onData = (key: string) => {
      if (key === '\x03') { cleanup(); resolve([]); return; }
      if (key === '\r' || key === '\n') { cleanup(); resolve(items.filter((_, i) => selected.has(i))); return; }
      if (key === ' ') { selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor); render(); return; }
      if (key === '\x1b[A' && cursor > 0) { cursor--; render(); }
      if (key === '\x1b[B' && cursor < items.length - 1) { cursor++; render(); }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\x1b[2J\x1b[H');
    };

    process.stdin.on('data', onData);
  });
}

export const COMMANDS: Record<string, (args: string, ctx: CommandContext) => Promise<CommandResult> | CommandResult> = {
  yardım: (_args, ctx) => ({
    output: [
      chalk.bold(`SETH v${VERSION} — Komut Rehberi`),
      '',
      chalk.dim('  ─── Bilgi & Analiz ───────────────────────────────────────────'),
      `  ${cmd('/özellikler')}                    SETH yetenek raporunu göster`,
      `  ${cmd('/istatistikler')}                 Token kullanımı, maliyet tahmini, günlük kullanım`,
      `  ${cmd('/kullanım')}                      Bugünkü kullanım limitinizi göster`,
      `  ${cmd('/bağlam')}                        Token dağılımı, araç kullanım analizi`,
      `  ${cmd('/ara')} ${chalk.dim('<kelime>')}                  Mevcut konuşmada ara`,
      `  ${cmd('/doktor')}                        Ortam sağlığı + araç kontrolü + otomatik kurulum`,
      `  ${cmd('/repo_özet')}                     Git: dal, son commit, diff --stat, status`,
      `  ${cmd('/güncelle')}                      Yeni sürüm kontrolü (semver)`,
      '',
      chalk.dim('  ─── Bellek & Oturum ──────────────────────────────────────────'),
      `  ${cmd('/hafıza')}                        Kalıcı belleği göster (user/project/feedback/reference)`,
      `  ${cmd('/hafıza')} ${chalk.dim('ekle <tip> <içerik>')}    Belleğe yeni giriş ekle`,
      `  ${cmd('/hafıza')} ${chalk.dim('sil <tip>')}              Belirli bellek tipini temizle`,
      `  ${cmd('/hafıza-temizle')}                Tüm kalıcı belleği sil (onay ister)`,
      `  ${cmd('/bellek')}                        Görev listesi + oturum özeti`,
      `  ${cmd('/context-temizle')}               Oturumu sıfırla, yeni konuşma başlat`,
      `  ${cmd('/temizle')}                       Konuşma geçmişini temizle`,
      `  ${cmd('/sıkıştır')}                      Geçmişi AI ile özetle ve sıkıştır`,
      `  ${cmd('/geri')}                          Son mesajı geri al`,
      `  ${cmd('/kaydet')} ${chalk.dim('[md|html|txt] [dosya]')}  Konuşmayı dışa aktar`,
      `  ${cmd('/geçmiş')}                        Önceki oturumu devam ettir`,
      '',
      chalk.dim('  ─── Ayarlar ──────────────────────────────────────────────────'),
      `  ${cmd('/değiştir')}                      Etkileşimli ayar menüsü`,
      `  ${cmd('/sağlayıcı')} ${chalk.dim('<isim>')}             Sağlayıcı: claude, gemini, openai, ollama`,
      `  ${cmd('/model')} ${chalk.dim('<isim>')}                 Model adını doğrudan ayarla`,
      `  ${cmd('/modeller')}                      Mevcut modelleri listele ve seç`,
      `  ${cmd('/araçlar')} ${chalk.dim('<açık|kapalı>')}        Araç kullanımını aç/kapat`,
      `  ${cmd('/ajan')} ${chalk.dim('<açık|kapalı>')}           Çok tur ajan modunu aç/kapat`,
      `  ${cmd('/yetki')} ${chalk.dim('<full|normal|dar>')}      İzin seviyesini ayarla`,
      `  ${cmd('/tema')}                          Renk teması (dark, light, cyberpunk, retro, ocean, sunset)`,
      `  ${cmd('/apikey')}                        API anahtarlarını yönet / sil`,
      `  ${cmd('/context')} ${chalk.dim('<miktar>')}             Token bütçesi (örn: 500k, 2M)`,
      '',
      chalk.dim('  ─── Giriş & Güvenlik ────────────────────────────────────────'),
      `  ${cmd('/giriş')}                         Hesap değiştir veya giriş yap`,
      `  ${cmd('/çıkış')}                         Oturumu kapat ve uygulamadan çık`,
      '',
      chalk.dim('  ─── Araçlar & Sistem ─────────────────────────────────────────'),
      `  ${cmd('/hook')} ${chalk.dim('[liste|örnek]')}           Hook sistemi (PreToolUse/PostToolUse)`,
      `  ${cmd('/rapor')} ${chalk.dim('pdf')}                    Güvenlik taramasını LaTeX/PDF olarak aktar`,
      `  ${cmd('/görevler')}                      Arka plan görevlerini listele`,
      `  ${cmd('/yan-sorgu')} ${chalk.dim('<soru>')}             Konuşmayı bozmadan hızlı soru sor`,
      `  ${cmd('/sor')}                           İstek sihirbazını başlat`,
      `  ${cmd('/dusunme')}                       Düşünme göstergesini aç/kapat`,
      `  ${cmd('/cd')} ${chalk.dim('<dizin>')}                   Çalışma dizinini değiştir`,
      `  ${cmd('/pwd')}                           Mevcut dizini göster`,
      `  ${cmd('/nasılçalışır')}                  Canlı demo (typewriter animasyonu)`,
      `  ${cmd('/cikis')}                         Uygulamadan çık`,
      '',
      chalk.dim('  ─── Kısayollar ───────────────────────────────────────────────'),
      chalk.dim('  Ctrl+C   İşlemi iptal et'),
      chalk.dim('  Ctrl+D   Çıkış'),
      chalk.dim('  Ctrl+R   Geçmiş fuzzy arama'),
      chalk.dim('  Esc      AI yanıtını durdur'),
      chalk.dim('  ↑↓       Geçmiş komutlar'),
      chalk.dim('  \\        Satır sonu — çok satırlı girdi'),
      '',
      chalk.dim(`  İzin: ${ctx.getPermissionLevel()}  •  Sağlayıcı: ${ctx.currentProvider}  •  Model: ${ctx.currentModel}`),
    ].join('\n'),
  }),
  özellikler: async () => ({
    output: `
🎯 SETH v3.0.0-beta 'LEVIATHAN' — Yetenek Raporu

1. Siber Harekat (Multi-Target Campaign)
   • IP aralıkları (CIDR) ve wildcard alan adları (*.site.com) üzerinde otonom harekat.
   • Ağdaki en zayıf halkayı (IoT, Printer, Legacy Server) otomatik tespit etme.

2. OSINT ve Sızıntı Verisi (Breach-Feeder)
   • breach_query: Hedef domain ile ilişkili sızdırılmış e-posta/şifre verilerini otonom çekme.
   • OSINT tabanlı akıllı brute-force saldırıları.

3. Operasyon Haritası (Live Attack Map)
   • /harita: Operasyonun hangi aşamada olduğunu ve keşfedilen varlıkları görselleştirme.

4. Gelişmiş İstismar ve Denetim
   • bypass_cloudflare: Gerçek IP tespiti.
   • config_audit & service_integrity: Sistem bütünlüğü ve yapılandırma hataları.
   • brute_force & exploit_search: Otonom sızma ve derinlemesine istismar.

SETH artık sadece bir araç değil, bir ordu gibi düşünen 'Leviathan' çekirdeğine sahip. 😈🐍🔥
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
        initialValue: ctx.getPermissionLevel()
      });
      if (isCancel(p)) return { output: chalk.gray('  İptal edildi.') };
      ctx.setPermissionLevel(p as PermissionLevel);
      return { output: chalk.green(`  ✓ İzin seviyesi: ${p as string}`) };
    }
    if (valid.includes(level as PermissionLevel)) {
      ctx.setPermissionLevel(level as PermissionLevel);
      return { output: chalk.green(`  ✓ İzin seviyesi: ${level}`) };
    }
    return { output: chalk.red('  Geçersiz seviye.') };
  },

  context: async (args, ctx) => {
    const input = args.trim().toLowerCase();
    if (!input) {
      const p = await select({
        message: 'Oturum token bütçesi seçin:',
        options: [{ value: 250000, label: '250k' }, { value: 500000, label: '500k' }, { value: 1000000, label: '1m' }, { value: 2000000, label: '2m' }]
      });
      if (isCancel(p)) return { output: chalk.gray('İptal edildi.') };
      ctx.setContextBudgetTokens(p as number);
      return { output: chalk.green(`✓ Bütçe: ${(p as number).toLocaleString()} token`) };
    }
    let val = parseInt(input);
    if (input.endsWith('k')) val = parseInt(input) * 1000;
    if (input.endsWith('m')) val = parseInt(input) * 1000000;
    if (isNaN(val) || val <= 0) return { output: chalk.red('Geçersiz miktar.') };
    ctx.setContextBudgetTokens(val);
    return { output: chalk.green(`✓ Bütçe: ${val.toLocaleString()} token`) };
  },

  sağlayıcı: async (args, ctx) => {
    const p = args.trim().toLowerCase();
    if (!p) {
      const PROVIDERS = [
        { value: 'ollama',      label: 'ollama       — Yerel / Self-Hosted       (%100 uyumlu)' },
        { value: 'openrouter',  label: 'openrouter   — 300+ Model, Tek API       (%100 uyumlu)' },
        { value: 'groq',        label: 'groq         — Groq LPU, Hızlı Çıkarım  (%100 uyumlu)' },
        { value: 'claude',      label: 'claude       — Anthropic                 (test edilmedi, çünkü api alacak param yok)' },
        { value: 'gemini',      label: 'gemini       — Google AI Studio          (test edilmedi, çünkü api alacak param yok)' },
        { value: 'openai',      label: 'openai       — OpenAI                    (test edilmedi, çünkü api alacak param yok)' },
      ];
      const selected = await select({
        message: 'Sağlayıcı seçin:',
        options: PROVIDERS,
      });
      if (isCancel(selected)) return { output: chalk.gray('İptal edildi.') };
      const providerName = selected as ProviderName;

      // API key gerektiren sağlayıcılar için key kontrolü
      const API_KEY_PROVIDERS: Partial<Record<ProviderName, { label: string; envVar: string }>> = {
        claude:      { label: 'Anthropic API Key (sk-ant-...)',     envVar: 'ANTHROPIC_API_KEY' },
        gemini:      { label: 'Google AI Studio API Key (AIza...)', envVar: 'GEMINI_API_KEY' },
        openai:      { label: 'OpenAI API Key (sk-...)',            envVar: 'OPENAI_API_KEY' },
        openrouter:  { label: 'OpenRouter API Key (sk-or-...)',     envVar: 'OPENROUTER_API_KEY' },
        groq:        { label: 'Groq API Key (gsk_...)',             envVar: 'GROQ_API_KEY' },
      };

      const keyInfo = API_KEY_PROVIDERS[providerName];
      if (keyInfo) {
        const existingKey = ctx.config.providers[providerName]?.apiKey || process.env[keyInfo.envVar];
        if (!existingKey) {
          const apiKey = await text({
            message: `${keyInfo.label}:`,
            placeholder: 'API anahtarını buraya yapıştır...',
            validate: (v) => (v ?? '').trim().length < 10 ? 'Geçersiz API anahtarı.' : undefined,
          });
          if (isCancel(apiKey)) return { output: chalk.gray('İptal edildi.') };
          saveConfig({
            providers: { [providerName]: { apiKey: (apiKey as string).trim() } } as SETHConfig['providers'],
          });
          // Config'i yeniden yükle ki setProvider güncel key'i görsün
          Object.assign(ctx.config.providers, { [providerName]: { ...ctx.config.providers[providerName], apiKey: apiKey.trim() } });
        }
      }

      await ctx.setProvider(providerName);
      return COMMANDS.modeller!('', ctx);
    }
    try {
      await ctx.setProvider(p as ProviderName);
      return { output: chalk.green(`✓ Sağlayıcı: ${p}`) };
    } catch (err) {
      return { output: chalk.red(`Sağlayıcı hatası: ${String(err)}`) };
    }
  },

  sağlayıcılar: async (_args, ctx) => COMMANDS.sağlayıcı!('', ctx),

  model: async (args, ctx) => {
    const m = args.trim();
    if (!m) return COMMANDS.modeller!('', ctx);
    ctx.setModel(m);
    return { output: chalk.green(`✓ Model: ${m}`) };
  },

  araçlar: async (args, ctx) => {
    const val = args.trim().toLowerCase();
    if (val === 'açık' || val === 'acik' || val === 'on' || val === '1') { ctx.setToolsEnabled(true); return { output: chalk.green('✓ Araçlar aktif.') }; }
    if (val === 'kapalı' || val === 'kapali' || val === 'off' || val === '0') { ctx.setToolsEnabled(false); return { output: chalk.green('✓ Araçlar devre dışı.') }; }
    const t = await confirm({ message: 'Araçlar aktif edilsin mi?' });
    if (isCancel(t)) return { output: chalk.gray('İptal.') };
    ctx.setToolsEnabled(t);
    return { output: chalk.green(`✓ Araçlar ${t ? 'aktif' : 'kapalı'}`) };
  },

  ajan: async (args, ctx) => {
    const val = args.trim().toLowerCase();
    if (val === 'açık' || val === 'acik' || val === 'on' || val === '1') { ctx.setAgentEnabled(true); return { output: chalk.green('✓ Ajan modu aktif.') }; }
    if (val === 'kapalı' || val === 'kapali' || val === 'off' || val === '0') { ctx.setAgentEnabled(false); return { output: chalk.green('✓ Ajan modu devre dışı.') }; }
    const a = await confirm({ message: 'Ajan modu aktif edilsin mi?' });
    if (isCancel(a)) return { output: chalk.gray('İptal.') };
    ctx.setAgentEnabled(a);
    return { output: chalk.green(`✓ Ajan modu ${a ? 'aktif' : 'kapalı'}`) };
  },

  değiştir: async (_args, ctx) => {
    const action = await select({
      message: 'Neyi değiştirmek istersiniz?',
      options: [
        { value: 'provider', label: `Sağlayıcı (${ctx.currentProvider})` },
        { value: 'model', label: `Model (${ctx.currentModel})` },
        { value: 'tools', label: `Araçlar (${ctx.toolsEnabled ? 'açık' : 'kapalı'})` },
        { value: 'agent', label: `Ajan Modu (${ctx.agentEnabled ? 'açık' : 'kapalı'})` },
        { value: 'context', label: `Bütçe (${ctx.getContextBudgetTokens().toLocaleString()} tok)` },
        { value: 'perm', label: `İzin Seviyesi (${ctx.getPermissionLevel()})` },
      ],
    });
    if (isCancel(action)) return { output: chalk.gray('İptal edildi.') };

    if (action === 'provider') return COMMANDS.saglayici!('', ctx);
    if (action === 'model') return COMMANDS.modeller!('', ctx);
    if (action === 'tools') return COMMANDS.araclar!('', ctx);
    if (action === 'agent') return COMMANDS.ajan!('', ctx);
    if (action === 'context') return COMMANDS.context!('', ctx);
    if (action === 'perm') return COMMANDS.yetki!('', ctx);
    return { output: '' };
  },

  modeller: async (_args, ctx) => {
    let models: string[] = [];

    if (ctx.currentProvider === 'ollama') {
      try {
        const baseUrl = ctx.config.providers.ollama?.baseUrl || 'http://localhost:11434';
        const res = await fetch(`${baseUrl}/api/tags`);
        if (res.ok) {
          const data = await res.json() as { models?: { name: string }[] };
          models = data.models?.map((m) => m.name) || [];
        }
      } catch { /* fallback */ }
    } else if (ctx.currentProvider === 'gemini') {
      try {
        const apiKey = ctx.config.providers.gemini?.apiKey || process.env.GEMINI_API_KEY;
        if (apiKey) {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          if (res.ok) {
            const data = await res.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
            models = (data.models || [])
              .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
              .map(m => m.name.replace('models/', ''));
          }
        }
      } catch { /* fallback */ }
    } else if (ctx.currentProvider === 'openai') {
      try {
        const apiKey = ctx.config.providers.openai?.apiKey || process.env.OPENAI_API_KEY;
        if (apiKey) {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (res.ok) {
            const data = await res.json() as { data?: { id: string }[] };
            models = (data.data || [])
              .map(m => m.id)
              .filter(id => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'))
              .sort();
          }
        }
      } catch { /* fallback */ }
    } else if (ctx.currentProvider === 'claude') {
      try {
        const apiKey = ctx.config.providers.claude?.apiKey || process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          });
          if (res.ok) {
            const data = await res.json() as { data?: { id: string }[] };
            models = (data.data || []).map(m => m.id);
          }
        }
      } catch { /* fallback */ }
    } else if (ctx.currentProvider === 'groq') {
      try {
        const apiKey = ctx.config.providers.groq?.apiKey || process.env.GROQ_API_KEY;
        if (apiKey) {
          const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (res.ok) {
            const data = await res.json() as { data?: { id: string; active?: boolean }[] };
            models = (data.data || [])
              .filter(m => m.active !== false && !m.id.includes('whisper') && !m.id.includes('guard'))
              .map(m => m.id)
              .sort();
          }
        }
      } catch { /* fallback */ }
    } else if (ctx.currentProvider === 'openrouter') {
      try {
        const apiKey = ctx.config.providers.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
        if (apiKey) {
          const res = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (res.ok) {
            const data = await res.json() as { data?: { id: string }[] };
            models = (data.data || []).map(m => m.id).sort();
          }
        }
      } catch { /* fallback */ }
    }

    if (models.length === 0) {
      const defaults: Record<string, string[]> = {
        openai:      ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini', 'gpt-4-turbo'],
        gemini:      ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        claude:      ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-20240229'],
        ollama:      ['qwen3-coder', 'qwen2.5-coder:7b', 'llama3.1', 'mistral', 'codellama'],
        openrouter:  ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.5-pro', 'meta-llama/llama-3.1-70b-instruct', 'mistralai/mistral-7b-instruct'],
        groq:        ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
      };
      models = defaults[ctx.currentProvider] ?? [];
    }

    const m = await select({
      message: `${ctx.currentProvider} için model seçin:`,
      options: models.map(x => ({ value: x, label: x })),
    });

    if (isCancel(m)) return { output: chalk.gray('İptal edildi.') };
    ctx.setModel(m as string);
    return { output: chalk.green(`✓ Model: ${m as string}`) };
  },

  cd: (args, ctx) => {
    const target = ctx.changeCwd(args.trim());
    return target ? { output: chalk.green(`✓ Dizin: ${target}`) } : { output: chalk.red(`✗ Hata: Dizin bulunamadı.`) };
  },

  pwd: (_args, ctx) => ({ output: ctx.getCwd() }),
  geri: (_args, ctx) => { ctx.undoHistory(); return { output: chalk.gray('  (Son mesaj geri alındı)') }; },
  temizle: (args, ctx) => { ctx.clearHistory(args.trim() === 'tum' ? 'all' : 'active'); return { output: '', clearAndAnimate: true }; },

  // ─── Context & Hafıza Yönetimi ────────────────────────────────────────────
  'context-temizle': (_args, ctx) => {
    ctx.clearHistory('active');
    return { output: chalk.green('✓ Oturum sıfırlandı — yeni konuşma başlatıldı.'), clearAndAnimate: true };
  },

  hafıza: async (args, _ctx) => {
    const sub = args.trim();
    const { readMemory, writeMemory, loadAllMemories, appendMemory } = await import('./storage/memory.js');
    const validTypes = ['user', 'project', 'feedback', 'reference'] as const;
    type MT = typeof validTypes[number];

    // /hafıza sil <tip> — belirli tipi sil
    if (sub.startsWith('sil ')) {
      const tip = sub.slice(4).trim() as MT;
      if (!validTypes.includes(tip)) {
        return { output: chalk.red(`Geçersiz tip. Kullanım: /hafıza sil <user|project|feedback|reference>`) };
      }
      writeMemory(tip, '');
      return { output: chalk.green(`✓ ${tip} belleği temizlendi.`) };
    }

    // /hafıza ekle <tip> <içerik>
    if (sub.startsWith('ekle ')) {
      const rest = sub.slice(5);
      const [tip, ...parts] = rest.split(' ');
      if (!validTypes.includes(tip as MT)) {
        return { output: chalk.red(`Kullanım: /hafıza ekle <user|project|feedback|reference> <içerik>`) };
      }
      appendMemory(tip as MT, parts.join(' '));
      return { output: chalk.green(`✓ Belleğe eklendi (${tip})`) };
    }

    // /hafıza <tip> — belirli tipi göster
    if (validTypes.includes(sub as MT)) {
      const content = readMemory(sub as MT);
      if (!content.trim()) return { output: chalk.dim(`(${sub} belleği boş)`) };
      const lines = [
        chalk.bold(`🧠 ${sub} belleği:`),
        '',
        content.trim(),
        '',
        chalk.dim(`  /hafıza sil ${sub}  — bu belleği temizle`),
        chalk.dim(`  /hafıza ekle ${sub} <içerik>  — ekle`),
      ];
      return { output: lines.join('\n') };
    }

    // /hafıza — tümünü göster
    const all = loadAllMemories();
    const lines = [
      chalk.bold('🧠 Kalıcı Bellek'),
      chalk.dim('  ~/.seth/memory/ altında saklanır'),
      '',
    ];
    if (!all.trim()) {
      lines.push(chalk.dim('  (bellek boş)'));
    } else {
      lines.push(all);
    }
    lines.push('');
    lines.push(chalk.dim('  Komutlar:'));
    lines.push(chalk.dim('  /hafıza <user|project|feedback|reference>  — tipi göster'));
    lines.push(chalk.dim('  /hafıza ekle <tip> <içerik>               — ekle'));
    lines.push(chalk.dim('  /hafıza sil <tip>                         — tipi temizle'));
    lines.push(chalk.dim('  /hafıza-temizle                           — tümünü sil'));
    return { output: lines.join('\n') };
  },

  'hafıza-temizle': async () => {
    const { writeMemory } = await import('./storage/memory.js');
    const { confirm: clackConfirm } = await import('@clack/prompts');
    const sure = await clackConfirm({ message: 'Tüm kalıcı bellek silinsin mi? (geri alınamaz)' });
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

  // ─── Bağlam Analizi ───────────────────────────────────────────────────────
  bağlam: (_args, ctx) => {
    const messages = ctx.getMessages?.() ?? [];
    const toolCounts: Record<string, number> = {};
    const fileReads: Record<string, number> = {};
    let userMsgs = 0, assistantMsgs = 0, totalChars = 0;

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content
        : Array.isArray(msg.content) ? msg.content.map((b: any) => b.text ?? b.content ?? '').join(' ')
        : '';
      totalChars += content.length;
      if (msg.role === 'user') userMsgs++;
      else assistantMsgs++;

      // Araç kullanımı say
      const toolMatches = content.matchAll(/"name":\s*"([^"]+)"/g);
      for (const m of toolMatches) {
        const name = m[1]!;
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      }
      // Dosya okuma say
      const fileMatches = content.matchAll(/"path":\s*"([^"]+)"/g);
      for (const m of fileMatches) {
        const path = m[1]!;
        fileReads[path] = (fileReads[path] ?? 0) + 1;
      }
    }

    const estTokens = Math.round(totalChars / 4);
    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const dupFiles = Object.entries(fileReads).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const lines = [
      chalk.bold('📊 Bağlam Analizi'),
      '',
      `  Mesajlar    : ${chalk.cyan(userMsgs)} kullanıcı, ${chalk.green(assistantMsgs)} asistan`,
      `  Tahmini tok : ${chalk.yellow(estTokens.toLocaleString())}`,
      `  Toplam char : ${totalChars.toLocaleString()}`,
    ];
    if (topTools.length > 0) {
      lines.push('', chalk.bold('  En çok kullanılan araçlar:'));
      topTools.forEach(([name, count]) => lines.push(`    ${name.padEnd(20)} ${chalk.dim(`×${count}`)}`));
    }
    if (dupFiles.length > 0) {
      lines.push('', chalk.bold('  Tekrar okunan dosyalar:'));
      dupFiles.forEach(([path, count]) => lines.push(`    ${path.slice(-40).padEnd(40)} ${chalk.yellow(`×${count}`)}`));
    }
    return { output: lines.join('\n') };
  },

  sıkıştır: async (_args, ctx) => { 
    const r = await ctx.compactHistory(); 
    return r ? { output: chalk.green(`✓ Sıkıştırıldı: ${r.before} -> ${r.after}`) } : { output: chalk.gray('Yetersiz mesaj.') }; 
  },
  kaydet: async (args, ctx) => {
    const parts = args.trim().split(' ');
    const fmt = ['html', 'txt', 'md'].includes(parts[0] ?? '') ? parts.shift()! : 'md';
    const filename = parts.join(' ') || `sohbet_${Date.now()}.${fmt}`;
    const messages = ctx.getHistory();

    let content: string;
    if (fmt === 'html') {
      const rows = messages.map(m => {
        const role = m.role === 'user' ? '👤 Sen' : '🤖 SETH';
        const text = (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const bg = m.role === 'user' ? '#2a2a2a' : '#1a1a2e';
        return `<div style="background:${bg};color:#eee;padding:12px 16px;margin:8px 0;border-radius:6px"><strong>${role}</strong><pre style="white-space:pre-wrap;margin:8px 0 0">${text}</pre></div>`;
      }).join('\n');
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SETH Sohbet</title></head><body style="background:#111;font-family:monospace;max-width:900px;margin:auto;padding:20px">${rows}</body></html>`;
    } else if (fmt === 'txt') {
      content = messages.map(m => `[${m.role.toUpperCase()}]\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}\n`).join('\n---\n\n');
    } else {
      content = messages.map(m => `### ${m.role.toUpperCase()}\n\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n---\n\n');
    }

    await writeFile(resolve(ctx.getCwd(), filename), content);
    return { output: chalk.green(`✓ Kaydedildi: ${filename} (${fmt.toUpperCase()})`) };
  },
  bellek: async (args, ctx) => {
    const sub = args.trim();
    // /bellek kaydet <tip> <içerik>
    if (sub.startsWith('kaydet ')) {
      const rest = sub.slice(7);
      const [tip, ...contentParts] = rest.split(' ');
      const validTypes: MemoryType[] = ['user', 'project', 'feedback', 'reference'];
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

  istatistikler: async (_args, ctx) => {
    const s = ctx.getStats();
    const history = loadHistory();
    const totalTokens = s.inputTokens + s.outputTokens;
    const costEst = (totalTokens / 1_000_000 * 3).toFixed(4); // ~$3/M token

    const lines = [
      chalk.bold('📊 SETH İstatistikleri'),
      '',
      `  Mesaj sayısı  : ${chalk.cyan(s.messages)}`,
      `  Toplam token  : ${chalk.cyan(totalTokens.toLocaleString())}`,
      `    ↳ Giriş     : ${chalk.dim(s.inputTokens.toLocaleString())}`,
      `    ↳ Çıkış     : ${chalk.dim(s.outputTokens.toLocaleString())}`,
      `  Tur sayısı    : ${chalk.cyan(s.turns)}`,
      `  Tahmini maliyet: ${chalk.yellow('~$' + costEst)}`,
      '',
      `  Geçmiş kayıt  : ${chalk.cyan(history.length)} komut`,
    ];
    console.log(lines.join('\n'));

    // Günlük kullanım bilgilerini getir
    const { showUsage, currentUser } = await import('./auth.js');
    if (currentUser) {
      await showUsage(currentUser.id);
    }

    return { output: chalk.dim('  Token maliyeti tahminidir, gerçek fiyat sağlayıcıya göre değişir.') };
  },
  repo_özet: async (_args, ctx) => { const res = await runRepoOzetSummary(ctx.getCwd()); return { output: res.output }; },
  sor: async (_args, ctx) => { const p = await runSorWizard(ctx.getSessionId()); return typeof p === 'string' ? { runAsUserMessage: p } : { output: chalk.gray('İptal.') }; },
  doktor: async (_args, ctx) => {
    const { execSync, spawnSync } = await import('child_process');
    const { confirm: clackConfirm, select: clackSelect, isCancel } = await import('@clack/prompts');

    const checkCmd = (c: string): boolean => {
      try { execSync(`which ${c}`, { stdio: 'ignore' }); return true; } catch { return false; }
    };

    // [komut, açıklama, apt paketi, brew paketi, zorunlu mu]
    type ToolEntry = [string, string, string, string, boolean];
    const allTools: ToolEntry[] = [
      // Temel
      ['curl',      'HTTP istekleri',           'curl',                'curl',       true],
      ['git',       'Versiyon kontrolü',         'git',                 'git',        true],
      ['node',      'Node.js runtime',           'nodejs',              'node',       true],
      ['python3',   'Python runtime',            'python3',             'python3',    false],
      ['jq',        'JSON işleme',               'jq',                  'jq',         false],
      ['rg',        'Ripgrep (hızlı arama)',      'ripgrep',             'ripgrep',    false],
      // Siber güvenlik
      ['nmap',      'Ağ tarama',                 'nmap',                'nmap',       false],
      ['nikto',     'Web zafiyet tarayıcı',       'nikto',               'nikto',      false],
      ['gobuster',  'Dizin brute force',          'gobuster',            'gobuster',   false],
      ['sqlmap',    'SQL injection testi',        'sqlmap',              'sqlmap',     false],
      ['whois',     'WHOIS sorgusu',              'whois',               'whois',      false],
      ['dig',       'DNS sorguları',              'dnsutils',            'bind',       false],
      ['whatweb',   'Web teknoloji tespiti',      'whatweb',             'whatweb',    false],
      ['ffuf',      'Web fuzzer',                 'ffuf',                'ffuf',       false],
      ['masscan',   'Hızlı port tarayıcı',        'masscan',             'masscan',    false],
      ['nc',        'Netcat',                     'netcat-openbsd',      'netcat',     false],
      ['wpscan',    'WordPress tarayıcı',         'ruby && gem install wpscan', 'wpscan', false],
      ['nuclei',    'Zafiyet tarayıcı',           'golang-go',           'nuclei',     false],
      ['subfinder', 'Subdomain keşfi',            'golang-go',           'subfinder',  false],
    ];

    const isMac = process.platform === 'darwin';
    const hasBrew = checkCmd('brew');
    const hasApt  = checkCmd('apt');

    const lines: string[] = [
      chalk.bold('🏥 SETH Sistem Sağlık Kontrolü'),
      `  Versiyon : ${VERSION}`,
      `  Sağlayıcı: ${ctx.currentProvider}`,
      `  Model    : ${ctx.currentModel}`,
      `  Dizin    : ${ctx.getCwd()}`,
      `  İzin     : ${ctx.getPermissionLevel()}`,
      '',
      chalk.bold('🔧 Araç Durumu'),
    ];

    const missing: ToolEntry[] = [];
    for (const entry of allTools) {
      const [cmd, desc] = entry;
      const ok = checkCmd(cmd);
      const tag = entry[4] ? chalk.dim('(zorunlu)') : '';
      lines.push(`  ${ok ? chalk.green('✓') : chalk.red('✗')} ${cmd.padEnd(12)} ${chalk.dim(desc)} ${tag}`);
      if (!ok) missing.push(entry);
    }

    console.log(lines.join('\n'));

    if (missing.length === 0) {
      console.log('\n' + chalk.green('✓ Tüm araçlar mevcut.'));
      return { output: '' };
    }

    console.log('');
    console.log(chalk.yellow(`⚠  ${missing.length} araç eksik.`));

    // Otomatik kurulum teklifi
    const installable = missing.filter(([, , apt, brew]) =>
      (hasApt && apt && !apt.includes('gem') && !apt.includes('golang')) ||
      (hasBrew && brew)
    );

    if (installable.length === 0) {
      console.log(chalk.dim('  Otomatik kurulum desteklenmiyor. Manuel kurulum gerekli.'));
      return { output: '' };
    }

    const choice = await clackSelect({
      message: `${installable.length} araç otomatik kurulabilir. Ne yapmak istersiniz?`,
      options: [
        { value: 'all',      label: `Tümünü kur (${installable.length} araç)` },
        { value: 'required', label: 'Sadece zorunlu araçları kur' },
        { value: 'select',   label: 'Seçerek kur' },
        { value: 'skip',     label: 'Şimdi değil' },
      ],
    });

    if (isCancel(choice) || choice === 'skip') return { output: '' };

    let toInstall: ToolEntry[] = [];
    if (choice === 'all') toInstall = installable;
    else if (choice === 'required') toInstall = installable.filter(e => e[4]);
    else if (choice === 'select') {
      // Kendi checkbox UI — boşluk=seç/kaldır, Enter=onayla
      toInstall = await checkboxSelect(installable);
      if (toInstall.length === 0) return { output: '' };
    }

    if (toInstall.length === 0) return { output: '' };

    console.log('');
    for (const [cmd, desc, apt, brew] of toInstall) {
      const pkg = isMac && hasBrew ? brew : apt;
      const installCmd = isMac && hasBrew ? `brew install ${pkg}` : `sudo apt install -y ${pkg}`;
      console.log(chalk.dim(`  → ${cmd}: ${installCmd}`));

      try {
        const args = isMac && hasBrew
          ? ['install', pkg]
          : ['apt', 'install', '-y', pkg];
        const bin = isMac && hasBrew ? 'brew' : 'sudo';
        const result = spawnSync(bin, args, { stdio: 'inherit', encoding: 'utf8' });
        if (result.status === 0) {
          console.log(chalk.green(`  ✓ ${cmd} kuruldu`));
        } else {
          console.log(chalk.red(`  ✗ ${cmd} kurulamadı (kod: ${result.status})`));
        }
      } catch (e: any) {
        console.log(chalk.red(`  ✗ ${cmd}: ${e.message}`));
      }
    }

    return { output: '' };
  },

  web: async (args, ctx) => {
    if (!args.trim()) return { output: [chalk.bold('Web Browser Otomasyon'), '', chalk.dim('Kullanım:'), `  ${cmd('/web')} ${chalk.dim('navigate <url>')}`, `  ${cmd('/web')} ${chalk.dim('extract [json]')}`, `  ${cmd('/web')} ${chalk.dim('screenshot')}`, `  ${cmd('/web')} ${chalk.dim('close')}`].join('\n') };
    const parts = args.trim().split(' ');
    const firstWord = parts[0];
    const simpleActions = ['navigate', 'click', 'type', 'screenshot', 'extract', 'cookie', 'execute', 'wait', 'scroll', 'download', 'close'];
    if (simpleActions.includes(firstWord)) {
      if (firstWord === 'close') { const { closeBrowser } = await import('./tools/browser-automation.js'); await closeBrowser(); return { output: chalk.green('✓ Tarayıcı kapatıldı') }; }
      let action = firstWord; let params: Record<string, string> = {};
      if (action === 'navigate') params.url = parts[1] || '';
      else if (action === 'click') params.selector = parts[1] || '';
      else if (action === 'type') { params.selector = parts[1] || ''; params.text = parts.slice(2).join(' '); }
      else if (action === 'extract') params.format = parts[1] || 'text';
      else if (action === 'wait') params.selector = parts[1] || '';
      else if (action === 'execute') params.script = parts.slice(1).join(' ');
      const paramStr = Object.entries(params).map(([k, v]) => `${k}="${v}"`).join(', ');
      return { runAsUserMessage: `browser_automation aracını kullan: action="${action}", ${paramStr}` };
    }
    return { output: chalk.yellow('⚠️  browser_automation adımlarını manuel kullanın') };
  },

  nasılçalışır: async () => { await runNasilCalisirAnimation(); return { output: '' }; },

  // ─── Yan Sorgu ────────────────────────────────────────────────────────────
  'yan-sorgu': async (args, ctx) => {
    if (!args.trim()) return { output: chalk.dim('Kullanım: /yan-sorgu <soru>') };
    // Mevcut konuşmayı bozmadan ayrı bir headless sorgu yap
    return { runAsUserMessage: `[YAN SORGU - mevcut konuşmayı etkileme, sadece bu soruyu yanıtla]: ${args.trim()}` };
  },

  // ─── Arka Plan Görevleri ──────────────────────────────────────────────────
  görevler: async () => {
    const { taskListTool } = await import('./tools/background-tasks.js');
    return taskListTool.execute({}, process.cwd());
  },

  // ─── Güncelleme Kontrolü ──────────────────────────────────────────────────
  güncelle: async () => {
    try {
      const { execSync } = await import('child_process');
      const { semverGt } = await import('./semver.js');
      const latest = execSync('npm show seth version 2>/dev/null', { encoding: 'utf8', timeout: 8000 }).trim();
      if (!latest) return { output: chalk.dim('npm erişilemiyor.') };
      if (!semverGt(latest, VERSION)) {
        return { output: chalk.green(`✓ Seth güncel (v${VERSION})`) };
      }
      return { output: [
        chalk.yellow(`⚡ Yeni sürüm: v${latest}  (mevcut: v${VERSION})`),
        chalk.dim('  Güncellemek için: npm install -g seth'),
      ].join('\n') };
    } catch {
      return { output: chalk.dim('Güncelleme kontrolü başarısız.') };
    }
  },

  // ─── Hook Yönetimi ────────────────────────────────────────────────────────
  hook: async (args) => {
    const sub = args.trim();
    if (sub === 'liste' || sub === '') {
      const hooks = loadHooks();
      if (hooks.length === 0) return { output: chalk.dim('Hook tanımlı değil.\n\nÖrnek: ~/.seth/hooks.json\n' + getHooksExample()) };
      return { output: chalk.bold('🪝 Aktif Hook\'lar\n') + hooks.map((h, i) =>
        `  ${i + 1}. [${h.event}] ${h.tool ? `(${h.tool}) ` : ''}${h.command}`
      ).join('\n') };
    }
    if (sub === 'örnek') {
      const hooksFile = join(homedir(), '.seth', 'hooks.json');
      return { output: `Örnek hooks.json (${hooksFile}):\n\n${getHooksExample()}` };
    }
    return { output: chalk.dim('Kullanım: /hook liste | /hook örnek') };
  },

  // ─── Güvenlik Raporu PDF ──────────────────────────────────────────────────
  rapor: async (args, ctx) => {
    const sub = args.trim();
    if (sub === 'pdf' || sub === '') {
      // Son konuşmadan rapor metni al
      const { confirm: clackConfirm } = await import('@clack/prompts');
      const shouldExport = await clackConfirm({
        message: 'Son güvenlik taraması çıktısını PDF olarak dışa aktarmak ister misiniz?'
      });
      if (isCancel(shouldExport) || !shouldExport) return { output: chalk.dim('İptal.') };

      const outputDir = ctx.getCwd();
      // Konuşma geçmişinden son mesajları al
      const messages = ctx.getMessages?.() ?? [];
      const reportText = messages
        .filter((m: ChatMessage) => m.role === 'assistant')
        .map((m: ChatMessage) => typeof m.content === 'string' ? m.content : '')
        .join('\n\n')
        .slice(0, 10000);

      if (!reportText.trim()) {
        return { output: chalk.yellow('⚠ Rapor oluşturmak için önce bir güvenlik taraması yapın.') };
      }

      process.stdout.write(chalk.dim('\n  📄 Rapor oluşturuluyor...\n'));
      const outFile = await exportSecurityReport(reportText, outputDir);
      if (!outFile) return { output: chalk.red('✗ Rapor oluşturulamadı.') };

      const ext = outFile.endsWith('.pdf') ? 'PDF' : 'LaTeX (.tex)';
      return { output: chalk.green(`✓ ${ext} raporu oluşturuldu:\n  ${outFile}`) };
    }
    return { output: chalk.dim('Kullanım: /rapor pdf') };
  },

  apikey: async (_args, ctx) => {
    const API_PROVIDERS: ProviderName[] = ['claude', 'gemini', 'openai', 'openrouter', 'groq'];
    const options = API_PROVIDERS.map(p => {
      const key = ctx.config.providers[p]?.apiKey || process.env[
        p === 'claude' ? 'ANTHROPIC_API_KEY' :
        p === 'gemini' ? 'GEMINI_API_KEY' :
        p === 'openrouter' ? 'OPENROUTER_API_KEY' :
        p === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'
      ];
      const masked = key ? `${key.slice(0, 8)}${'*'.repeat(8)}` : chalk.dim('(kayıtlı değil)');
      return { value: p, label: `${p.padEnd(8)} ${masked}` };
    });
    options.push({ value: 'yeni' as ProviderName, label: chalk.green('+ Yeni API anahtarı ekle') });

    const selected = await select({ message: 'API Anahtarları:', options });
    if (isCancel(selected)) return { output: chalk.gray('İptal edildi.') };

    if (selected === 'yeni' as ProviderName) {
      return COMMANDS.saglayici!('', ctx);
    }

    // Mevcut key yönetimi
    const action = await select({
      message: `${selected} — ne yapmak istersin?`,
      options: [
        { value: 'update', label: 'Anahtarı güncelle' },
        { value: 'delete', label: chalk.red('Anahtarı sil') },
        { value: 'cancel', label: 'İptal' },
      ],
    });
    if (isCancel(action) || action === 'cancel') return { output: chalk.gray('İptal edildi.') };

    if (action === 'delete') {
      const sure = await confirm({ message: `${selected} API anahtarı silinsin mi?` });
      if (isCancel(sure) || !sure) return { output: chalk.gray('İptal edildi.') };
      deleteApiKey(selected as ProviderName);
      return { output: chalk.green(`✓ ${selected} API anahtarı silindi.`) };
    }

    // update
    const newKey = await text({
      message: `Yeni API anahtarı (${selected}):`,
      placeholder: 'API anahtarını buraya yapıştır...',
      validate: (v) => (v ?? '').trim().length < 10 ? 'Geçersiz API anahtarı.' : undefined,
    });
    if (isCancel(newKey)) return { output: chalk.gray('İptal edildi.') };
    saveConfig({
      providers: { [selected]: { apiKey: (newKey as string).trim() } } as SETHConfig['providers'],
    });
    return { output: chalk.green(`✓ ${selected} API anahtarı güncellendi.`) };
  },

  tema: async (_args, _ctx) => {
    const themeNames = Object.keys(THEMES) as ThemeName[];
    const descriptions: Record<string, string> = {
      dark: 'Varsayılan koyu mavi', light: 'Açık tema',
      cyberpunk: 'Matrix / neon', retro: 'Retro turuncu',
      ocean: 'Okyanus mavisi', sunset: 'Gün batımı pembe',
    };
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
  },

  geçmiş: async () => {
    const sessions = listSessions()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 20);

    if (sessions.length === 0) return { output: chalk.gray('Kayıtlı oturum yok.') };

    const options = sessions.map(s => {
      const date = new Date(s.updatedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      return { value: s.id, label: `${chalk.dim(s.id.slice(0, 8))}  ${s.provider}/${s.model}  ${chalk.dim(date)}` };
    });

    const selected = await select({ message: 'Oturum seçin:', options });
    if (isCancel(selected)) return { output: chalk.gray('İptal edildi.') };

    return {
      output: chalk.green(`✓ Yeniden başlatılıyor...`),
      runAsUserMessage: `__RESUME__${selected as string}`,
    };
  },

  cikis: () => ({ shouldExit: true }),

  kullanım: async (_args, ctx) => {
    const { showUsage } = await import('./auth.js');
    await showUsage('local');
    return { output: '' };
  },

  giriş: async () => {
    const { sethLogin } = await import('./auth.js');
    await sethLogin();
    return { output: '' };
  },

  çıkış: async () => {
    const { sethCikis } = await import('./auth.js');
    await sethCikis();
    return { output: '', shouldExit: true };
  },

  yapımcı: () => ({

    output: `
${chalk.bold.red('🐍 SETH v' + VERSION + ' — Strategic Exploitation & Tactical Hybrid')}

${chalk.bold.cyan('👨‍💻 Yapımcı:')} ${chalk.bold('Mustafa Kemal Çıngıl')}

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
  • GitHub: ${chalk.underline('https://github.com/mustafakemal0146')}
  • LinkedIn: ${chalk.underline('https://linkedin.com/in/mustafakemalcingil')}
  • E-posta: ${chalk.underline('ismustafakemal0146@gmail.com')}

${chalk.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

${chalk.red.bold('⚡ SETH')} — Teknoloji ile hayatı kolaylaştıran, etik hacker ruhuyla geliştirilmiş
otonom siber operasyon aracı. Bitlis'ten dünyaya açılan bir yapay zeka projesi.

${chalk.dim('Yanıt süresi: 24 saat içinde • Çalışma dili: Türkçe, İngilizce')}
`,
  }),

  // Geriye uyumluluk için eski komutlar (alias)
  yardim: (...args) => COMMANDS.yardım(...args),
  ozellikler: (...args) => COMMANDS.özellikler(...args),
  saglayici: (...args) => COMMANDS.sağlayıcı(...args),
  saglayicilar: (...args) => COMMANDS.sağlayıcılar(...args),
  araclar: (...args) => COMMANDS.araçlar(...args),
  degistir: (...args) => COMMANDS.değiştir(...args),
  sikistir: (...args) => COMMANDS.sıkıştır(...args),
  repo_ozet: (...args) => COMMANDS.repo_özet(...args),
  nasilcalisir: (...args) => COMMANDS.nasılçalışır(...args),
  gecmis: (...args) => COMMANDS.geçmiş(...args),
  guncelle: (...args) => COMMANDS.güncelle(...args),
  istatistik: (...args) => COMMANDS.istatistikler(...args),
  rapor_pdf: (...args) => COMMANDS.rapor(...args),
  hafiza: (...args) => (COMMANDS as any)['hafıza'](...args),
  'hafiza-temizle': (...args) => (COMMANDS as any)['hafıza-temizle'](...args),
  baglam: (...args) => (COMMANDS as any)['bağlam'](...args),
  gorevler: (...args) => (COMMANDS as any)['görevler'](...args),
};

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
