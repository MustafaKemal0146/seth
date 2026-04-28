/**
 * @fileoverview SETH Sandbox Sistemi — v3.9.5
 * AGPL-3.0
 * AGPL-3.0
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync } from 'fs';
import { join, resolve, sep, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { execSync, spawnSync, exec } from 'child_process';
import { generateId as makeId } from '../utils/id.js';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type SandboxProfile = 'none' | 'tempdir' | 'docker';

export interface SandboxConfig {
  profile: SandboxProfile;
  memoryLimit?: string;    // docker için: "512m", "1g"
  cpuLimit?: string;       // docker için: "0.5", "1"
  timeout?: number;        // ms cinsinden maksimum çalışma süresi
  networkAccess?: boolean;
  allowedPaths?: string[]; // okunabilir ekstra dizinler
}

export interface SandboxResult {
  output: string;
  exitCode: number;
  error?: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const SANDBOX_DIR = join(homedir(), '.seth', 'sandbox');

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stderr.write(`[seth:sandbox] ${msg}\n`);
}

function generateSandboxId(): string {
  return makeId('sbox');
}

// ---------------------------------------------------------------------------
// Temp Directory Sandbox (İzole Klasör)
// ---------------------------------------------------------------------------

export function createTempSandbox(): string {
  const id = generateSandboxId();
  const dir = join(tmpdir(), id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTempSandbox(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

export function executeInTempDir(
  command: string,
  options?: { timeout?: number; cwd?: string },
): SandboxResult {
  const start = Date.now();
  const sandboxDir = options?.cwd || createTempSandbox();
  const isNewDir = !options?.cwd;

  try {
    const output = execSync(command, {
      cwd: sandboxDir,
      timeout: options?.timeout || 30_000,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
    });

    return {
      output: output.trim(),
      exitCode: 0,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      output: e.stdout || '',
      exitCode: e.status || 1,
      error: e.stderr || e.message || String(err),
      duration: Date.now() - start,
    };
  } finally {
    if (isNewDir) {
      cleanupTempSandbox(sandboxDir);
    }
  }
}

// ---------------------------------------------------------------------------
// Docker Sandbox (Linux için)
// ---------------------------------------------------------------------------

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { encoding: 'utf-8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function runInDocker(
  command: string,
  config?: Partial<SandboxConfig>,
): SandboxResult {
  const start = Date.now();

  if (!isDockerAvailable()) {
    return {
      output: '',
      exitCode: 1,
      error: 'Docker kullanılamıyor',
      duration: Date.now() - start,
    };
  }

  const image = 'node:20-alpine';
  const memoryLimit = config?.memoryLimit || '512m';
  const cpuLimit = config?.cpuLimit || '1';
  const timeout = config?.timeout || 60_000;

  const dockerArgs: string[] = ['run', '--rm'];
  if (!config?.networkAccess) dockerArgs.push('--network', 'none');
  dockerArgs.push(`--memory=${memoryLimit}`, `--cpus=${cpuLimit}`, '-i', image, 'sh', '-c', command);

  const result = spawnSync('docker', dockerArgs, {
    timeout,
    encoding: 'utf-8',
    maxBuffer: 5 * 1024 * 1024,
  });

  if (result.error) {
    return {
      output: result.stdout?.trim() || '',
      exitCode: 1,
      error: result.error.message,
      duration: Date.now() - start,
    };
  }

  return {
    output: (result.stdout || '').trim(),
    exitCode: result.status ?? 0,
    error: result.status && result.status !== 0 ? (result.stderr || '').trim() : undefined,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Asenkron Sandbox Çalıştırma
// ---------------------------------------------------------------------------

export function executeSandboxAsync(
  command: string,
  sandboxDir: string,
  options?: { timeout?: number; onData?: (data: string) => void },
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    
    const child = exec(command, {
      cwd: sandboxDir,
      timeout: options?.timeout || 30_000,
      maxBuffer: 5 * 1024 * 1024,
    }, (err: { code?: number; message?: string } | null, stdout, stderr) => {
      resolve({
        output: stdout?.trim() || '',
        exitCode: err?.code || 0,
        error: stderr || err?.message,
        duration: Date.now() - start,
      });
    });

    if (options?.onData && child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        options.onData?.(data.toString());
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Dosya İşlemleri (Sandbox içinde)
// ---------------------------------------------------------------------------

const MAX_WALK_DEPTH = 32;

/**
 * Verilen path'in sandbox kökü altında kaldığını symlink takibiyle birlikte doğrular.
 * Dosya/klasör yoksa en yakın mevcut atayı çözüp doğrular.
 */
function ensureWithinSandbox(sandboxDir: string, fullPath: string, label: string): string {
  const resolvedSandbox = realpathSync(resolve(sandboxDir));

  // En yakın mevcut atayı bul (yeni dosya yazılıyorsa parent zinciri yukarı çık)
  let probe = fullPath;
  while (!existsSync(probe) && probe !== dirname(probe)) {
    probe = dirname(probe);
  }
  const realProbe = realpathSync(probe);
  if (realProbe !== resolvedSandbox && !realProbe.startsWith(resolvedSandbox + sep)) {
    throw new Error(`Güvenlik ihlali: Sandbox dışına erişim engellendi (${label})`);
  }
  return resolvedSandbox;
}

export function sandboxWriteFile(sandboxDir: string, filePath: string, content: string): void {
  const fullPath = resolve(sandboxDir, filePath);
  const resolvedSandbox = resolve(sandboxDir);

  if (!fullPath.startsWith(resolvedSandbox + sep) && fullPath !== resolvedSandbox) {
    throw new Error(`Güvenlik ihlali: Sandbox dışına erişim engellendi (${filePath})`);
  }

  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  ensureWithinSandbox(sandboxDir, fullPath, filePath);
  writeFileSync(fullPath, content, 'utf-8');
}

export function sandboxReadFile(sandboxDir: string, filePath: string): string {
  const fullPath = resolve(sandboxDir, filePath);
  const resolvedSandbox = resolve(sandboxDir);

  if (!fullPath.startsWith(resolvedSandbox + sep) && fullPath !== resolvedSandbox) {
    throw new Error(`Güvenlik ihlali: Sandbox dışına erişim engellendi (${filePath})`);
  }

  if (!existsSync(fullPath)) {
    throw new Error(`Dosya bulunamadı: ${filePath}`);
  }
  ensureWithinSandbox(sandboxDir, fullPath, filePath);
  return readFileSync(fullPath, 'utf-8');
}

export function sandboxListFiles(sandboxDir: string): string[] {
  function walk(dir: string, depth: number): string[] {
    if (depth > MAX_WALK_DEPTH) return [];
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          files.push(...walk(full, depth + 1));
        } else if (entry.isFile()) {
          files.push(full.replace(sandboxDir + sep, ''));
        }
      }
    } catch (err) {
      if (process.env.SETH_DEBUG) console.error('[seth:sandbox] walk error', err);
    }
    return files;
  }

  if (!existsSync(sandboxDir)) return [];
  return walk(sandboxDir, 0);
}

// ---------------------------------------------------------------------------
// İnisiyalizasyon
// ---------------------------------------------------------------------------

export function initSandbox(): void {
  if (!existsSync(SANDBOX_DIR)) {
    mkdirSync(SANDBOX_DIR, { recursive: true });
  }
  log(`Sandbox hazır: ${SANDBOX_DIR}`);
}
