/**
 * @fileoverview SETH Plugin Sistemi — v3.9.5
 * AGPL-3.0
 * AGPL-3.0
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, watch } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import type { ToolDefinition, SETHConfig, SecurityProfile } from '../types.js';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** Plugin adı — benzersiz olmalı */
  name: string;
  /** Plugin versiyonu (semver) */
  version: string;
  /** Açıklama */
  description?: string;
  /** Ana giriş dosyası (örn: main.js) */
  main: string;
  /** İzin talepleri */
  permissions: PluginPermission[];
  /** SHA256 hash (güvenlik) */
  sha256: string;
  /** Yazar bilgisi */
  author?: string;
  /** Plugin tipi */
  type?: 'tool' | 'hook' | 'provider';
}

export type PluginPermission = 'read_fs' | 'write_fs' | 'network' | 'exec' | 'audio' | 'video';

export interface PluginRecord {
  manifest: PluginManifest;
  dir: string;
  enabled: boolean;
  loadError?: string;
  loadedAt?: Date;
}

export interface PluginRegistryState {
  plugins: Map<string, PluginRecord>;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const PLUGIN_DIR = join(homedir(), '.seth', 'plugins');
const REGISTRY_FILE = join(PLUGIN_DIR, 'registry.json');
const ALL_PERMISSIONS: Set<PluginPermission> = new Set(['read_fs', 'write_fs', 'network', 'exec', 'audio', 'video']);

const PROFILE_PERMISSIONS: Record<SecurityProfile, Set<PluginPermission>> = {
  safe: new Set(['read_fs']),
  standard: new Set(['read_fs', 'write_fs']),
  pentest: new Set(['read_fs', 'write_fs', 'network', 'exec']),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let registry: PluginRegistryState | null = null;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function log(msg: string): void {
  process.stderr.write(`[seth:plugin] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Plugin Registry Yönetimi
// ---------------------------------------------------------------------------

export function getPluginDir(): string {
  if (!existsSync(PLUGIN_DIR)) {
    mkdirSync(PLUGIN_DIR, { recursive: true });
  }
  return PLUGIN_DIR;
}

export function getRegistryState(): PluginRegistryState {
  if (registry) return registry;
  registry = { plugins: new Map() };
  
  if (existsSync(REGISTRY_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
      if (Array.isArray(raw.plugins)) {
        for (const p of raw.plugins) {
          registry.plugins.set(p.name, p);
        }
      }
    } catch { /* ignore */ }
  }
  
  return registry;
}

function saveRegistryState(): void {
  if (!registry) return;
  const data = {
    plugins: Array.from(registry.plugins.values()).map(p => ({
      ...p,
      loadedAt: p.loadedAt?.toISOString(),
    })),
  };
  writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Manifest Okuma
// ---------------------------------------------------------------------------

function parseManifest(manifestPath: string): PluginManifest {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<PluginManifest>;
  
  if (!raw.name || typeof raw.name !== 'string') throw new Error('manifest.name zorunlu');
  if (!raw.main || typeof raw.main !== 'string') throw new Error('manifest.main zorunlu');
  if (!Array.isArray(raw.permissions)) throw new Error('manifest.permissions dizi olmalı');
  if (!raw.sha256 || typeof raw.sha256 !== 'string') throw new Error('manifest.sha256 zorunlu');
  
  const invalidPerm = raw.permissions.find(p => !ALL_PERMISSIONS.has(p as PluginPermission));
  if (invalidPerm) throw new Error(`Geçersiz izin: ${invalidPerm}`);
  
  return {
    name: raw.name,
    version: raw.version || '1.0.0',
    description: raw.description || '',
    main: raw.main,
    permissions: raw.permissions as PluginPermission[],
    sha256: raw.sha256.toLowerCase(),
    author: raw.author,
    type: raw.type || 'tool',
  };
}

// ---------------------------------------------------------------------------
// Plugin Keşfi
// ---------------------------------------------------------------------------

export function discoverPlugins(): string[] {
  const dir = getPluginDir();
  return readdirSync(dir)
    .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
    .sort();
}

// ---------------------------------------------------------------------------
// Plugin Yükleme
// ---------------------------------------------------------------------------

export async function loadPlugin(
  fileName: string,
  config?: SETHConfig,
): Promise<ToolDefinition | null> {
  const pluginDir = getPluginDir();
  const pluginPath = join(pluginDir, fileName);
  const baseName = fileName.replace(/\.(js|mjs)$/, '');
  const manifestPath = join(pluginDir, `${baseName}.manifest.json`);

  if (!existsSync(manifestPath)) {
    log(`${fileName} — manifest dosyası yok (${baseName}.manifest.json)`);
    return null;
  }

  let manifest: PluginManifest;
  try {
    manifest = parseManifest(manifestPath);
  } catch (err) {
    log(`${fileName} — manifest geçersiz: ${err}`);
    return null;
  }

  if (manifest.main !== fileName) {
    log(`${fileName} — manifest.main eşleşmiyor (${manifest.main})`);
    return null;
  }

  // Güvenlik profili kontrolü
  const profile = config?.tools?.securityProfile ?? 'standard';
  const allowedPerms = PROFILE_PERMISSIONS[profile];
  const disallowed = manifest.permissions.find(p => !allowedPerms.has(p));
  if (disallowed) {
    log(`${fileName} — "${profile}" profilinde "${disallowed}" izni yok`);
    return null;
  }

  // SHA256 doğrulama
  const actualHash = sha256File(pluginPath);
  if (actualHash !== manifest.sha256) {
    log(`${fileName} — SHA256 uyuşmazlığı (dosya değişmiş olabilir)`);
    return null;
  }

  // Plugin yükle
  try {
    const module = await import(pathToFileURL(pluginPath).href);
    const tool = module.default as Partial<ToolDefinition> | undefined;
    
    if (!tool || typeof tool.execute !== 'function' || typeof tool.name !== 'string') {
      log(`${fileName} — default export geçerli bir ToolDefinition değil`);
      return null;
    }

    if (tool.name !== manifest.name) {
      log(`${fileName} — araç adı manifest ile uyuşmuyor`);
      return null;
    }

    // Registry'e kaydet
    const state = getRegistryState();
    state.plugins.set(manifest.name, {
      manifest,
      dir: pluginDir,
      enabled: true,
      loadedAt: new Date(),
    });
    saveRegistryState();

    log(`${manifest.name} v${manifest.version} yüklendi ✅`);
    return tool as ToolDefinition;
  } catch (err) {
    log(`${fileName} — yükleme hatası: ${err}`);
    
    const state = getRegistryState();
    state.plugins.set(manifest.name, {
      manifest,
      dir: pluginDir,
      enabled: false,
      loadError: String(err),
    });
    saveRegistryState();
    
    return null;
  }
}

// ---------------------------------------------------------------------------
// Toplu Plugin Yükleme
// ---------------------------------------------------------------------------

export async function loadAllPlugins(config?: SETHConfig): Promise<ToolDefinition[]> {
  const files = discoverPlugins();
  
  const loadPromises = files.map(file => loadPlugin(file, config));
  const results = await Promise.all(loadPromises);

  const tools = results.filter((tool): tool is ToolDefinition => tool !== null);
  
  log(`Toplam ${tools.length}/${files.length} plugin yüklendi`);
  return tools;
}

// ---------------------------------------------------------------------------
// Plugin Yönetim Araçları
// ---------------------------------------------------------------------------

export function listPlugins(): PluginRecord[] {
  return Array.from(getRegistryState().plugins.values());
}

export function getPlugin(name: string): PluginRecord | undefined {
  return getRegistryState().plugins.get(name);
}

export function enablePlugin(name: string): boolean {
  const state = getRegistryState();
  const plugin = state.plugins.get(name);
  if (!plugin) return false;
  plugin.enabled = true;
  saveRegistryState();
  return true;
}

export function disablePlugin(name: string): boolean {
  const state = getRegistryState();
  const plugin = state.plugins.get(name);
  if (!plugin) return false;
  plugin.enabled = false;
  saveRegistryState();
  return true;
}

export function removePlugin(name: string): boolean {
  const state = getRegistryState();
  const existed = state.plugins.delete(name);
  if (existed) saveRegistryState();
  return existed;
}

// ---------------------------------------------------------------------------
// Hot-Reload (Geliştirme modu)
// ---------------------------------------------------------------------------

let watcher: ReturnType<typeof watch> | null = null;

export function watchPluginDir(
  onPluginChange?: (pluginName: string, action: 'loaded' | 'removed') => void,
): void {
  if (watcher) return;
  const dir = getPluginDir();
  
  watcher = watch(dir, async (eventType, fileName) => {
    if (!fileName) return;
    
    if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) {
      log(`Değişiklik algılandı: ${fileName} (${eventType})`);
      
      if (eventType === 'change') {
        // Plugin güncellendi — yeniden yükle
        const baseName = fileName.replace(/\.(js|mjs)$/, '');
        // Eski kaydı temizle
        const pluginName = baseName;
        const state = getRegistryState();
        state.plugins.delete(pluginName);
        
        // Yeniden yükle
        const tool = await loadPlugin(fileName);
        if (tool && onPluginChange) {
          onPluginChange(tool.name, 'loaded');
        }
      } else if (eventType === 'rename') {
        log(`Plugin dosyası silindi/taşındı: ${fileName}`);
        if (onPluginChange) {
          const baseName = fileName.replace(/\.(js|mjs)$/, '');
          onPluginChange(baseName, 'removed');
        }
      }
    }
  });
  
  log(`Plugin dizini izleniyor: ${dir}`);
}

export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    log('Plugin izleme durduruldu');
  }
}

// ---------------------------------------------------------------------------
// İnisiyalizasyon
// ---------------------------------------------------------------------------

export async function initPluginSystem(config?: SETHConfig): Promise<ToolDefinition[]> {
  getRegistryState();
  return loadAllPlugins(config);
}
