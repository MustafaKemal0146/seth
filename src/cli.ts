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
import chalk from 'chalk';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

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
        // Doğrulama
        const validProviders: ProviderName[] = ['claude', 'gemini', 'openai', 'ollama', 'groq', 'deepseek', 'mistral', 'xai', 'lmstudio', 'openrouter'];
        if (!validProviders.includes(providerArg)) {
          console.error(chalk.red(`Hata: Geçersiz provider "${providerArg}". Geçerli olanlar: ${validProviders.join(', ')}`));
          process.exit(1);
        }
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
    await playIntro(cfg.defaultProvider, resolveModel(cfg.defaultProvider, cfg, modelArg), '');

    const { startModernUi } = await import('./ui/AppContainer.js');
    await startModernUi(configOverrides);
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
    --provider <claude|gemini|openai|ollama|groq|deepseek|mistral|xai|lmstudio|openrouter>  Sağlayıcı belirle
    --model <isim>                      Model belirle
    --auto, -y                          Araç onaylarını otomatik geç
    --no-tools                          Araçları devre dışı bırak
    --debug                             Hata ayıklama çıktısı
    -v, --version                       Sürümü göster
    -h, --help                          Bu yardımı göster

  REPL Komutları:
    /degistir                           Etkileşimli ayar menüsü
    /modeller                           Modelleri listele ve seç
    /saglayici <isim>                   Sağlayıcı değiştir (10 provider)
    /model <isim>                       Model değiştir
    /araclar <acik|kapali>              Araçları aç/kapat
    /ajan <acik|kapali>                 Ajan (çok-tur) modunu aç/kapat
    /context [250k|500k|1m|2m]          Oturum token bütçesi
    /kanal [a|b|durum]                  Çift hat (paralel sohbet)
    /cd <dizin>                         Çalışma dizinini değiştir
    /temizle [tum]                      Geçmiş (tum = her iki hat)
    /sikistir                           Geçmişi sıkıştır (token tasarrufu)
    /geri                               Son mesajı geri al
    /kaydet [md|html|txt] [dosya]       Konuşmayı dosyaya kaydet
    /export [json|md|html] [dosya]      Oturumu dışa aktar
    /oturum-export [dosya]              Oturumu JSON olarak kaydet
    /oturum-import <dosya>              Önceki oturumu yükle
    /hafiza                             Kalıcı bellek yönetimi
    /bellek                             Görev listesi + oturum özeti
    /istatistikler                      Oturum istatistikleri
    /doktor                             Ortam sağlığı + araç kontrolü
    /guncelle                           Yeni sürüm kontrolü
    /worktree [list|add|remove]         Git worktree yönetimi
    /ajan basla <gorev>                 Alt ajan başlat
    /mcp-kesif                          MCP server keşfi
    /yardim                             Komutları listele
    /cikis                              Çıkış

  Konfigürasyon:
    Ayarlar : ~/.seth/settings.json
    MCP     : ~/.seth/mcp.json (isteğe bağlı; Model Context Protocol sunucuları)
    Geçmiş  : ~/.seth/sessions/

  Ortam Değişkenleri:
    ANTHROPIC_API_KEY                   Claude için
    OPENAI_API_KEY                      OpenAI için
    GEMINI_API_KEY                      Gemini için
    GROQ_API_KEY                        Groq için
    DEEPSEEK_API_KEY                    DeepSeek için
    MISTRAL_API_KEY                     Mistral için
    XAI_API_KEY                         xAI (Grok) için
    OPENROUTER_API_KEY                  OpenRouter için
    OLLAMA_BASE_URL                     Ollama (varsayılan: http://localhost:11434)
    LMSTUDIO_BASE_URL                   LM Studio (varsayılan: http://localhost:1234)
`);
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
