/**
 * @fileoverview Interactive terminal interface (REPL).
 */

import readline from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
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
  isPlanModeEnabled,
  getPlanModeState,
  approvePlan,
  rejectPlan,
  resetPlanModeState,
} from './plan-mode-state.js';
import { setSharedAgentContext } from './tools/agent-spawn.js';
import { writeRecoveryCheckpoint, checkRecovery, clearRecovery } from './session-recovery.js';
import { compactMessages } from './rolling-summary.js';
import { createVimHandler } from './vim-mode.js';
import { loadKeybindings } from './keybindings.js';
import { generateSessionTitle } from './session-title.js';
import { recordMessage } from './chat-recording.js';
import { cmd, promptBright } from './theme.js';
import { ptyModeActive, ptyInputWriter } from './pty-mode.js';
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
  let deepseekThinking = true;
  let deepseekReasoningEffort: 'high' | 'max' = 'high';
  let currentMaxConcurrentTools = 5;
  let provider: LLMProvider;
  let totalTurns = 0;
  let compactWarned = false;
  // Plan onayı için callback — terminal + web UI'dan çözülebilir
  let planApprovalResolver: ((approved: boolean) => void) | null = null;

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

    // Vim modu göstergesi
    const vimPart = appConfig.repl?.vimMode ? chalk.dim(`[${vimHandler?.getMode() === 'NORMAL' ? 'N' : 'I'}] `) : '';

    if (userMsgs > 0 || cumTokens > 0) {
      const tokenStr = cumTokens >= 1000 ? `${(cumTokens / 1000).toFixed(1)}k` : `${cumTokens}`;
      const budgetStr = budget >= 1000 ? `${(budget / 1000).toFixed(0)}k` : `${budget}`;
      const lanePart = activeLane !== 'a' ? `${activeLane.toUpperCase()}·` : '';

      // Context window bar (8 karakter genişlik)
      let barPart = '';
      if (budget > 0 && cumTokens > 0) {
        const filled = Math.round((pct / 100) * 8);
        const bar = '█'.repeat(filled) + '░'.repeat(8 - filled);
        const coloredBar = pct >= 80
          ? chalk.red(bar)
          : pct >= 60
            ? chalk.yellow(bar)
            : chalk.green(bar);
        barPart = chalk.dim('[') + coloredBar + chalk.dim(`] ${pct}% `);
      }

      return vimPart + barPart + chalk.dim(`[${lanePart}${userMsgs}msg·${tokenStr}/${budgetStr}] `) + promptSym + ' ';
    }
    return vimPart + promptSym + ' ';
  }

  const ctx: CommandContext = {
    get config() { return appConfig; },
    currentProvider,
    currentModel,
    toolsEnabled,
    agentEnabled,
    setProvider: async (name) => {
      const freshConfig = loadConfig();
      provider = await createProvider(name, freshConfig);
      currentProvider = name; ctx.currentProvider = name;
      currentModel = resolveModel(name, appConfig); ctx.currentModel = currentModel;
      persistProviderAndModel(name, currentModel);
      if (rl) rl.setPrompt(getPromptStr());
      if (laneHistories[activeLane].length > 0) {
        console.log(chalk.dim('  Bilgi: Geçmiş konuşma korundu. Temizlemek için /context-temizle'));
      }
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
    compactHistory: async () => {
      const history = laneHistories[activeLane];
      if (history.length < 4) return null;
      const result = await compactMessages(history, provider, currentModel);
      if (result.before !== result.after) {
        laneHistories[activeLane] = result.messages;
        webUIController.sendHistory(result.messages);
        if (rl) rl.setPrompt(getPromptStr());
      }
      return { before: result.before, after: result.after };
    },
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
    setEffort: (level) => {
      currentEffort = level;
      // DeepSeek thinking aktifse effort değişikliğini anında yansıt
      if (deepseekThinking) {
        deepseekReasoningEffort = level === 'max' ? 'max' : 'high';
      }
      saveConfig({ effort: level }); appConfig = loadConfig(configOverrides); webUIController.sendEffort(level);
    },
    getDeepSeekThinking: () => deepseekThinking,
    setDeepSeekThinking: (enabled: boolean) => {
      deepseekThinking = enabled;
      // effort → reasoningEffort eşlemesi: max → max, diğer → high
      deepseekReasoningEffort = (currentEffort === 'max') ? 'max' : 'high';
    },
    setVimMode: (e) => { saveConfig({ repl: { ...appConfig.repl, vimMode: e } }); appConfig = loadConfig(configOverrides); },
    setMaxConcurrentTools: (n) => { currentMaxConcurrentTools = Math.max(1, Math.min(20, n)); },
    getMaxConcurrentTools: () => currentMaxConcurrentTools,
    setHistory: (messages) => {
      laneHistories[activeLane] = messages;
      webUIController.sendHistory(messages);
    },
    getLaneHistoriesB: () => laneHistories.b,
    approvePlanFromWeb: () => { if (planApprovalResolver) { planApprovalResolver(true); planApprovalResolver = null; } },
    rejectPlanFromWeb: () => { if (planApprovalResolver) { planApprovalResolver(false); planApprovalResolver = null; } },
  };

  if (!skipWelcome) renderWelcomeAnimation(currentProvider, currentModel);

  let rl: readline.Interface | null = null;
  let currentAbortController: AbortController | null = null;
  let processing = false;
  let commandInProgress = false;
  let lastPastedContent = '';
  let isProgrammaticClose = false;
  // v3.9.3: Typeahead — chars typed while AI processes
  let typeaheadBuffer = '';
  // v3.9.3: Paste debounce — batch rapid 'line' events from paste
  let _pendingLines: string[] = [];
  let _lineFlushTimer: ReturnType<typeof setTimeout> | null = null;
  // v3.9.2: Vim mode handler (başlangıçta null, rl oluşturulunca init edilir)
  let vimHandler: ReturnType<typeof createVimHandler> | null = null;
  // v3.9.2: Keybindinglar
  const keybindings = loadKeybindings();

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
      const planModePrompt = isPlanModeEnabled()
        ? 'PLAN MODU AKTİF: Her karmaşık veya çok adımlı görev için önce enter_plan_mode aracını çağır, planını yaz, sonra exit_plan_mode ile kullanıcıya sun. Kullanıcı onayı olmadan dosya değiştirme veya komut çalıştırma.'
        : '';

      const loopOptions: AgentLoopOptions = {
        provider, model: currentModel, systemPrompt: planModePrompt,
        toolRegistry, toolExecutor,
        maxTurns: appConfig.agent.maxTurns,
        maxTokens: appConfig.agent.maxTokens,
        cwd: currentCwd, debug: appConfig.debug,
        effort: currentEffort,
        thinkingEnabled: currentProvider === 'deepseek' ? deepseekThinking : undefined,
        reasoningEffort: currentProvider === 'deepseek' && deepseekThinking
          ? (currentEffort === 'max' ? 'max' : 'high')
          : undefined,
        abortSignal: controller.signal,
        maxConcurrentTools: currentMaxConcurrentTools,
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
        onTruncation: (toolName) => {
          process.stdout.write(chalk.yellow(`\n  ⚠ Araç çıktısı kesildi (${toolName}) — daha küçük sorgu deneyin\n`));
          webUIController.sendWarning(`Araç çıktısı kesildi: ${toolName}`, toolName);
        },
      };

      const result = await runAgentLoop(text, laneHistories[activeLane], loopOptions);

      // ─── Plan Onayı ──────────────────────────────────────────────────────────
      if (isPlanWaitingApproval()) {
        clearSpinner();
        const planText = getPlanModeState().planText;

        // Web UI'ya plan gönder
        webUIController.sendPlanProposal(planText);

        process.stdout.write(chalk.yellow('\n\n  ─── PLAN SUNULDU ───\n'));
        process.stdout.write(chalk.dim('  Planı onaylıyor musunuz?\n'));

        const approved = await new Promise<boolean>(resolve => {
          planApprovalResolver = resolve;
          rl?.question(chalk.yellow('  [O]nayla / [R]eddet: '), (answer) => {
            planApprovalResolver = null;
            resolve(answer.trim().toLowerCase().startsWith('o') || answer.trim().toLowerCase() === 'y' || answer.trim() === '');
          });
        });

        if (approved) {
          approvePlan();
          process.stdout.write(chalk.green('  ✓ Plan onaylandı, uygulanıyor...\n\n'));
          webUIController.sendCommandResult('✓ Plan onaylandı.');
          // Planı uygula — aynı fonksiyonu tekrar çağır
          processing = false;
          await runAgentTurn(`Planı uygula (kullanıcı onayladı):\n\n${planText}`);
          return;
        } else {
          rejectPlan();
          process.stdout.write(chalk.red('  Plan reddedildi.\n'));
          webUIController.sendCommandResult('Plan reddedildi.');
          processing = false;
          currentAbortController = null;
          webUIController.sendStatus('idle', false);
          if (rl) rl.prompt();
          return;
        }
      }

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
      // v3.9.3: Restore typeahead chars typed during AI processing
      if (typeaheadBuffer && rl) {
        const buf = typeaheadBuffer;
        typeaheadBuffer = '';
        rl.prompt();
        rl.write(buf);
      } else {
        if (rl) rl.prompt();
      }
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

    // v3.9.2: Vim mode handler'ı başlat
    if (appConfig.repl?.vimMode) {
      vimHandler = createVimHandler(rl);
    }

    // v3.9.3: Bracketed paste mode — terminal marker gönder
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004h');

    // v3.9.3: _ttyWrite override — paste, PTY yönlendirme, AI işlenirken yankı bastırma
    // readline'ın dahili _ttyWrite'ını sarmalayarak tüm terminal girişini tek noktada kontrol ediyoruz.
    {
      const _origTtyWrite = (rl as any)._ttyWrite?.bind(rl);
      let _pasteMode = false;
      let _pasteBuffer = '';

      function _handlePaste(text: string) {
        if (!text) return;
        const clean = text.replace(/\r\n|\r|\n/g, ' ').trimEnd();
        if (processing) {
          typeaheadBuffer += clean;
        } else if (rl) {
          rl.write(clean);
        }
      }

      if (_origTtyWrite) {
        (rl as any)._ttyWrite = function(s: string, key: any) {
          // PTY mod: stdin'i PTY'ye yönlendir (sudo, ssh vb.)
          if (ptyModeActive && ptyInputWriter) {
            ptyInputWriter(s ?? key?.sequence ?? '');
            return;
          }
          // Bracketed paste başlangıç markeri
          if (key?.sequence === '\x1b[200~') {
            _pasteMode = true; _pasteBuffer = ''; return;
          }
          // Bracketed paste bitiş markeri
          if (key?.sequence === '\x1b[201~') {
            _pasteMode = false; _handlePaste(_pasteBuffer); return;
          }
          // Paste içeriği: tampona ekle, readline'a gösterme
          if (_pasteMode) {
            _pasteBuffer += s ?? key?.sequence ?? ''; return;
          }
          // AI işlenirken ya da slash komut çalışırken: yankıyı bastır
          if (processing || commandInProgress) return;
          // Normal: readline'ın orijinal işleyicisi
          return _origTtyWrite(s, key);
        };
      }
    }

    rl.on('line', async (line) => {
      if (processing || commandInProgress) return;

      // v3.9.3: Batch rapid lines (paste debounce — 20 ms window)
      _pendingLines.push(line);
      if (_lineFlushTimer) clearTimeout(_lineFlushTimer);
      _lineFlushTimer = setTimeout(async () => {
        _lineFlushTimer = null;
        const lines = _pendingLines;
        _pendingLines = [];
        const combined = lines.join('\n');
        const trimmed = combined.trim();
        if (!trimmed) { rl?.prompt(); return; }

        // v3.9.3: Drag-and-drop file path detection
        // Terminal drag-drop pastes the path; if the whole input is just a path, intercept it
        if (lines.length === 1) {
          const stripped = trimmed.replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
          if (/^(?:\/|~\/|\.\.?\/)[\S]+$/.test(stripped)) {
            const resolved = stripped.startsWith('~/')
              ? pathJoin(homedir(), stripped.slice(2))
              : stripped.startsWith('/') ? stripped : pathJoin(currentCwd, stripped);
            if (existsSync(resolved)) {
              process.stdout.write(
                '\n' + chalk.dim('  📎 Sürüklenen dosya: ') + chalk.cyan(resolved) +
                chalk.dim('\n  Yolu komutunuza ekleyebilirsiniz:\n\n'),
              );
              rl?.write(null, { ctrl: true, name: 'u' });
              rl?.write(resolved);
              rl?.prompt();
              return;
            }
          }
        }

        if (trimmed.startsWith('/')) {
          commandInProgress = true;
          if (_lineFlushTimer) {
            clearTimeout(_lineFlushTimer);
            _lineFlushTimer = null;
          }
          _pendingLines = [];
          rl?.pause();                    // clack prompts öncesi readline'ı durdur
          try {
            const result = await executeCommand(trimmed, ctx);
            process.stdin.resume();         // clack stdin'i kapattıysa geri aç
            rl?.resume();                   // readline'ı yeniden etkinleştir
            if (result?.clearTerminal) console.clear();
            if (result?.output) console.log(result.output);
            if (result?.shouldExit) process.exit(0);
            if (result?.runAsUserMessage) {
              await runAgentTurn(result.runAsUserMessage);
            } else {
              if (rl) rl.prompt();
            }
          } finally {
            commandInProgress = false;
          }
        } else {
          await runAgentTurn(trimmed);
        }
      }, 20);
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
      if (!key) return;

      // v3.9.3: Bracketed paste markers — ignore (debounce handles multi-line paste)
      if (key.sequence === '\x1b[200~' || key.sequence === '\x1b[201~') return;

      // v3.9.3: ESC during AI processing → abort
      if (key.name === 'escape' && processing) {
        currentAbortController?.abort();
        process.stdout.write('\n' + chalk.yellow('  ⏹  Durduruluyor…\n'));
        return;
      }

      // v3.9.3: Typeahead — silently collect printable keys while AI processes
      if (processing) {
        if (!key.ctrl && !key.meta) {
          if (key.name === 'backspace') {
            typeaheadBuffer = typeaheadBuffer.slice(0, -1);
          } else if (_str && _str.length === 1 && _str >= ' ') {
            typeaheadBuffer += _str;
          }
        }
        return;
      }

      // v3.9.2: Vim mode — önce vim handler'a ver
      if (vimHandler && appConfig.repl?.vimMode) {
        const consumed = vimHandler.handleKey(_str, key);
        // Prompt'u güncelle (vim mode göstergesi için)
        if (rl) rl.setPrompt(getPromptStr());
        if (consumed) return;
      }

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

  // v3.9.3: Startup güncelleme kontrolü (non-blocking, 24 saatte bir)
  void (async () => {
    try {
      const { checkForUpdates } = await import('./update-check.js');
      const update = await checkForUpdates();
      if (!update?.hasUpdate || !rl) return;

      // Hoş geldin ekranı tamamen yerleşsin diye kısa bekleme
      await new Promise(r => setTimeout(r, 300));
      if (processing) return; // Kullanıcı zaten bir şeyler yapıyor

      process.stdout.write(
        '\n' +
        chalk.yellow(`  ⬆  Yeni sürüm: v${update.latestVersion}`) +
        chalk.dim(' — şu an kurulu: ') + chalk.dim(`v${(await import('./version.js')).VERSION}`) +
        '\n',
      );

      await new Promise<void>(resolve => {
        rl!.question(chalk.dim('  GitHub\'dan güncellemek ister misiniz? [E/h] '), (answer) => {
          const yes = answer.trim() === '' || answer.trim().toLowerCase() === 'e';
          if (yes) {
            process.stdout.write(chalk.dim('\n  Çalıştırılıyor: npm install -g seth\n\n'));
            const child = spawn('npm', ['install', '-g', 'github:MustafaKemal0146/seth'], { stdio: 'inherit' });
            child.on('close', (code) => {
              if (code === 0) {
                process.stdout.write(chalk.green('\n  ✓ Güncelleme tamamlandı! Yeniden başlatın: seth\n\n'));
              } else {
                process.stdout.write(chalk.red('\n  ✗ Güncelleme başarısız. Manuel: npm install -g seth\n\n'));
              }
              if (rl && !processing) rl.prompt();
              resolve();
            });
            child.on('error', () => {
              process.stdout.write(chalk.red('\n  ✗ npm bulunamadı. Manuel: npm install -g seth\n\n'));
              if (rl && !processing) rl.prompt();
              resolve();
            });
          } else {
            if (rl && !processing) rl.prompt();
            resolve();
          }
        });
      });
    } catch {
      // Hata durumunda sessizce devam et
    }
  })();
}
