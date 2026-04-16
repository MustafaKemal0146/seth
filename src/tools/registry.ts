/**
 * @fileoverview Tool registry — manages tool definitions and converts to LLM schemas.
 */

import type { ToolDefinition, ToolSchema } from '../types.js';
import { kayitliAraclariKaydet } from '../session-runtime.js';

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
export async function createDefaultRegistry(): Promise<ToolRegistry> {
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
  const {
    sqlmapTool, nmapTool, niktoTool, gobusterTool,
    whoisTool, digTool, whatwebTool, ffufTool,
    nucleiTool, masscanTool, ncTool, wpscanTool, subfinderTool,
  } = await import('./external-tool.js');
  const { browserAutomationTool, closeBrowser } = await import('./browser-automation.js');
  const { openBrowserAgentTool } = await import('./openbrowser-agent.js');

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

  // Browser automation
  registry.register(browserAutomationTool);
  registry.register(openBrowserAgentTool);

  // Arka plan görev araçları
  const { taskCreateTool, taskListTool, taskGetTool, taskStopTool } = await import('./background-tasks.js');
  registry.register(taskCreateTool);
  registry.register(taskListTool);
  registry.register(taskGetTool);
  registry.register(taskStopTool);

  snapshotToolRegistry(registry);
  return registry;
}
