import { intro, outro, select, text, isCancel, spinner } from '@clack/prompts';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import chalk from 'chalk';
import { getSettingsPath, getConfigDir } from './config/settings.js';
import { sethLog } from './welcome.js';
import type { ProviderName } from './types.js';

export async function runOnboardingIfNeeded(): Promise<void> {
  const settingsPath = getSettingsPath();
  if (existsSync(settingsPath)) {
    return; // Zaten yapılandırılmış
  }

  // Create dir if needed
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  intro(chalk.bgRed.white.bold(' ↯ SETH — İLK KURULUM ↯ '));
  process.stdout.write(chalk.dim('  Yapılandırma eksik. Sistem hazırlanıyor.\n\n'));

  const provider = await select({
    message: 'Ana yapay zeka sağlayıcınızı (Provider) seçin:',
    options: [
      { value: 'ollama', label: 'Ollama (Yerel, Ücretsiz, Gizli)', hint: 'Önerilen: qwen2.5-coder:7b' },
      { value: 'lmstudio', label: 'LM Studio (Yerel)', hint: 'Önerilen: local-model' },
      { value: 'groq', label: 'Groq (Hızlı, Ücretsiz Tier)', hint: 'Önerilen: llama-3.3-70b' },
      { value: 'deepseek', label: 'DeepSeek (Ucuz, Güçlü)', hint: 'Önerilen: deepseek-chat' },
      { value: 'mistral', label: 'Mistral AI', hint: 'Önerilen: mistral-large-latest' },
      { value: 'xai', label: 'xAI (Grok)', hint: 'Önerilen: grok-3-latest' },
      { value: 'openrouter', label: 'OpenRouter (300+ Model)', hint: 'Önerilen: openai/gpt-4o' },
      { value: 'claude', label: 'Anthropic Claude', hint: 'Önerilen: claude-sonnet-4' },
      { value: 'openai', label: 'OpenAI (ChatGPT)', hint: 'Önerilen: gpt-4o' },
      { value: 'gemini', label: 'Google Gemini', hint: 'Önerilen: gemini-2.5-pro' },
    ],
  });

  if (isCancel(provider)) {
    outro(chalk.yellow('Kurulum iptal edildi. Varsayılan ayarlar (Ollama) kullanılacak.'));
    return;
  }

  const pName = provider as ProviderName;
  let defaultModel = '';
  const partialConfig: any = { defaultProvider: pName, providers: { [pName]: {} } };

  if (pName === 'ollama') {
    const s = spinner();
    s.start('SETH: Yerel Ollama modelleri taranıyor...');
    try {
      const res = await fetch('http://localhost:11434/api/tags').catch(() => null);
      if (res && res.ok) {
        const data = await res.json() as any;
        const models: string[] = data.models?.map((m: any) => m.name) || [];
        s.stop('Bulundu.');

        if (models.length > 0) {
          const m = await select({
            message: 'Ollama için bir model seçin:',
            options: models.map(m => ({ value: m, label: m })),
          });
          if (isCancel(m)) process.exit(0);
          defaultModel = m as string;
        } else {
          console.log(chalk.yellow('Ollama çalışıyor ama yüklü model bulunamadı (örn. ollama run qwen2.5-coder:7b).'));
          defaultModel = 'qwen2.5-coder:7b';
        }
      } else {
        s.stop('Ollama bağlantısı kurulamadı.');
        console.log(chalk.red('Lütfen arka planda Ollama uygulamasını çalıştırdığınızdan emin olun.'));
        defaultModel = 'qwen2.5-coder:7b';
      }
    } catch {
      s.stop('Ollama hatası.');
      defaultModel = 'qwen2.5-coder:7b';
    }
  } else {
    // Cloud / local models
    const needsApiKey = !['lmstudio'].includes(pName);
    if (needsApiKey) {
      const apiKey = await text({
        message: `${pName.toUpperCase()} API anahtarınızı girin (Boş bırakabilir ve .env ile verebilirsiniz):`,
        placeholder: 'sk-...',
      });
      if (isCancel(apiKey)) process.exit(0);
      if (apiKey) partialConfig.providers[pName].apiKey = apiKey as string;
    }

    if (pName === 'lmstudio') {
      // LM Studio model listesi çek
      const s = spinner();
      s.start('LM Studio modelleri taranıyor...');
      try {
        const res = await fetch('http://localhost:1234/v1/models').catch(() => null);
        if (res && res.ok) {
          const data = await res.json() as { data?: { id: string }[] };
          const models = data.data?.map(m => m.id) ?? [];
          s.stop('Bulundu.');
          if (models.length > 0) {
            const m = await select({ message: 'LM Studio modeli seçin:', options: models.map(m => ({ value: m, label: m })) });
            if (isCancel(m)) process.exit(0);
            defaultModel = m as string;
          } else { defaultModel = 'local-model'; }
        } else { s.stop('LM Studio bağlantısı kurulamadı.'); defaultModel = 'local-model'; }
      } catch { s.stop('LM Studio hatası.'); defaultModel = 'local-model'; }
    } else if (pName === 'claude') defaultModel = 'claude-sonnet-4-20250514';
    else if (pName === 'openai') defaultModel = 'gpt-4o';
    else if (pName === 'gemini') defaultModel = 'gemini-2.5-pro';
    else if (pName === 'groq') defaultModel = 'llama-3.3-70b-versatile';
    else if (pName === 'deepseek') defaultModel = 'deepseek-chat';
    else if (pName === 'mistral') defaultModel = 'mistral-large-latest';
    else if (pName === 'xai') defaultModel = 'grok-3-latest';
    else if (pName === 'openrouter') defaultModel = 'openai/gpt-4o';
  }

  partialConfig.defaultModel = defaultModel;
  partialConfig.providers[pName].model = defaultModel;

  sethLog('Yapılandırma kalıcı hale getirme');
  writeFileSync(settingsPath, JSON.stringify(partialConfig, null, 2), 'utf-8');

  outro(chalk.red.bold(`SETH kurulumu tamamlandı. Sistem aktif. (${pName} / ${defaultModel})`));
}
