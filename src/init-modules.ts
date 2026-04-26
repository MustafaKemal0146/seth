/**
 * @fileoverview SETH v3.9.5 — Tüm yeni modüllerin inisiyalizasyonu.
 * AGPL-3.0
 */

import type { SETHConfig } from './types.js';

export async function initNewModules(config: SETHConfig): Promise<void> {
  const { initPluginSystem } = await import('./plugin/index.js');
  const { initTaskSystem } = await import('./tasks/index.js');
  const { initSandbox } = await import('./sandbox/index.js');
  const { initContextEngine } = await import('./context-engine/index.js');
  const { initSecurity } = await import('./security/index.js');
  const { initAutoReply } = await import('./auto-reply/index.js');
  const { initFlows } = await import('./flows/index.js');

  // Sıralı başlatma
  initSecurity(config);
  initTaskSystem();
  initSandbox();
  initContextEngine();
  initAutoReply();
  initFlows();

  // Plugin sistemi registry'de ayrıca başlatılıyor, burada sadece dizin kontrolü
  const { getPluginDir } = await import('./plugin/index.js');
  getPluginDir();
}
