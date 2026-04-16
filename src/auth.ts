import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { VERSION } from './version.js';

const CONFIG_DIR = join(homedir(), '.seth');
const TOKEN_FILE = join(CONFIG_DIR, 'token');

export let currentUser: any = null;

/**
 * Check if user is configured (no login required)
 */
export async function checkAuth() {
  return null;
}

/**
 * Setup check - if no config exists, run onboarding
 */
export async function needsSetup(): Promise<boolean> {
  const settingsPath = join(CONFIG_DIR, 'settings.json');
  return !existsSync(settingsPath);
}

/**
 * Get current user info (local only)
 */
export async function getCurrentUser() {
  return { local: true };
}

/**
 * Placeholder functions for compatibility
 */
export async function sethLogin(): Promise<any> {
  console.log(chalk.green('  ✓ SETH zaten yapılandırıldı. Giriş gerekmiyor.'));
  return null;
}

export async function sethCikis() {
  console.log(chalk.green('  ✓ Yerel modda çalışıyorsunuz.'));
}

export async function checkVersion() {
  console.log(chalk.dim(`  SETH v${VERSION}`));
}

export async function showUsage(userId: string) {
  console.log(chalk.bold('\n📊 Kullanım Raporu'));
  console.log(`  Sürüm      : ${chalk.cyan(VERSION)}`);
  console.log(`  Mod        : ${chalk.yellow('Yerel')}`);
  console.log('');
}

export async function trackUsage(userId: string, event: string, metadata: any = {}) {
  // Local usage tracking - no telemetry
}