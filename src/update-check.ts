/**
 * @fileoverview GitHub releases'den otomatik güncelleme kontrolü ve self-update.
 */

import { VERSION } from './version.js';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const REPO = 'MustafaKemal0146/seth';
const REPO_URL = 'https://github.com/MustafaKemal0146/seth';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 saat
const CACHE_FILE = '.last-update-check';

/** Self-update sonucu */
export interface UpdateResult {
  success: boolean;
  previousVersion: string;
  newVersion: string;
  method: 'git' | 'npm' | 'manual' | 'none';
  message: string;
}

/**
 * Proje kök dizinini bul (package.json'un olduğu yer).
 * SETH'in dist/ ya da src/ içinden çağrıldığı durumları ele alır.
 */
function findProjectRoot(): string | null {
  try {
    // Çalışan modülün yolu
    let current = dirname(fileURLToPath(import.meta.url));
    
    // dist/ içindeysek bir üst, src/ içindeysek bir üst
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(current, 'package.json');
      if (existsSync(pkgPath)) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break; // root'a ulaştık
      current = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Kurulum tipini tespit et.
 */
function detectInstallType(projectRoot: string): 'git' | 'npm' | 'unknown' {
  try {
    // Git clone kontrolü - .git klasörü var mı?
    if (existsSync(join(projectRoot, '.git'))) {
      return 'git';
    }
    
    // npm global install kontrolü
    const sethBin = execSync('which seth 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
    if (sethBin && sethBin.includes('node_modules')) {
      return 'npm';
    }
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * GitHub API'den son release tag'ini al.
 */
async function getLatestVersionFromGitHub(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'seth-cli' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name?: string };
    return data.tag_name?.replace(/^v/, '') || null;
  } catch {
    return null;
  }
}

/**
 * GitHub'ın varsayılan branch'ini al (main/master).
 */
async function getDefaultBranch(): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { 'User-Agent': 'seth-cli' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json() as { default_branch?: string };
      if (data.default_branch) return data.default_branch;
    }
  } catch { /* fallback */ }
  return 'main';
}

/**
 * KENDİ KENDİNE GÜNCELLEME 🔄
 * 
 * SETH bulunduğu ortama göre kendini günceller:
 * - Git clone: git pull + rebuild
 * - npm global: npm install -g
 * 
 * @param onProgress İlerleme callback'i (opsiyonel)
 */
export async function performSelfUpdate(
  onProgress?: (message: string) => void
): Promise<UpdateResult> {
  const progress = (msg: string) => { if (onProgress) onProgress(msg); };
  
  const previousVersion = VERSION;
  const projectRoot = findProjectRoot();
  
  if (!projectRoot) {
    return {
      success: false,
      previousVersion,
      newVersion: previousVersion,
      method: 'none',
      message: 'Proje kök dizini bulunamadı. Elle güncelleme yapmalısın:\n  npm install -g seth',
    };
  }

  const installType = detectInstallType(projectRoot);
  
  // GitHub'dan son sürümü al
  progress('🔍 GitHub kontrol ediliyor...');
  const latestVersion = await getLatestVersionFromGitHub();
  
  if (!latestVersion) {
    return {
      success: false,
      previousVersion,
      newVersion: previousVersion,
      method: 'none',
      message: 'GitHub\'a bağlanılamadı. İnternet bağlantını kontrol et.',
    };
  }

  // Sürüm karşılaştırması
  const check = compareVersions(latestVersion, previousVersion);
  if (check <= 0) {
    return {
      success: true,
      previousVersion,
      newVersion: previousVersion,
      method: 'none',
      message: `✅ Zaten en güncel sürümdesin (v${previousVersion}).`,
    };
  }

  // === GIT MODE ===
  if (installType === 'git') {
    progress(`⬇️ v${latestVersion} indiriliyor (git pull)...`);
    
    try {
      // Proje root'unda çalış
      process.chdir(projectRoot);
      
      // Önce fetch yap
      execSync('git fetch origin', { 
        encoding: 'utf-8', 
        timeout: 30000,
        stdio: onProgress ? 'pipe' : 'ignore',
      });
      
      // Varsayılan branch'i bul
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      
      // Uzak branch ile karşılaştır
      const status = execSync(`git rev-list HEAD..origin/${branch} --count`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      
      if (status === '0') {
        return {
          success: true,
          previousVersion,
          newVersion: previousVersion,
          method: 'none',
          message: `✅ Zaten en güncel sürümdesin (v${previousVersion}).`,
        };
      }
      
      progress(`📦 Güncelleme yapılıyor (pull)...`);
      
      // Yerel değişiklikleri stash'le (varsa)
      const hasChanges = execSync('git status --porcelain', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      
      let stashed = false;
      if (hasChanges) {
        execSync('git stash push -m "self-update: local changes stashed"', {
          encoding: 'utf-8', timeout: 10000,
        });
        stashed = true;
      }
      
      // Pull
      execSync(`git pull origin ${branch}`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: 'pipe',
      });
      
      // Stash pop (daha önce stashed varsa)
      if (stashed) {
        try {
          execSync('git stash pop', { encoding: 'utf-8', timeout: 10000 });
        } catch {
          progress('⚠️  Stash geri alınamadı, elle kontrol et: git stash pop');
        }
      }
      
      // Build
      progress('🔨 Build yapılıyor...');
      execSync('npm run build', {
        encoding: 'utf-8',
        timeout: 60000,
        stdio: 'pipe',
      });
      
      // Yeni versiyonu oku
      const newVer = readVersionFromDist();
      
      return {
        success: true,
        previousVersion,
        newVersion: newVer || latestVersion,
        method: 'git',
        message: [
          `✅ SETH başarıyla güncellendi!`,
          `  v${previousVersion} → v${newVer || latestVersion}`,
          `  🔄 SETH'i yeniden başlat (Ctrl+C) — yeni sürüm aktif!`,
        ].join('\n'),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        previousVersion,
        newVersion: previousVersion,
        method: 'git',
        message: [
          `❌ Git güncellemesi başarısız: ${errMsg}`,
          ``,
          `Elle güncelleme:`,
          `  cd ${projectRoot}`,
          `  git pull origin main`,
          `  npm run build`,
        ].join('\n'),
      };
    }
  }
  
  // === NPM MODE ===
  if (installType === 'npm') {
    progress(`⬇️ v${latestVersion} indiriliyor (npm)...`);
    
    try {
      execSync(`npm install -g ${REPO_URL}`, {
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'pipe',
      });
      
      return {
        success: true,
        previousVersion,
        newVersion: latestVersion,
        method: 'npm',
        message: [
          `✅ SETH başarıyla güncellendi!`,
          `  v${previousVersion} → v${latestVersion}`,
          `  🔄 SETH'i yeniden başlat — yeni sürüm aktif!`,
        ].join('\n'),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        previousVersion,
        newVersion: previousVersion,
        method: 'npm',
        message: [
          `❌ npm güncellemesi başarısız: ${errMsg}`,
          ``,
          `Elle güncelleme:`,
          `  npm install -g ${REPO_URL}`,
        ].join('\n'),
      };
    }
  }
  
  // === UNKNOWN MODE ===
  return {
    success: false,
    previousVersion,
    newVersion: previousVersion,
    method: 'manual',
    message: [
      `⬆️ Yeni sürüm: v${latestVersion}`,
      ``,
      `Kurulum tipin tespit edilemedi. Elle güncelle:`,
      `  1. npm install -g ${REPO_URL}`,
      `  ya da`,
      `  2. git clone ${REPO_URL}.git && cd seth && npm run build`,
    ].join('\n'),
  };
}

/**
 * Build edilmiş dist'ten versiyonu oku.
 */
function readVersionFromDist(): string | null {
  try {
    const projectRoot = findProjectRoot();
    if (!projectRoot) return null;
    const versionPath = join(projectRoot, 'dist', 'version.js');
    if (!existsSync(versionPath)) return null;
    const content = readFileSync(versionPath, 'utf-8');
    const match = content.match(/['"](\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)['"]/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

/**
 * GitHub releases'den en son sürümü kontrol et.
 * Günde bir kez kontrol eder, cache kullanır.
 */
export async function checkForUpdates(): Promise<{ hasUpdate: boolean; latestVersion: string } | null> {
  try {
    const cacheDir = join(homedir(), '.seth');
    const cachePath = join(cacheDir, CACHE_FILE);
    
    if (existsSync(cachePath)) {
      const lastCheck = parseInt(readFileSync(cachePath, 'utf-8'), 10);
      if (Date.now() - lastCheck < CHECK_INTERVAL_MS) {
        return null; // Henüz kontrol zamanı değil
      }
    }

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

    if (latestVersion && compareVersions(latestVersion, VERSION) > 0) {
      return { hasUpdate: true, latestVersion };
    }

    return null;
  } catch {
    return null;
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
