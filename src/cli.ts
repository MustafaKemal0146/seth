#!/usr/bin/env node

/**
 * @fileoverview SETH CLI entry point.
 *
 * Usage:
 *   seth                           # Interactive REPL
 *   seth -p "your question"        # Headless mode
 *   seth --provider claude         # Start with specific provider
 *   seth --model gpt-4o            # Start with specific model
 *   seth --debug                   # Enable debug output
 */

import type { ProviderName, SETHConfig } from './types.js';
import { VERSION } from './version.js';
import { checkAuth, sethLogin, sethCikis, showUsage, trackUsage } from './auth.js';
import chalk from 'chalk';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 1. Türkçe Giriş/Çıkış Komutları
  if (args[0] === 'giriş' || args[0] === 'giris' || args[0] === 'login') {
    await sethLogin();
    process.exit(0);
  }
  if (args[0] === 'çıkış' || args[0] === 'cikis' || args[0] === 'logout') {
    await sethCikis();
    process.exit(0);
  }

  // 2. Oturum Kontrolü
  const user = await checkAuth();

  // Parse arguments
  let prompt: string | undefined;
  let providerArg: ProviderName | undefined;
  let modelArg: string | undefined;
  let debug = false;
  let noTools = false;
  let autoApprove = false;
  let resumeId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-p':
      case '--prompt':
        prompt = args[++i];
        break;
      case '--provider':
        providerArg = args[++i] as ProviderName;
        break;
      case '--model':
        modelArg = args[++i];
        break;
      case '--debug':
        debug = true;
        break;
      case '--no-tools':
        noTools = true;
        break;
      case '-y':
      case '--auto':
        autoApprove = true;
        break;
      case '--devam':
      case '--resume':
        resumeId = args[++i];
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '-v':
      case '--version':
        console.log(`seth v${VERSION}`);
        process.exit(0);
        break;
      default:
        // If no flag, treat as prompt
        if (!args[i].startsWith('-') && !prompt) {
          prompt = args[i];
        }
    }
  }

  const configOverrides: Partial<SETHConfig> = { 
    debug,
    autoApprove 
  };
  if (providerArg) (configOverrides as Record<string, unknown>).defaultProvider = providerArg;
  if (modelArg) (configOverrides as Record<string, unknown>).defaultModel = modelArg;

  if (prompt) {
    // Headless mode
    const { runHeadless } = await import('./headless.js');
    await runHeadless(prompt, { provider: providerArg, model: modelArg, noTools, debug, autoApprove });
  } else {
    // Interactive REPL
    const { runOnboardingIfNeeded } = await import('./onboarding.js');
    await runOnboardingIfNeeded();

    const { loadConfig } = await import('./config/settings.js');
    const { resolveModel } = await import('./config/settings.js');
    const cfg = loadConfig(configOverrides);
    const { playIntro } = await import('./intro.js');
    const userEmail = ((user as any)?.email as string | undefined) ?? '';
    await playIntro(cfg.defaultProvider, resolveModel(cfg.defaultProvider, cfg, modelArg), userEmail);

    const { startRepl } = await import('./repl.js');
    await startRepl(configOverrides, true, resumeId, userEmail);
  }
}

function printHelp(): void {
  console.log(`
  SETH v${VERSION} — Terminalinizdeki yapay zeka kodlama ajanı

  Kullanım:
    seth                             İnteraktif REPL modunu başlat
    seth -p "görev"                  Headless (tek seferlik) modda çalıştır
    seth --auto -p "görev"           Otonom (onaysız) headless mod

  Bayraklar:
    -p, --prompt <metin>                Tek seferlik görev (headless)
    --provider <claude|gemini|openai|ollama>  Sağlayıcı belirle
    --model <isim>                      Model belirle
    --auto, -y                          Araç onaylarını otomatik geç
    --no-tools                          Araçları devre dışı bırak
    --debug                             Hata ayıklama çıktısı
    -v, --version                       Sürümü göster
    -h, --help                          Bu yardımı göster

  REPL Komutları:
    /degistir                           Etkileşimli ayar menüsü
    /modeller                           Modelleri listele ve seç
    /saglayici <isim>                   Sağlayıcı değiştir
    /model <isim>                       Model değiştir
    /araclar <acik|kapali>              Araçları aç/kapat
    /ajan <acik|kapali>                 Ajan (çok-tur) modunu aç/kapat
    /context [250k|500k|1m|1.5m|2m]     Oturum token bütçesi
    /kanal [a|b|durum]                  Çift hat (paralel sohbet)
    /cd <dizin>                         Çalışma dizinini değiştir
    /temizle [tum]                      Geçmiş (tum = her iki hat)
    /sikistir                           Geçmişi sıkıştır (token tasarrufu)
    /geri                               Son mesajı geri al
    /kaydet [dosya]                     Konuşmayı dosyaya kaydet
    /bellek                             Görev listesi + oturum özeti
    /istatistikler                      Oturum istatistikleri
    /yardim                             Komutları listele
    /nasilcalisir                       Kısa tur (yazma animasyonu)
    /cikis                              Çıkış

  Konfigürasyon:
    Ayarlar : ~/.seth/settings.json
    MCP     : ~/.seth/mcp.json (isteğe bağlı; Model Context Protocol sunucuları)
    Geçmiş  : ~/.seth/sessions/

  Ortam Değişkenleri:
    ANTHROPIC_API_KEY                   Claude için
    OPENAI_API_KEY                      OpenAI için
    GEMINI_API_KEY                      Gemini için
    OLLAMA_BASE_URL                     Ollama (varsayılan: http://localhost:11434)
`);
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
