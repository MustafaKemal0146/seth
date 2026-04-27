#!/usr/bin/env node

/**
 * @fileoverview SETH CLI entry point.
 */

import type { ProviderName, SETHConfig } from './types.js';
import { VERSION } from './version.js';
import chalk from 'chalk';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

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
      case '-y':
      case '--auto':
        autoApprove = true;
        break;
      case '--resume':
        resumeId = args[++i];
        break;
      case '-v':
      case '--version':
        console.log(`seth v${VERSION}`);
        process.exit(0);
        break;
      case '-u':
      case '--update':
        (async () => {
          const { performSelfUpdate } = await import('./update-check.js');
          console.log(chalk.cyan('🔄 SETH Self-Update başlatılıyor...\n'));
          const result = await performSelfUpdate((msg) => console.log(chalk.dim(`  ${msg}`)));
          console.log('');
          if (result.success && result.method !== 'none') {
            console.log(chalk.green(`✅ ${result.message.split('\n')[0]}`));
            console.log(chalk.cyan(`  v${result.previousVersion} → v${result.newVersion}`));
          } else {
            console.log(result.success ? chalk.green(result.message) : chalk.red(result.message));
          }
        })().catch((err) => {
          console.error(chalk.red(`❌ Güncelleme hatası: ${err.message}`));
          process.exit(1);
        });
        break;
    }
  }

  const configOverrides: Partial<SETHConfig> = { debug, autoApprove };
  if (providerArg) (configOverrides as any).defaultProvider = providerArg;
  if (modelArg) (configOverrides as any).defaultModel = modelArg;

  // v3.9.5: Yeni modülleri başlat
  const { loadConfig } = await import('./config/settings.js');
  const cfg = loadConfig(configOverrides);
  const { initNewModules } = await import('./init-modules.js');
  await initNewModules(cfg);

  if (prompt) {
    const { runHeadless } = await import('./headless.js');
    await runHeadless(prompt, { provider: providerArg, model: modelArg, noTools, debug, autoApprove });
  } else {
    const { runOnboardingIfNeeded } = await import('./onboarding.js');
    await runOnboardingIfNeeded();

    const { resolveModel } = await import('./config/settings.js');
    
    const { playIntro } = await import('./intro.js');
    await playIntro(cfg.defaultProvider, resolveModel(cfg.defaultProvider, cfg, modelArg), '');

    // Ink (React) UI yerine eski stabil REPL'e geri dönüyoruz
    const { startRepl } = await import('./repl.js');
    await startRepl(configOverrides, true, resumeId, '');
  }
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
