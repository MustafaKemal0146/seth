/**
 * @fileoverview Tool registry — manages tool definitions and converts to LLM schemas.
 */

import type { ToolDefinition, ToolSchema } from '../types.js';
import { kayitliAraclariKaydet } from '../session-runtime.js';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { SETHConfig, SecurityProfile } from '../types.js';

/** arac_ara aracı için güncel araç adı + açıklama özetini yazar. */
export function snapshotToolRegistry(registry: ToolRegistry): void {
  kayitliAraclariKaydet(
    registry.list().map((t) => ({ name: t.name, description: t.description })),
  );
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Convert all registered tools to LLM-compatible schema format. */
  toSchemas(): ToolSchema[] {
    return this.list().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** Get tool count. */
  get size(): number {
    return this.tools.size;
  }
}

/** Create and populate a registry with the default built-in tools. */
export async function createDefaultRegistry(config?: SETHConfig): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  const { shellTool } = await import('./shell.js');
  const { fileReadTool } = await import('./file-read.js');
  const { fileWriteTool } = await import('./file-write.js');
  const { fileEditTool } = await import('./file-edit.js');
  const { searchTool } = await import('./search.js');
  const { listDirectoryTool } = await import('./list-directory.js');
  const { globTool } = await import('./glob.js');
  const { batchReadTool } = await import('./batch-read.js');
  const { askUserTool } = await import('./ask-user.js');
  const { webFetchTool } = await import('./web-fetch.js');
  const { grepTool } = await import('./grep.js');
  const { webAraTool, webSearchTool } = await import('./web-search.js');
  const { gorevOkuTool } = await import('./gorev-oku.js');
  const { gorevYazTool } = await import('./gorev-yaz.js');
  const { aracAraTool } = await import('./arac-ara.js');
  const { mcpAracTool } = await import('./mcp-arac.js');
  const { gitStatusTool } = await import('./git-status.js');
  const { gitDiffTool } = await import('./git-diff.js');
  const { gitLogTool } = await import('./git-log.js');
  const { repoOzetTool } = await import('./repo-ozet.js');
  const { takimOlusturTool } = await import('./takim-olustur.js');
  const { takimOkuTool } = await import('./takim-oku.js');
  const { gorevEkleTool } = await import('./gorev-ekle.js');
  const { gorevGuncelleTool } = await import('./gorev-guncelle.js');
  const { enterPlanModeTool, exitPlanModeTool } = await import('./plan-mode.js');
  const { agentSpawnTool } = await import('./agent-spawn.js');
  const { memoryReadTool, memoryWriteTool } = await import('./agent-memory.js');
  const { lspDiagnosticsTool } = await import('./lsp.js');
  const { sethEngineTool } = await import('./seth-engine.js');
  const { gitWorktreeTool } = await import('./git-worktree.js');
  const { topicTool } = await import('./topic-tool.js');
  const { trackerReadTool, trackerWriteTool } = await import('./tracker-tools.js');
  const { writeTodosTool, readTodosTool } = await import('./write-todos.js');
  const {
    sqlmapTool, nmapTool, niktoTool, gobusterTool,
    whoisTool, digTool, whatwebTool, ffufTool,
    nucleiTool, masscanTool, ncTool, wpscanTool, subfinderTool,
    johnTool, hashcatTool, ffufWordlistTool,
  } = await import('./external-tool.js');
  const { browserAutomationTool, closeBrowser } = await import('./browser-automation.js');
  const { openBrowserAgentTool } = await import('./openbrowser-agent.js');
  const { ctfSolverTool } = await import('./ctf-solver.js');
  const { ctfFileAnalyzerTool } = await import('./ctf-file-analyzer.js');
  const { ctfStegoTool } = await import('./ctf-stego.js');
  const { ctfWebAnalyzerTool } = await import('./ctf-web-analyzer.js');
  const { ctfNetworkAnalyzerTool } = await import('./ctf-network-analyzer.js');
  const { ctfAutoTool } = await import('./ctf-auto.js');
  const { shodanTool } = await import('./shodan.js');

  registry.register(shellTool);
  registry.register(fileReadTool);
  registry.register(fileWriteTool);
  registry.register(fileEditTool);
  registry.register(searchTool);
  registry.register(grepTool);
  registry.register(listDirectoryTool);
  registry.register(globTool);
  registry.register(batchReadTool);
  registry.register(askUserTool);
  registry.register(webFetchTool);
  registry.register(webAraTool);
  registry.register(webSearchTool);
  registry.register(gorevOkuTool);
  registry.register(gorevYazTool);
  registry.register(aracAraTool);
  registry.register(mcpAracTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(repoOzetTool);
  registry.register(takimOlusturTool);
  registry.register(takimOkuTool);
  registry.register(gorevEkleTool);
  registry.register(gorevGuncelleTool);
  registry.register(enterPlanModeTool);
  registry.register(exitPlanModeTool);
  registry.register(agentSpawnTool);
  registry.register(memoryReadTool);
  registry.register(memoryWriteTool);
  registry.register(lspDiagnosticsTool);
  registry.register(sethEngineTool);
  registry.register(gitWorktreeTool);
  registry.register(topicTool);
  registry.register(trackerReadTool);
  registry.register(trackerWriteTool);
  registry.register(writeTodosTool);
  registry.register(readTodosTool);

  // External security tools
  registry.register(sqlmapTool);
  registry.register(nmapTool);
  registry.register(niktoTool);
  registry.register(gobusterTool);
  registry.register(whoisTool);
  registry.register(digTool);
  registry.register(whatwebTool);
  registry.register(ffufTool);
  registry.register(nucleiTool);
  registry.register(masscanTool);
  registry.register(ncTool);
  registry.register(wpscanTool);
  registry.register(subfinderTool);
  registry.register(johnTool);
  registry.register(hashcatTool);
  registry.register(ffufWordlistTool);

  // Browser automation
  registry.register(browserAutomationTool);
  registry.register(openBrowserAgentTool);

  // CTF Solver
  registry.register(ctfSolverTool);
  registry.register(ctfFileAnalyzerTool);
  registry.register(ctfStegoTool);
  registry.register(ctfWebAnalyzerTool);
  registry.register(ctfNetworkAnalyzerTool);
  registry.register(ctfAutoTool);
  registry.register(shodanTool);

  // Plugin Sistemi — manifest + izin deklarasyonu + SHA256 doğrulama
  await loadSecurePlugins(registry, config);

  // Arka plan görev araçları
  const { taskCreateTool, taskListTool, taskGetTool, taskStopTool } = await import('./background-tasks.js');
  registry.register(taskCreateTool);
  registry.register(taskListTool);
  registry.register(taskGetTool);
  registry.register(taskStopTool);

  snapshotToolRegistry(registry);
  return registry;
}

interface PluginManifest {
  readonly name: string;
  readonly main: string;
  readonly permissions: readonly string[];
  readonly sha256: string;
}

const PLUGIN_PERMISSIONS = new Set(['read_fs', 'write_fs', 'network', 'exec']);
const PROFILE_PLUGIN_PERMISSIONS: Record<SecurityProfile, Set<string>> = {
  safe: new Set(['read_fs']),
  standard: new Set(['read_fs', 'write_fs']),
  pentest: new Set(['read_fs', 'write_fs', 'network', 'exec']),
};

function pluginReject(file: string, reason: string): void {
  process.stderr.write(`[seth:plugin] ${file} reddedildi: ${reason}\n`);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parsePluginManifest(path: string): PluginManifest {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PluginManifest>;
  if (!raw.name || typeof raw.name !== 'string') throw new Error('manifest.name zorunlu');
  if (!raw.main || typeof raw.main !== 'string') throw new Error('manifest.main zorunlu');
  if (!Array.isArray(raw.permissions)) throw new Error('manifest.permissions dizi olmalı');
  if (!raw.sha256 || typeof raw.sha256 !== 'string') throw new Error('manifest.sha256 zorunlu');
  return {
    name: raw.name,
    main: raw.main,
    permissions: raw.permissions,
    sha256: raw.sha256.toLowerCase(),
  };
}

async function loadSecurePlugins(registry: ToolRegistry, config?: SETHConfig): Promise<void> {
  const { existsSync, readdirSync, mkdirSync } = await import('fs');
  const { join } = await import('path');
  const { homedir } = await import('os');
  const { pathToFileURL } = await import('url');
  const { loadConfig } = await import('../config/settings.js');

  const effectiveConfig = config ?? loadConfig();
  const profile = effectiveConfig.tools.securityProfile ?? 'standard';
  const allowedPermissions = PROFILE_PLUGIN_PERMISSIONS[profile];

  const pluginDir = join(homedir(), '.seth', 'plugins');
  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });

  const files = readdirSync(pluginDir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const pluginPath = join(pluginDir, file);
    const manifestPath = join(pluginDir, `${file.replace(/\.js$/, '')}.manifest.json`);

    if (!existsSync(manifestPath)) {
      pluginReject(file, 'manifest dosyası yok (örn: <plugin>.manifest.json)');
      continue;
    }

    let manifest: PluginManifest;
    try {
      manifest = parsePluginManifest(manifestPath);
    } catch (err) {
      pluginReject(file, `manifest geçersiz: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (manifest.main !== file) {
      pluginReject(file, `manifest.main "${manifest.main}" dosya adıyla eşleşmiyor`);
      continue;
    }

    const invalidPerm = manifest.permissions.find((p) => !PLUGIN_PERMISSIONS.has(p));
    if (invalidPerm) {
      pluginReject(file, `tanımsız permission: ${invalidPerm}`);
      continue;
    }

    const disallowedPerm = manifest.permissions.find((p) => !allowedPermissions.has(p));
    if (disallowedPerm) {
      pluginReject(file, `"${profile}" profilinde izin verilmeyen permission: ${disallowedPerm}`);
      continue;
    }

    const actualHash = sha256File(pluginPath);
    if (actualHash !== manifest.sha256) {
      pluginReject(file, `SHA256 uyuşmuyor (beklenen=${manifest.sha256}, bulunan=${actualHash})`);
      continue;
    }

    try {
      const pluginModule = await import(pathToFileURL(pluginPath).href);
      const tool = pluginModule.default as Partial<ToolDefinition> | undefined;
      if (!tool || typeof tool.execute !== 'function' || typeof tool.name !== 'string') {
        pluginReject(file, 'default export geçerli bir ToolDefinition değil');
        continue;
      }
      if (tool.name !== manifest.name) {
        pluginReject(file, `araç adı manifest ile uyuşmuyor (tool=${tool.name}, manifest=${manifest.name})`);
        continue;
      }
      registry.register(tool as ToolDefinition);
    } catch (err) {
      pluginReject(file, `yükleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
