/**
 * @fileoverview Interactive terminal interface (REPL).
 */

import readline from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { readdirSync } from 'node:fs';
import { writeFile as fsWriteFile, readFile as fsReadFile, unlink as fsUnlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import {
  createProvider,
} from './providers/base.js';
import {
  loadConfig,
  saveConfig,
  resolveModel,
  persistProviderAndModel,
  getEffectiveContextBudgetTokens,
} from './config/settings.js';
import {
  createSession,
  saveSession,
  loadSession,
  updateSessionMessages,
} from './storage/session.js';
import {
  ToolRegistry,
  createDefaultRegistry,
} from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import {
  renderError,
  renderStats,
  renderMarkdown,
  renderToolCall,
  renderToolResult,
  stripLeadingUserEchoFromAssistantDisplay,
  startSpinner,
  clearSpinner,
  getToolSpinnerText,
} from './renderer.js';
import { renderWelcomeAnimation, sethLog } from './welcome.js';
import { createReplStreamingController, resolveStreamMode } from './repl-streaming.js';
import {
  isPlanWaitingApproval,
  getPlanModeState,
  approvePlan,
  rejectPlan,
  resetPlanModeState,
} from './plan-mode-state.js';
import { setSharedAgentContext } from './tools/agent-spawn.js';
import { writeRecoveryCheckpoint, checkRecovery, clearRecovery } from './session-recovery.js';
import { generateSessionTitle } from './session-title.js';
import { recordMessage } from './chat-recording.js';
import { cmd, promptBright } from './theme.js';
import { loadHistory, addToHistory, storePaste } from './storage/history.js';
import { runHistorySearch } from './history-search.js';
import { runHooks } from './hooks.js';
import { webUIController } from './web/controller.js';

import type { ProviderName, SETHConfig, ChatMessage, PermissionLevel, ThinkingStyle, LLMProvider } from './types.js';
import { executeCommand, COMMANDS, type CommandContext } from './commands.js';
import { runAgentLoop, type AgentLoopOptions } from './agent/loop.js';

// ─── REPL Implementation ──────────────────────────────────────────────────────

export async function startRepl(configOverrides?: Partial<SETHConfig>, skipWelcome = false, resumeSessionId?: string, userEmail?: string): Promise<void> {
  let appConfig = loadConfig(configOverrides);
  let currentCwd = process.cwd();
  
  // Temayı yükle
  const { setTheme } = await import('./theme.js');
  if (appConfig.theme) setTheme(appConfig.theme as any);

  // Graceful shutdown kur
  const { setupGracefulShutdown, startBackgroundCleanup } = await import('./lifecycle.js');
  setupGracefulShutdown();
  void startBackgroundCleanup(pathJoin(homedir(), '.seth', 'sessions'));

  let currentProvider: ProviderName = appConfig.defaultProvider;
  let currentModel = resolveModel(currentProvider, appConfig);
  let toolsEnabled = true;
  let agentEnabled = appConfig.agent.enabled;
  let currentEffort = appConfig.effort ?? 'medium';
  let provider: LLMProvider;
  let totalTurns = 0;
  let compactWarned = false;

  try {
    provider = await createProvider(currentProvider, appConfig);
  } catch (err) {
    console.error(renderError(err instanceof Error ? err : new Error(String(err))));
    process.exit(1);
  }

  const toolRegistry = await createDefaultRegistry();
  const confirmFn = appConfig.autoApprove ? async () => true : undefined;
  const toolExecutor = new ToolExecutor(toolRegistry, appConfig.tools, confirmFn);

  let session = createSession(currentProvider, currentModel);

  // v3.8.17: Proje bazlı otomatik bellek (project.md)
  import('./auto-memory.js').then(({ ensureProjectMetadata }) => {
    ensureProjectMetadata(currentCwd, provider, currentModel).catch(() => {});
  }).catch(() => {});

  // #10 Crash recovery
  const recovery = checkRecovery();
  if (recovery && recovery.messageCount > 0 && recovery.sessionId && !resumeSessionId) {
    const loaded = loadSession(recovery.sessionId);
    if (loaded && loaded.messages.length > 0) {
      session = loaded;
      console.log(chalk.green(`\n  ↺ Son oturum kurtarıldı: ${session.id.slice(0, 8)}… (${session.messages.length} mesaj)\n`));
    }
  }

  if (resumeSessionId) {
    const loaded = loadSession(resumeSessionId);
    if (loaded) {
      session = loaded;
      console.log(chalk.green(`\n  ✓ Oturum yüklendi: ${resumeSessionId.slice(0, 8)}… (${session.messages.length} mesaj)\n`));
    }
  }

  let laneHistories = {
    a: [...(session.messages ?? [])],
    b: [...(session.messagesLaneB ?? [])],
  };
  let activeLane = session.activeLane ?? 'a';
  let totalUsage = session.tokenUsage ?? { inputTokens: 0, outputTokens: 0 };

  setSharedAgentContext(provider, currentModel, currentCwd);

  function getPromptStr(): string {
    const userMsgs = laneHistories[activeLane].filter(m => m.role === 'user').length;
    const cumTokens = totalUsage.inputTokens + totalUsage.outputTokens;
    const budget = getEffectiveContextBudgetTokens(appConfig);
    const pct = budget > 0 ? Math.round((cumTokens / budget) * 100) : 0;
    const promptSym = promptBright('>');
    
    if (userMsgs > 0 || cumTokens > 0) {
      const tokenStr = cumTokens >= 1000 ? `${(cumTokens / 1000).toFixed(1)}k` : `${cumTokens}`;
      const budgetStr = budget >= 1000 ? `${(budget / 1000).toFixed(0)}k` : `${budget}`;
      const lanePart = activeLane !== 'a' ? `${activeLane.toUpperCase()}·` : '';
      return chalk.dim(`[${lanePart}${userMsgs}msg·${tokenStr}/${budgetStr}] `) + promptSym + ' ';
    }
    return promptSym + ' ';
  }

  const ctx: CommandContext = {
    get config() { return appConfig; },
    currentProvider,
    currentModel,
    toolsEnabled,
    agentEnabled,
    setProvider: async (name) => {
      provider = await createProvider(name, appConfig);
      currentProvider = name; ctx.currentProvider = name;
      currentModel = resolveModel(name, appConfig); ctx.currentModel = currentModel;
      persistProviderAndModel(name, currentModel);
      if (rl) rl.setPrompt(getPromptStr());
    },
    setModel: (m) => { currentModel = m; ctx.currentModel = m; if (rl) rl.setPrompt(getPromptStr()); },
    setToolsEnabled: (e) => { toolsEnabled = e; ctx.toolsEnabled = e; },
    setAgentEnabled: (e) => { agentEnabled = e; ctx.agentEnabled = e; },
    clearHistory: (scope) => {
      if (scope === 'all') {
        laneHistories.a = []; laneHistories.b = [];
        totalUsage = { inputTokens: 0, outputTokens: 0 };
        session = createSession(currentProvider, currentModel);
      } else {
        laneHistories[activeLane] = [];
      }
      if (rl) rl.prompt();
    },
    getContextBudgetTokens: () => getEffectiveContextBudgetTokens(appConfig),
    setContextBudgetTokens: (n) => { saveConfig({ contextBudgetTokens: n }); appConfig = loadConfig(configOverrides); },
    getActiveLane: () => activeLane,
    setActiveLane: (l) => { activeLane = l; if (rl) rl.setPrompt(getPromptStr()); },
    compactHistory: async () => null,
    undoHistory: () => {
      if (laneHistories[activeLane].length > 0) {
        laneHistories[activeLane].pop();
        return true;
      }
      return false;
    },
    changeCwd: (d) => { currentCwd = d; return d; },
    getCwd: () => currentCwd,
    getHistory: () => laneHistories[activeLane],
    getPermissionLevel: () => toolExecutor.getPermissionLevel(),
    setPermissionLevel: (l) => {
      toolExecutor.setPermissionLevel(l);
      webUIController.sendSettings({ permissionLevel: l, securityProfile: toolExecutor.getSecurityProfile() });
    },
    getSecurityProfile: () => toolExecutor.getSecurityProfile(),
    setSecurityProfile: (p) => {
      toolExecutor.setSecurityProfile(p);
      webUIController.sendSettings({ permissionLevel: toolExecutor.getPermissionLevel(), securityProfile: p });
    },
    getStats: () => ({
      messages: laneHistories[activeLane].length,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      turns: totalTurns,
    }),
    getSessionId: () => session.id,
    setThinkingStyle: (s) => { saveConfig({ repl: { thinkingStyle: s } }); appConfig = loadConfig(configOverrides); },
    setEffort: (level) => { currentEffort = level; saveConfig({ effort: level }); appConfig = loadConfig(configOverrides); webUIController.sendEffort(level); },
    setVimMode: (e) => { saveConfig({ repl: { ...appConfig.repl, vimMode: e } }); appConfig = loadConfig(configOverrides); },
  };

  if (!skipWelcome) renderWelcomeAnimation(currentProvider, currentModel);

  let rl: readline.Interface | null = null;
  let currentAbortController: AbortController | null = null;
  let processing = false;
  let lastPastedContent = '';
  let isProgrammaticClose = false;

  async function runAgentTurn(text: string) {
    const controller = new AbortController();
    currentAbortController = controller;
    processing = true;
    webUIController.sendStatus('processing', true);

    // Streaming controller — stable/unstable markdown lexer
    const streaming = createReplStreamingController({
      streamMode: resolveStreamMode(undefined),
      hideIncompleteLine: false,
      throttleMs: 0,
      renderMarkdown,
    });
    streaming.onTurnStart(text);

    // Cevap başlamadan önce görsel ayrım
    process.stdout.write('\n');

    // Spinner başlat
    startSpinner('Düşünüyor…', true, {
      thinkingMode: appConfig.repl?.thinkingStyle === 'minimal' ? 'minimal' : 'animated',
    });

    try {
      const loopOptions: AgentLoopOptions = {
        provider, model: currentModel, systemPrompt: '',
        toolRegistry, toolExecutor,
        maxTurns: appConfig.agent.maxTurns,
        maxTokens: appConfig.agent.maxTokens,
        cwd: currentCwd, debug: appConfig.debug,
        effort: currentEffort,
        abortSignal: controller.signal,
        onText: (chunk) => {
          streaming.onText(chunk, () => clearSpinner());
        },
        onToolCall: (name, input) => {
          clearSpinner();
          streaming.commitSegmentBeforeTool();
          process.stdout.write(renderToolCall(name, input) + '\n');
          startSpinner(getToolSpinnerText(name, input));
        },
        onToolResult: (name, output, isError, data) => {
          clearSpinner();
          process.stdout.write(renderToolResult(name, output, isError, data));
        },
      };

      const result = await runAgentLoop(text, laneHistories[activeLane], loopOptions);

      streaming.finalize(text, result.finalText, stripLeadingUserEchoFromAssistantDisplay);

      const statsLine = renderStats(
        result.totalUsage.inputTokens,
        result.totalUsage.outputTokens,
        result.turns,
      );
      if (statsLine) process.stdout.write('\n' + statsLine + '\n');

      laneHistories[activeLane] = result.messages;
      totalUsage = {
        inputTokens: totalUsage.inputTokens + result.totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens + result.totalUsage.outputTokens,
      };
      totalTurns += result.turns;
      saveSession(updateSessionMessages(session, laneHistories.a, laneHistories.b, activeLane, result.totalUsage));
    } catch (err: any) {
      clearSpinner();
      if (err.name !== 'AbortError') console.error(chalk.red(`\n  ✗ Hata: ${err.message}`));
    } finally {
      processing = false;
      currentAbortController = null;
      webUIController.sendStatus('idle', false);
      if (rl) rl.prompt();
    }
  }

  // ─── Tab tamamlama ───────────────────────────────────────────────────────────
  function tabCompleter(line: string): [string[], string] {
    const trimmed = line.trimStart();

    // Slash komut tamamlama: /k → /kaydet, /komut…
    if (trimmed.startsWith('/')) {
      const partial = trimmed.slice(1).toLowerCase();
      const allCmds = Object.keys(COMMANDS).map(c => `/${c}`);
      const hits = partial
        ? allCmds.filter(c => c.slice(1).startsWith(partial))
        : allCmds;
      return [hits.length > 0 ? hits : allCmds, line];
    }

    // Dosya/dizin yolu tamamlama: ./foo, ../bar, /abs, ~/home
    const pathMatch = line.match(/((?:\.\.?\/|\/|~\/)[^\s]*)$/);
    if (pathMatch) {
      try {
        const pathPart = pathMatch[1]!.replace(/^~/, homedir());
        const lastSlash = pathPart.lastIndexOf('/');
        const dirPart  = lastSlash >= 0 ? pathPart.slice(0, lastSlash + 1) : './';
        const basePart = lastSlash >= 0 ? pathPart.slice(lastSlash + 1)    : pathPart;
        const absDir   = pathJoin(currentCwd, dirPart);
        const entries  = readdirSync(absDir);
        const hits     = entries
          .filter(e => e.startsWith(basePart))
          .map(e => line.slice(0, line.length - basePart.length) + e);
        return [hits, line];
      } catch {
        return [[], line];
      }
    }

    return [[], line];
  }

  // ─── Harici editör (Ctrl+X Ctrl+E) ──────────────────────────────────────────
  async function openExternalEditor(): Promise<void> {
    const currentInput = rl?.line ?? '';
    const tmpFile = pathJoin(tmpdir(), `seth_edit_${Date.now()}.txt`);
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'nano';

    await fsWriteFile(tmpFile, currentInput, 'utf-8');
    rl?.pause();

    await new Promise<void>((resolve) => {
      const child = spawn(editor, [tmpFile], { stdio: 'inherit' });
      child.on('close', resolve);
      child.on('error', resolve);
    });

    const edited = await fsReadFile(tmpFile, 'utf-8').catch(() => currentInput);
    await fsUnlink(tmpFile).catch(() => {});

    rl?.resume();
    rl?.write(null, { ctrl: true, name: 'u' }); // Mevcut satırı temizle
    rl?.write(edited.trimEnd());
    rl?.prompt();
  }

  // ─── Readline arayüzü ────────────────────────────────────────────────────────
  function createInterface() {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: getPromptStr(),
      terminal: true,
      completer: tabCompleter,
    });

    rl.on('line', async (line) => {
      if (processing) return;
      const trimmed = line.trim();
      if (!trimmed) { rl?.prompt(); return; }
      if (trimmed.startsWith('/')) {
        rl?.pause();                    // clack prompts öncesi readline'ı durdur
        const result = await executeCommand(line, ctx);
        process.stdin.resume();         // clack stdin'i kapattıysa geri aç
        rl?.resume();                   // readline'ı yeniden etkinleştir
        if (result?.output) console.log(result.output);
        if (result?.shouldExit) process.exit(0);
        if (result?.runAsUserMessage) {
          await runAgentTurn(result.runAsUserMessage);
        } else {
          if (rl) rl.prompt();
        }
      } else {
        await runAgentTurn(line);
      }
    });

    rl.on('SIGINT', () => {
      if (currentAbortController) {
        currentAbortController.abort();
      } else if (rl && rl.line.length > 0) {
        rl.write(null, { ctrl: true, name: 'u' });
      } else {
        process.exit(0);
      }
    });

    // ─── Özel tuş kombinasyonları ─────────────────────────────────────────────
    readline.emitKeypressEvents(process.stdin, rl);
    let ctrlXArmed = false; // Ctrl+X → Ctrl+E dizisi için

    process.stdin.on('keypress', async (_str, key) => {
      if (!key || processing) return;

      // Ctrl+R — geçmiş arama
      if (key.ctrl && key.name === 'r') {
        ctrlXArmed = false;
        const savedLine = rl?.line ?? '';
        rl?.pause();
        process.stdout.write('\n');
        const selected = await runHistorySearch();
        rl?.resume();
        // history-search ekranı temizler, hoş geldin ekranını yeniden çiz
        renderWelcomeAnimation(currentProvider, currentModel);
        rl?.setPrompt(getPromptStr());
        rl?.prompt();
        if (selected) {
          rl?.write(selected);
        } else if (savedLine) {
          rl?.write(savedLine);
        }
        return;
      }

      // Ctrl+L — ekranı temizle
      if (key.ctrl && key.name === 'l') {
        ctrlXArmed = false;
        console.clear();
        renderWelcomeAnimation(currentProvider, currentModel);
        rl?.setPrompt(getPromptStr());
        rl?.prompt();
        if (rl?.line) rl.write(rl.line); // mevcut girdiyi tekrar göster
        return;
      }

      // Ctrl+X — Ctrl+E dizisinin ilk adımı
      if (key.ctrl && key.name === 'x') {
        ctrlXArmed = true;
        setTimeout(() => { ctrlXArmed = false; }, 1500);
        return;
      }

      // Ctrl+E (Ctrl+X sonrası) — harici editörde aç
      if (ctrlXArmed && key.ctrl && key.name === 'e') {
        ctrlXArmed = false;
        await openExternalEditor();
        return;
      }

      ctrlXArmed = false;
    });

    // v3.9.0: Web UI'dan gelen mesajları dinle
    webUIController.onUserInput((text) => {
      if (!processing) {
        runAgentTurn(text);
      }
    });

    // Web UI'ya mevcut effort + settings ilet
    webUIController.sendEffort(currentEffort);
    webUIController.sendSettings({
      permissionLevel: toolExecutor.getPermissionLevel(),
      securityProfile: toolExecutor.getSecurityProfile(),
      theme: appConfig.theme ?? 'dark',
    });

    // v3.9.0: Web UI'dan gelen slash komutlarını doğrudan işle
    webUIController.onWebCommand(async (text) => {
      if (processing) {
        webUIController.sendCommandResult('⚠ İşlem devam ediyor, komut şu an çalıştırılamaz.');
        return;
      }
      try {
        const result = await executeCommand(text, ctx);
        if (result?.output) {
          const clean = result.output.replace(/\x1B\[[0-9;]*m/g, '');
          webUIController.sendCommandResult(clean);
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        webUIController.sendCommandResult('✗ ' + msg.replace(/\x1B\[[0-9;]*m/g, ''));
      }
      // Komut sonrası güncel ayarları yayınla (tema/yetki/güvenlik değişmiş olabilir)
      appConfig = loadConfig(configOverrides);
      webUIController.sendSettings({
        permissionLevel: toolExecutor.getPermissionLevel(),
        securityProfile: toolExecutor.getSecurityProfile(),
        theme: appConfig.theme ?? 'dark',
      });
    });

    // Web UI'dan model listesi isteği
    webUIController.onGetModels(async (provider) => {
      try {
        const { listModels } = await import('./providers/factory.js');
        const p = provider as ProviderName;
        const models = await listModels(p, appConfig.providers?.[p]);
        webUIController.sendModels(provider, models);
      } catch {
        webUIController.sendModels(provider, []);
      }
    });

    webUIController.onWebAbort(() => {
      if (currentAbortController) {
        currentAbortController.abort();
      }
    });

    rl.prompt();
  }

  createInterface();
}
