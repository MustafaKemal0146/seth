/**
 * @fileoverview GitHub releases'den otomatik güncelleme kontrolü.
 */

import { VERSION } from './version.js';

const REPO = 'MustafaKemal0146/seth';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 saat
const CACHE_FILE = '.last-update-check';

/**
 * GitHub releases'den en son sürümü kontrol et.
 * Günde bir kez kontrol eder, cache kullanır.
 */
export async function checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion: string } | null> {
  try {
    // Cache kontrolü
    const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    
    const cacheDir = join(homedir(), '.seth');
    const cachePath = join(cacheDir, CACHE_FILE);
    
    if (existsSync(cachePath)) {
      const lastCheck = parseInt(readFileSync(cachePath, 'utf-8'), 10);
      if (Date.now() - lastCheck < CHECK_INTERVAL_MS) {
        return null; // Henüz kontrol zamanı değil
      }
    }

    // GitHub API'den en son release'i çek
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'seth-cli' },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;

    const data = await res.json() as { tag_name?: string };
    const latestVersion = data.tag_name?.replace(/^v/, '') || '';

    // Cache güncelle
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, Date.now().toString(), 'utf-8');

    // Sürüm karşılaştırması
    if (latestVersion && compareVersions(latestVersion, VERSION) > 0) {
      return { hasUpdate: true, latestVersion };
    }

    return null;
  } catch {
    return null; // Hata durumunda sessizce devam et
  }
}

/**
 * Basit semver karşılaştırması.
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const aNum = aParts[i] || 0;
    const bNum = bParts[i] || 0;
    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
  }
  
  return 0;
}
