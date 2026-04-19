/**
/**
 * @fileoverview SETH REPL — readline tabanlı etkileşimli terminal arayüzü.
 *
 * - Spinner, ToolCall, ToolResult, StatsBar, ContextBar
 * - Plan modu onay akışı
 * - Alt-ajan derinlik göstergesi
 * - Otomatik context %80 uyarısı
 */

import * as readline from 'readline';
import { join as pathJoin, resolve as pathResolve } from 'path';
import { homedir } from 'os';
import { statSync } from 'fs';
import type {
  LLMProvider,
  ProviderName,
  ChatMessage,
  SETHConfig,
  TokenUsage,
  PermissionLevel,
  ThinkingStyle,
} from './types.js';
import { createProvider } from './providers/base.js';
import { createDefaultRegistry, ToolRegistry } from './tools/registry.js';
import { setAgentSessionContext } from './session-runtime.js';
import { buildSystemPrompt } from './project-instructions.js';
import { ToolExecutor } from './tools/executor.js';
import { runAgentLoop } from './agent/loop.js';
import {
  createSession,
  saveSession,
  saveSessionBackup,
  updateSessionMessages,
  loadSession,
} from './storage/session.js';
import {
  resolveModel,
  loadConfig,
  saveConfig,
  persistModelForProvider,
  persistProviderAndModel,
  getEffectiveContextBudgetTokens,
} from './config/settings.js';
import { executeCommand } from './commands.js';
import type { CommandContext } from './commands.js';
import {
  renderToolCall,
  renderToolResult,
  renderError,
  renderStats,
  renderMarkdown,
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
import chalk from 'chalk';
import { cmd, promptBright } from './theme.js';
import { loadHistory, addToHistory, storePaste } from './storage/history.js';
import { runHistorySearch } from './history-search.js';
import { runHooks } from './hooks.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolEvent {
  type: 'call' | 'result';
  name: string;
  detail: string;
  isError?: boolean;
  timestamp: number;
}

interface AgentRunState {
  processing: boolean;
  thinking: boolean;
  thinkingText: string;
  currentTool: string | null;
  toolEvents: ToolEvent[];
  streamingText: string;
  planWaiting: boolean;
  planText: string;
  subAgentDepth: number;
  turns: number;
  maxTurns: number;
}

// ─── Read prompt from stdin using readline ────────────────────────────────────
// Ink handles the UI but we still use readline for the actual input

export async function startRepl(configOverrides?: Partial<SETHConfig>, skipWelcome = false, resumeSessionId?: string, userEmail?: string): Promise<void> {
  let appConfig = loadConfig(configOverrides);
  
  // Temayı yükle
  const { setTheme } = await import('./theme.js');
  if (appConfig.theme) {
    setTheme(appConfig.theme as any);
  }

  // Graceful shutdown kur
  const { setupGracefulShutdown, startBackgroundCleanup } = await import('./lifecycle.js');
  setupGracefulShutdown();
  void startBackgroundCleanup(pathJoin(homedir(), '.seth', 'sessions'));

  // Env doğrulama
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && !anthropicKey.startsWith('sk-ant-')) {
    console.warn(chalk.yellow('  ⚠ ANTHROPIC_API_KEY formatı geçersiz görünüyor (sk-ant- ile başlamalı)'));
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && !openaiKey.startsWith('sk-')) {
    console.warn(chalk.yellow('  ⚠ OPENAI_API_KEY formatı geçersiz görünüyor (sk- ile başlamalı)'));
  }

  let currentProvider: ProviderName = appConfig.defaultProvider;
  let currentModel = resolveModel(currentProvider, appConfig);
  let toolsEnabled = true;
  let agentEnabled = appConfig.agent.enabled;
  let provider: LLMProvider;
  let totalTurns = 0;

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

  // #10 Crash recovery kontrolü
  const recovery = checkRecovery();
  if (recovery && recovery.messageCount > 0 && recovery.sessionId) {
    const loaded = loadSession(recovery.sessionId);
    if (loaded && loaded.messages.length > 0) {
      const title = recovery.title || loaded.messages[0] && typeof loaded.messages[0].content === 'string'
        ? (loaded.messages[0].content as string).slice(0, 50)
        : 'önceki oturum';
      console.log(chalk.yellow(`\n  ⚡ Kurtarılabilir oturum bulundu: "${title}" (${recovery.messageCount} mesaj)`));
      console.log(chalk.dim(`  Devam etmek için: /geçmiş ${recovery.sessionId.slice(0, 8)}\n`));
    }
  }
  setAgentSessionContext(session.id);
  const laneHistories = { a: [] as ChatMessage[], b: [] as ChatMessage[] };
  let activeLane: 'a' | 'b' = 'a';
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let currentCwd = process.cwd();

  // ─── Oturum yükleme ──────────────────────────────────────────────────────────
  if (resumeSessionId) {
    const loaded = loadSession(resumeSessionId);
    if (loaded) {
      session = loaded;
      laneHistories.a = [...(loaded.messages ?? [])];
      laneHistories.b = [...(loaded.messagesLaneB ?? [])];
      activeLane = loaded.activeLane ?? 'a';
      totalUsage = loaded.tokenUsage ?? { inputTokens: 0, outputTokens: 0 };
      currentProvider = loaded.provider;
      currentModel = loaded.model;
      try { provider = await createProvider(currentProvider, appConfig); } catch { /* mevcut provider'ı koru */ }
      setAgentSessionContext(session.id);
      console.log(chalk.green(`✓ Oturum yüklendi: ${session.id.slice(0, 8)}… (${laneHistories.a.length} mesaj)`));
    } else {
      console.error(chalk.red(`✗ Oturum bulunamadı: ${resumeSessionId}`));
    }
  }

  // Track shared agent context for sub-agents
  setSharedAgentContext(provider, currentModel, currentCwd);

  // ─── Welcome ────────────────────────────────────────────────────────────────
  if (!skipWelcome) renderWelcomeAnimation(currentProvider, currentModel);

  // ─── Readline setup ──────────────────────────────────────────────────────────
  let rl: readline.Interface | null = null;
  let currentAbortController: AbortController | null = null;
  let processing = false;
  let compactWarned = false; // #5 readonly session'a yazmak yerine ayrı değişken

  function getPromptStr(): string {
    const cur = laneHistories[activeLane];
    const userMsgs = cur.filter(m => m.role === 'user').length;
    const cumTokens = totalUsage.inputTokens + totalUsage.outputTokens;
    const budget = getEffectiveContextBudgetTokens(appConfig);

    const pct = budget > 0 ? Math.round((cumTokens / budget) * 100) : 0;
    const tokenStr = cumTokens >= 1000 ? `${(cumTokens / 1000).toFixed(1)}k` : `${cumTokens}`;
    const budgetStr = budget >= 1000 ? `${(budget / 1000).toFixed(0)}k` : `${budget}`;
    const pctColor = pct > 85 ? chalk.red : pct > 60 ? chalk.yellow : chalk.dim;
    const barFilled = Math.round(pct / 10);
    const bar = '█'.repeat(barFilled) + '░'.repeat(10 - barFilled);
    const effortStr = appConfig.effort && appConfig.effort !== 'medium' ? chalk.dim(`·${appConfig.effort}`) : '';

    const promptSym = promptBright('>');

    if (userMsgs > 0 || cumTokens > 0) {
      const lanePart = activeLane !== 'a' ? `${activeLane.toUpperCase()}·` : '';
      const info = chalk.dim(`[${lanePart}${userMsgs}msg·${tokenStr}/${budgetStr}]`);
      const ctxBar = pct > 0 ? ` ${pctColor(bar)}${chalk.dim(` ${pct}%`)}` : '';
      const effortPart = appConfig.effort && appConfig.effort !== 'medium' ? chalk.dim(` ·${appConfig.effort}`) : '';
      return `${info}${ctxBar}${effortPart}\n${promptSym} `;
    }
    return `${promptSym} `;
  }

  // ─── Command context ─────────────────────────────────────────────────────────
  const ctx: CommandContext = {
    get config() { return appConfig; },
    currentProvider,
    currentModel,
    toolsEnabled,
    agentEnabled,

    setProvider: async (name: ProviderName) => {
      provider = await createProvider(name, appConfig);
      currentProvider = name;
      ctx.currentProvider = name;
      currentModel = resolveModel(name, appConfig);
      ctx.currentModel = currentModel;
      setSharedAgentContext(provider, currentModel, currentCwd);
      persistProviderAndModel(name, currentModel);
      if (rl) rl.setPrompt(getPromptStr());
    },

    setModel: (model: string) => {
      currentModel = model;
      ctx.currentModel = model;
      setSharedAgentContext(provider, model, currentCwd);
      persistModelForProvider(currentProvider, model);
      if (rl) rl.setPrompt(getPromptStr());
    },

    setToolsEnabled: (enabled: boolean) => { toolsEnabled = enabled; ctx.toolsEnabled = enabled; },
    setAgentEnabled: (enabled: boolean) => { agentEnabled = enabled; ctx.agentEnabled = enabled; },

    clearHistory: (scope: 'active' | 'all' = 'active') => {
      const snap = { ...session, messages: laneHistories.a, messagesLaneB: laneHistories.b, activeLane };
      if (laneHistories.a.length > 0 || laneHistories.b.length > 0) saveSessionBackup(snap);
      if (scope === 'all') {
        laneHistories.a = []; laneHistories.b = [];
        totalUsage = { inputTokens: 0, outputTokens: 0 };
        totalTurns = 0;
        session = createSession(currentProvider, currentModel);
        setAgentSessionContext(session.id);
      } else {
        laneHistories[activeLane] = [];
      }
      if (rl) rl.setPrompt(getPromptStr());
    },

    compactHistory: async () => {
      const h = laneHistories[activeLane];
      const keepLast = 8;
      if (h.length < keepLast + 2) return null;
      
      // Özetlenecek mesajları al
      const toSummarize = h.slice(0, -keepLast);
      const toKeep = h.slice(-keepLast);
      
      try {
        // Özet oluştur
        const summaryPrompt = `Bu konuşmayı detaylı özetle. Şu başlıkları kullan:

## Yapılan İşler
- Hangi dosyalar değişti/okundu
- Hangi komutlar çalıştırıldı

## Alınan Kararlar  
- Hangi yaklaşım seçildi
- Neden bu yol tercih edildi

## Mevcut Durum
- Projenin şu anki hali
- Açık sorunlar/eksikler

## Devam Edilecekler
- Sonraki adımlar
- Bekleyen görevler

Kısa tutma ama önemli detayları atlama.

Konuşma:
${toSummarize.map(m => `${m.role}: ${m.content}`).join('\n\n')}`;

        const summaryResponse = await provider.chat([
          { role: 'user', content: summaryPrompt }
        ], { model: currentModel, tools: [] });
        
        const summary = summaryResponse.content || 'Özet oluşturulamadı.';
        
        // Yeni geçmiş: özet + son mesajlar
        laneHistories[activeLane] = [
          { role: 'user', content: `[KOMPAKT ÖZET]\n\n${summary}` },
          { role: 'assistant', content: 'Özet kaydedildi, devam ediyoruz.' },
          ...toKeep,
        ];
        
        return { before: h.length, after: laneHistories[activeLane].length };
      } catch (err) {
        // Hata durumunda eski yöntemi kullan
        laneHistories[activeLane] = [
          { role: 'user', content: '[Önceki mesajlar sıkıştırıldı]' },
          { role: 'assistant', content: 'Bağlam güncellendi.' },
          ...toKeep,
        ];
        return { before: h.length, after: laneHistories[activeLane].length };
      }
    },

    undoHistory: () => {
      if (laneHistories[activeLane].length < 2) return false;
      laneHistories[activeLane] = laneHistories[activeLane].slice(0, -2);
      if (rl) rl.setPrompt(getPromptStr());
      return true;
    },

    changeCwd: (dir: string) => {
      try {
        const target = pathResolve(currentCwd, dir);
        statSync(target);
        currentCwd = target;
        process.chdir(target);
        setSharedAgentContext(provider, currentModel, currentCwd);
        return target;
      } catch { return null; }
    },

    getCwd: () => currentCwd,
    getHistory: () => laneHistories[activeLane],
    getPermissionLevel: () => toolExecutor.getPermissionLevel(),
    setPermissionLevel: (level: PermissionLevel) => toolExecutor.setPermissionLevel(level),
    getStats: () => ({
      messages: laneHistories[activeLane].length,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      turns: totalTurns,
    }),
    getSessionId: () => session.id,
    getMessages: () => laneHistories[activeLane],
    setThinkingStyle: (style: ThinkingStyle) => {
      saveConfig({ repl: { thinkingStyle: style } });
      appConfig = loadConfig(configOverrides);
    },
    setVimMode: (enabled: boolean) => {
      const currentRepl = appConfig.repl || {};
      const newRepl = { ...currentRepl, vimMode: enabled };
      saveConfig({ repl: newRepl });
      appConfig = loadConfig(configOverrides);
      if (rl) rl.setPrompt(getPromptStr());
    },
    getContextBudgetTokens: () => getEffectiveContextBudgetTokens(appConfig),
    setContextBudgetTokens: (n: number) => {
      saveConfig({ contextBudgetTokens: n });
      appConfig = loadConfig(configOverrides);
      if (rl) rl.setPrompt(getPromptStr());
    },
    getActiveLane: () => activeLane,
    setActiveLane: (lane: 'a' | 'b') => {
      activeLane = lane;
      if (rl) rl.setPrompt(getPromptStr());
    },
  };

  // ─── Plan approval (non-Ink, readline-based) ─────────────────────────────────
  async function askPlanApproval(planText: string): Promise<boolean> {
    console.log('\n' + chalk.yellow.bold('  📋 AJAN PLANI'));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log('\n' + planText.split('\n').map(l => '  ' + l).join('\n'));
    console.log('\n' + chalk.dim('  ' + '─'.repeat(50)));
    console.log(
      chalk.dim('  Planı onayla → ') +
      chalk.green.bold('[E]vet') +
      chalk.dim(' / Reddet → ') +
      chalk.red.bold('[H]ayır') +
      chalk.dim(' / Düzenle → ') +
      chalk.yellow.bold('[D]üzenle') +
      '\n',
    );

    return new Promise<boolean>((resolve) => {
      const wasRaw = (process.stdin as NodeJS.ReadStream).isRaw;
      if ((process.stdin as NodeJS.ReadStream).isTTY) {
        (process.stdin as NodeJS.ReadStream).setRawMode(true);
      }
      process.stdin.resume();

      const onData = (buf: Buffer) => {
        const key = buf.toString().toLowerCase().trim();
        process.stdin.removeListener('data', onData);
        if ((process.stdin as NodeJS.ReadStream).isTTY) {
          (process.stdin as NodeJS.ReadStream).setRawMode(wasRaw);
        }
        if (key === 'e' || key === 'y' || key === '\r' || key === '\n') {
          process.stdout.write(chalk.green('  ✓ Plan onaylandı.\n\n'));
          resolve(true);
        } else {
          process.stdout.write(chalk.red('  ✗ Plan reddedildi. Ajan durdu.\n\n'));
          resolve(false);
        }
      };
      process.stdin.on('data', onData);
    });
  }

  // ─── Agent turn ───────────────────────────────────────────────────────────────
  async function runAgentTurn(finalInput: string): Promise<void> {
    sethLog('Ajan turu yürütme');
    const turnStart = Date.now();
    // Terminal başlığını "işleniyor" olarak güncelle
    process.stdout.write(`\x1b]0;⏳ SETH — İşleniyor...\x07`);
    const spinOpts = { thinkingMode: appConfig.repl?.thinkingStyle ?? 'minimal' };
    const stream = createReplStreamingController({
      streamMode: resolveStreamMode(appConfig.repl?.streamMode),
      hideIncompleteLine: appConfig.repl?.streamHideIncompleteLine !== false,
      throttleMs: appConfig.repl?.streamThrottleMs ?? 24,
      renderMarkdown,
    });

    // Kullanıcı mesajını gri arka planla vurgula
    {
      const cols = process.stdout.columns || 80;
      const lines2 = finalInput.split('\n');
      const sym = getPromptStr().replace(/\n/g, '');
      process.stdout.write(`\x1b[${lines2.length}A\x1b[0J`);
      lines2.forEach((ln, i) => {
        const padded = ((i === 0 ? sym + ' ' : '  ') + ln).padEnd(cols);
        process.stdout.write(chalk.bgHex('#2a2a2a').white(padded) + '\n');
      });
    }
    // Context budget check
    const budget = getEffectiveContextBudgetTokens(appConfig);
    const cumTokens = totalUsage.inputTokens + totalUsage.outputTokens;
    const pct = budget > 0 ? (cumTokens / budget) * 100 : 0;
    
    if (budget > 0 && pct > 95) {
      console.log(chalk.yellow(`\n  ⚠️  Context sınırına yaklaştınız (%${pct.toFixed(0)} dolu)`));
      const { confirm } = await import('@clack/prompts');
      const shouldCompress = await confirm({ message: 'Sıkıştırma yapılsın mı?' });
      
      if (shouldCompress) {
        const compacted = await ctx.compactHistory();
        if (compacted) {
          console.log(chalk.green(`\n  ✓ Context sıkıştırıldı (${compacted.before} -> ${compacted.after} mesaj), devam ediyoruz...\n`));
        }
      } else if (pct > 110) {
        console.log(chalk.red(`\n  ⚠️  Context sınırı aşıldı! Sadece /sıkıştır komutu kullanılabilir.\n`));
        createInterface();
        return;
      }
    }

    // Cevap ile spinner arasında 1 satır boşluk
    process.stdout.write('\n');

    // #6 İlk mesajda oturum başlığı üret (arka planda)
    if (laneHistories[activeLane].length === 0 && !(session as { title?: string }).title) {
      generateSessionTitle(finalInput, provider, currentModel).then(title => {
        session = { ...session, title } as typeof session;
        saveSession(session); // başlığı dosyaya kaydet
      }).catch(() => {});
    }

    startSpinner('Düşünüyor…', true, { thinkingMode: spinOpts.thinkingMode });

    let didClearSpinner = false;
    function clearSpin() {
      if (!didClearSpinner) {
        clearSpinner();
        didClearSpinner = true;
      }
    }

    currentAbortController = new AbortController();
    resetPlanModeState();

    try {
      const systemPrompt = buildSystemPrompt(currentCwd);
      // #18 Otomatik belleği sistem promptuna ekle
      let fullSystemPrompt = systemPrompt;
      try {
        const { loadAutoMemories } = await import('./auto-memory.js');
        const autoMem = loadAutoMemories(3);
        if (autoMem.trim()) {
          fullSystemPrompt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nOTOMATİK BELLEK\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${autoMem}\n`;
        }
      } catch { /* otomatik bellek yoksa atla */ }
      // #5 Skills
      try {
        const { loadSkills, formatSkillsForPrompt } = await import('./skills.js');
        const skills = loadSkills(currentCwd);
        if (skills.length > 0) fullSystemPrompt += formatSkillsForPrompt(skills);
      } catch { /* skills yoksa atla */ }
      const tools = toolsEnabled ? toolRegistry : new ToolRegistry();
      const executor = toolsEnabled ? toolExecutor : new ToolExecutor(tools, appConfig.tools, confirmFn);

      // Bind hooks to manage spinner during confirmation
      executor.onConfirmStart = () => {
        clearSpinner();
      };
      executor.onConfirmEnd = () => {
        startSpinner('Onaylandı, devam ediliyor…', false);
      };

      const result = await runAgentLoop(finalInput, laneHistories[activeLane], {
        provider,
        model: currentModel,
        systemPrompt: fullSystemPrompt,
        toolRegistry: tools,
        toolExecutor: executor,
        maxTurns: agentEnabled ? appConfig.agent.maxTurns : 1,
        maxTokens: getEffectiveContextBudgetTokens(appConfig),
        cwd: currentCwd,
        debug: appConfig.debug,
        abortSignal: currentAbortController.signal,
        effort: appConfig.effort ?? 'medium',
        // Fallback sağlayıcı — settings.json'da fallbackProvider tanımlıysa
        ...(appConfig.fallbackProvider && appConfig.fallbackProvider !== currentProvider ? {
          fallbackProvider: await createProvider(appConfig.fallbackProvider, appConfig).catch(() => undefined),
          fallbackModel: appConfig.fallbackModel,
        } : {}),

        onTurnStart: () => {
          stream.onTurnStart(finalInput);
          if (!didClearSpinner) {
            startSpinner('Düşünüyor…', true, { thinkingMode: spinOpts.thinkingMode });
          }
        },

        onToolCall: (name, input) => {
          clearSpin();
          // Hook: PreToolUse
          runHooks('PreToolUse', name, { tool: name, input: JSON.stringify(input).slice(0, 200) });
          // #1 JIT Context — dosya/dizin araçlarında alt dizin context'i yükle
          if (['file_read', 'file_write', 'file_edit', 'list_directory', 'batch_read'].includes(name)) {
            const accessedPath = String(input.path ?? (Array.isArray(input.paths) ? input.paths[0] : '') ?? '');
            if (accessedPath) {
              import('./jit-context.js').then(({ discoverJitContext }) => {
                const jit = discoverJitContext(accessedPath, currentCwd);
                if (jit) process.stderr.write(`[JIT] ${accessedPath.split('/').slice(-2).join('/')}\n`);
              }).catch(() => {});
            }
          }
          // Check plan approval
          if (isPlanWaitingApproval()) {
            const ps = getPlanModeState();
            // Plan display happens via tool result output intercept below
            void (async () => {
              const approved = await askPlanApproval(ps.planText);
              if (approved) {
                approvePlan();
              } else {
                rejectPlan();
                currentAbortController?.abort();
              }
            })();
          }
          process.stdout.write(renderToolCall(name, input) + '\n');
          didClearSpinner = false;
          startSpinner(getToolSpinnerText(name, input), false);
        },

        onToolResult: (name, output, isError, data) => {
          clearSpin();
          // Hook: PostToolUse
          runHooks('PostToolUse', name, { tool: name, output: output.slice(0, 200), error: String(isError) });
          // If plan approval is in output, intercept
          if (output.startsWith('__PLAN_APPROVAL_REQUIRED__')) {
            const planText = output.replace('__PLAN_APPROVAL_REQUIRED__\n', '');
            void (async () => {
              const approved = await askPlanApproval(planText);
              if (approved) {
                approvePlan();
                // Resume processing
                didClearSpinner = false;
                startSpinner('Plan uygulanıyor…', false);
              } else {
                rejectPlan();
                currentAbortController?.abort();
              }
            })();
            return;
          }
          process.stdout.write(renderToolResult(name, output, isError, data) + '\n');
          didClearSpinner = false;
          startSpinner('Yanıtlanıyor…', true, { thinkingMode: spinOpts.thinkingMode });
        },

        onText: (text) => {
          clearSpin();
          stream.onText(text, () => {});
        },
      });

      // Finalize CWD changes
      for (const call of result.toolCalls) {
        if (call.newCwd) {
          currentCwd = call.newCwd;
          try { process.chdir(currentCwd); } catch {}
          setSharedAgentContext(provider, currentModel, currentCwd);
        }
      }

      clearSpin();
      stream.finalize(finalInput, result.finalText.trim(), stripLeadingUserEchoFromAssistantDisplay);
      // #15 AI yanıtını kaydet
      if (result.finalText.trim()) {
        recordMessage(session.id, { role: 'assistant', content: result.finalText.trim() }, result.totalUsage.outputTokens);
      }

      if (result.finalText.trim() && !stream.skipFinalMarkdown) {
        const forDisplay = stripLeadingUserEchoFromAssistantDisplay(result.finalText.trim(), finalInput);
        if (forDisplay.trim()) {
          console.log('\n' + renderMarkdown(forDisplay));
        }
      }

      // Stats + context bar
      const totalCum = totalUsage.inputTokens + result.totalUsage.inputTokens +
        totalUsage.outputTokens + result.totalUsage.outputTokens;
      const budgetNow = getEffectiveContextBudgetTokens(appConfig);
      const pct = budgetNow > 0 ? Math.round((totalCum / budgetNow) * 100) : 0;
      const barFilled = Math.round(pct / 5);
      const bar = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);
      const barColor = pct > 85 ? chalk.red : pct > 60 ? chalk.yellow : chalk.green;

      const statsLine = renderStats(result.totalUsage.inputTokens, result.totalUsage.outputTokens, result.turns);
      if (statsLine) {
        const ctxLine = budgetNow > 0
          ? chalk.dim('  ') + barColor(bar) + chalk.dim(` ${pct}%`)
          : '';
        console.log(statsLine + (ctxLine ? '  ' + ctxLine : ''));
      }
      console.log('');

      // Update state
      laneHistories[activeLane] = result.messages;
      totalUsage = {
        inputTokens: totalUsage.inputTokens + result.totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens + result.totalUsage.outputTokens,
      };
      totalTurns += result.turns;
      session = updateSessionMessages(session, laneHistories.a, laneHistories.b, activeLane, result.totalUsage);
      saveSession(session);
      writeRecoveryCheckpoint(session); // #10 crash recovery

      // #14 Otomatik sıkıştırma önerisi — %80 dolunca bir kez uyar
      const newTotalCum = totalUsage.inputTokens + totalUsage.outputTokens;
      const newBudget = getEffectiveContextBudgetTokens(appConfig);
      if (newBudget > 0 && newTotalCum / newBudget >= 0.80) {
        const alreadyWarned = compactWarned;
        if (!alreadyWarned) {
          compactWarned = true;
          console.log(chalk.yellow('\n  ⚠  Bağlam %80 doldu. /sıkıştır komutuyla token tasarrufu yapabilirsiniz.\n'));
        }
      }

      // #2 Rolling Summary — %75 dolunca otomatik özetle
      const rsTokens = totalUsage.inputTokens + totalUsage.outputTokens;
      const rsBudget = getEffectiveContextBudgetTokens(appConfig);
      if (rsBudget > 0 && rsTokens / rsBudget >= 0.75 && laneHistories[activeLane].length > 16) {
        import('./rolling-summary.js').then(({ applyRollingSummary }) => {
          applyRollingSummary(laneHistories[activeLane], rsTokens, rsBudget, provider, currentModel)
            .then(r => {
              if (r.summarized) {
                laneHistories[activeLane] = r.messages;
                console.log(chalk.dim(`\n  ↩ Kayan özet: ${r.before} → ${r.after} mesaj\n`));
              }
            }).catch(() => {});
        }).catch(() => {});
      }

      // #2 Otomatik bellek çıkarma — arka planda, sessizce
      if (result.messages.length >= 6) {
        import('./auto-memory.js').then(({ extractAndSaveMemories }) => {
          extractAndSaveMemories(result.messages, provider, currentModel, currentCwd).catch(() => {});
        }).catch(() => {});
      }

      // #12 Omission placeholder tespiti
      if (result.finalText) {
        import('./omission-detector.js').then(({ detectOmissionPlaceholder, getOmissionWarning }) => {
          if (detectOmissionPlaceholder(result.finalText)) {
            console.log(chalk.yellow(getOmissionWarning()));
          }
        }).catch(() => {});
      }

    } catch (err: any) {
      clearSpin();
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        console.log(chalk.red.bold('\n  ⚡ SETH: İşlem kullanıcı tarafından iptal edildi.\n'));
      } else {
        console.error(renderError(err instanceof Error ? err : new Error(String(err))));
      }
    } finally {
      currentAbortController = null;
      processing = false;
      resetPlanModeState();
      // Terminal başlığını geri yükle + süre bildirimi
      const elapsed = ((Date.now() - turnStart) / 1000).toFixed(1);
      const titleIcon = parseFloat(elapsed) > 10 ? '✓' : '●';
      process.stdout.write(`\x1b]0;${titleIcon} SETH — ${elapsed}s\x07`);
      // 30 saniyeden uzun işlemlerde görünür bildirim
      if (parseFloat(elapsed) > 30) {
        process.stdout.write(`\n${chalk.green(`  ✓ Tamamlandı (${elapsed}s)`)}\n`);
      }
      if (rl) {
        rl.setPrompt(getPromptStr());
        rl.prompt();
      }
    }
  }

  // ─── REPL Loop ────────────────────────────────────────────────────────────────
  function createInterface() {
    // #7 Tab tamamlama — slash komutları + geçmiş önerileri
    const completer = (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
      const slashCmds = [
        '/yardım', '/istatistikler', '/bağlam', '/ara', '/oturum-ara', '/doktor',
        '/güncelle', '/diff', '/sağlayıcı', '/model', '/modeller', '/değiştir',
        '/hafıza', '/bellek', '/sıkıştır', '/geri', '/temizle', '/kaydet',
        '/export', '/oturum-export', '/oturum-import', '/geçmiş', '/tema',
        '/context', '/yetki', '/apikey', '/araçlar', '/ajan', '/cron',
        '/worktree', '/mcp-keşif', '/yapıştır', '/hook', '/rapor', '/cd', '/pwd',
        '/effort', '/cikis',
      ];
      if (line.startsWith('/')) {
        const hits = slashCmds.filter(c => c.startsWith(line));
        const results = hits.length ? hits : slashCmds;
        // Görsel öneri listesi — gemini-cli tarzı
        if (results.length > 1 && results.length <= 12) {
          process.stdout.write('\n' + chalk.dim(results.join('  ')) + '\n');
          rl?.prompt(true);
        }
        return callback(null, [results, line]);
      }
      // Geçmişten öneri — async import
      import('./prompt-suggestions.js').then(({ getPromptSuggestions }) => {
        const suggestions = getPromptSuggestions(line);
        if (suggestions.length > 0 && suggestions.length <= 5) {
          process.stdout.write('\n' + chalk.dim(suggestions.map(s => s.slice(0, 60)).join('\n')) + '\n');
          rl?.prompt(true);
        }
        callback(null, [suggestions.length ? suggestions : [], line]);
      }).catch(() => callback(null, [[], line]));
    };

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: getPromptStr(),
      terminal: true,
      historySize: 500,
      completer,
    });
    // Kalıcı geçmişi yükle
    const persistedHistory = loadHistory();
    (rl as any).history = persistedHistory;
    setupListeners();
    process.stdout.write('\n');
    rl.prompt();
  }

  // ─── Responsive: terminal yeniden boyutlandırma ───────────────────────────────
  let resizeTimer: NodeJS.Timeout | null = null;
  process.stdout.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (processing) return;
      const cols = process.stdout.columns || 80;
      // Ekranı temizlemeden sadece prompt'u yeniden çiz
      if (rl) {
        rl.setPrompt(getPromptStr());
        process.stdout.write(`\r\x1b[K`); // satırı temizle
        (rl as any).prompt(true);
      }
      // Terminal başlığını güncelle
      process.stdout.write(`\x1b]0;SETH — ${cols}×${process.stdout.rows || 24}\x07`);
    }, 100);
  });

  function setupListeners() {
    if (!rl) return;
    let multilineBuffer = '';
    let bufferedLines: string[] = [];
    let lineTimer: NodeJS.Timeout | null = null;
    let isProgrammaticClose = false;
    let vimState: 'INSERT' | 'NORMAL' = 'INSERT';

    // Bracketed paste desteği — paste direkt göndermesin
    let pasteBuffer = '';
    let inPaste = false;
    let lastPastedContent = '';
    let pasteExpanded = false;
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?2004h');
    }
    const cleanupBracketedPaste = () => {
      if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
    };

    // Hız bazlı paste algılama değişkenleri (Ctrl+Shift+V için)
    let lastKeypressTime = 0;
    let rapidCharCount = 0;
    let rapidPasteTimer: NodeJS.Timeout | null = null;
    const RAPID_THRESHOLD_MS = 20;
    const RAPID_MIN_CHARS = 5;

    const renderVimStatus = () => {
      if (!appConfig.repl?.vimMode) return;
      const status = vimState === 'NORMAL' ? chalk.bgBlue.white(' NORMAL ') : chalk.bgGreen.black(' INSERT ');
      // Move to start of line, clear line, re-print prompt + status + line
      process.stdout.write(`\r\x1b[K${getPromptStr()}${status} ${rl?.line}`);
      // Restore cursor position
      if (rl) {
        const pos = rl.cursor + getPromptStr().length + 9; // 9 = length of " INSERT " or " NORMAL "
        process.stdout.write(`\x1b[${pos + 1}G`);
      }
    };

    const handleVimKey = (s: string, key: any) => {
      if (!appConfig.repl?.vimMode || processing) return false;
      
      if (key.name === 'escape') {
        vimState = 'NORMAL';
        renderVimStatus();
        return true;
      }

      if (vimState === 'NORMAL') {
        // INSERT moduna geçiş
        if (key.name === 'i') { vimState = 'INSERT'; renderVimStatus(); return true; }
        if (key.name === 'a') { vimState = 'INSERT'; if (rl) rl.write(null, { name: 'right' }); renderVimStatus(); return true; }
        if (s === 'A') { vimState = 'INSERT'; if (rl) rl.write(null, { name: 'end' }); renderVimStatus(); return true; }
        if (s === 'I') { vimState = 'INSERT'; if (rl) rl.write(null, { name: 'home' }); renderVimStatus(); return true; }
        if (s === 'o') { vimState = 'INSERT'; if (rl) { rl.write(null, { name: 'end' }); } renderVimStatus(); return true; }

        // Hareket
        if (key.name === 'h' || key.name === 'left')  { if (rl) rl.write(null, { name: 'left' }); renderVimStatus(); return true; }
        if (key.name === 'l' || key.name === 'right') { if (rl) rl.write(null, { name: 'right' }); renderVimStatus(); return true; }
        if (s === '0' || key.name === 'home') { if (rl) rl.write(null, { name: 'home' }); renderVimStatus(); return true; }
        if (s === '$' || key.name === 'end')  { if (rl) rl.write(null, { name: 'end' }); renderVimStatus(); return true; }

        // Kelime hareketi (w/b/e — readline'da ctrl+right/left ile simüle)
        if (s === 'w' || s === 'e') { if (rl) rl.write(null, { ctrl: true, name: 'right' }); renderVimStatus(); return true; }
        if (s === 'b')              { if (rl) rl.write(null, { ctrl: true, name: 'left' }); renderVimStatus(); return true; }

        // Silme
        if (key.name === 'x') { if (rl) rl.write(null, { name: 'delete' }); renderVimStatus(); return true; }
        if (s === 'D') { if (rl) rl.write(null, { ctrl: true, name: 'k' }); renderVimStatus(); return true; }
        // dd — satırı sil (ctrl+a sonra ctrl+k)
        if (s === 'd') {
          if (rl) { rl.write(null, { ctrl: true, name: 'a' }); rl.write(null, { ctrl: true, name: 'k' }); }
          renderVimStatus(); return true;
        }

        // Geçmiş (G = en son, gg = en eski)
        if (s === 'G') { if (rl) rl.write(null, { name: 'down' }); renderVimStatus(); return true; }
        if (s === 'g') { if (rl) rl.write(null, { name: 'up' }); renderVimStatus(); return true; }

        // yy — satırı kopyala (readline'da ctrl+a ctrl+k ile kes, sonra ctrl+y ile geri koy)
        if (s === 'y') {
          if (rl) {
            const line = rl.line;
            rl.write(null, { ctrl: true, name: 'a' });
            rl.write(null, { ctrl: true, name: 'k' });
            // Geri yaz (yank = kopyala, satırı koru)
            rl.write(line);
          }
          renderVimStatus(); return true;
        }
        if (s === 'p') { if (rl) rl.write(null, { ctrl: true, name: 'y' }); renderVimStatus(); return true; }

        // Diğer tuşları NORMAL modda yut
        return true;
      }
      return false;
    };

    // We need to intercept keypress to override readline behavior in NORMAL mode
    const onKeypress = (s: string, key: any) => {
      if (handleVimKey(s, key)) {
        // Intercepted by vim handler
        return;
      }
      // Bracketed paste — \x1b[200~ başlangıç, \x1b[201~ bitiş
      if (s === '\x1b[200~') { inPaste = true; pasteBuffer = ''; return; }
      if (s === '\x1b[201~') {
        inPaste = false;
        const pasted = pasteBuffer;
        pasteBuffer = '';
        if (!pasted.trim()) return;
        // Newline'ları boşlukla değiştir — line event tetiklenmesin
        // Çok satırlı paste'i tek satır olarak yaz
        const singleLine = pasted.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ').trim();
        lastPastedContent = pasted; // Orijinali sakla (Ctrl+O için)
        if (rl) {
          // Mevcut input'u temizle, paste'i yaz
          rl.write(null, { ctrl: true, name: 'u' }); // satırı temizle
          rl.write(singleLine);
        }
        return;
      }
      if (inPaste) { pasteBuffer += s; return; }

      // Ctrl+O — son paste içeriğini göster/gizle
      if (key?.ctrl && key?.name === 'o') {
        if (!lastPastedContent) return;
        pasteExpanded = !pasteExpanded;
        if (pasteExpanded) {
          process.stdout.write('\n' + chalk.dim('─'.repeat(50)) + '\n');
          process.stdout.write(chalk.dim(lastPastedContent));
          process.stdout.write('\n' + chalk.dim('─'.repeat(50)) + '\n');
        }
        if (rl) rl.prompt(true);
        return;
      }

      // Ctrl+Shift+V hız bazlı algılama — sadece lastPastedContent güncelle
      if (s && s.length === 1 && !key?.ctrl && !key?.meta) {
        const now = Date.now();
        const delta = now - lastKeypressTime;
        lastKeypressTime = now;
        if (delta < RAPID_THRESHOLD_MS) {
          rapidCharCount++;
          if (rapidPasteTimer) clearTimeout(rapidPasteTimer);
          rapidPasteTimer = setTimeout(() => {
            rapidPasteTimer = null;
            if (rapidCharCount >= RAPID_MIN_CHARS) {
              lastPastedContent = rl?.line ?? '';
            }
            rapidCharCount = 0;
          }, 50);
        } else {
          rapidCharCount = 1;
        }
      }

      // Esc → işlemi durdur (abort)
      if (key?.name === 'escape') {
        if (processing && currentAbortController) {
          currentAbortController.abort();
          process.stdout.write(chalk.red('\n  ⚡ Durduruldu (Esc)\n'));
          processing = false; // Hemen işareti sıfırla
          if (rl) { rl.setPrompt(getPromptStr()); rl.prompt(); }
          return;
        }
        // Vim normal mode'dan çık
        if (appConfig.repl?.vimMode && vimState === 'NORMAL') {
          vimState = 'INSERT';
          renderVimStatus();
        }
        return;
      }
      // Ctrl+R — geçmiş fuzzy arama
      if (key?.ctrl && key?.name === 'r' && !processing) {
        if (rl) { isProgrammaticClose = true; rl.close(); }
        runHistorySearch().then((selected) => {
          if (selected) {
            createInterface();
            // Seçilen komutu input'a yaz
            setTimeout(() => {
              if (rl) {
                rl.write(selected);
              }
            }, 50);
          } else {
            createInterface();
          }
        });
        return;
      }
      // Büyük paste algılama: 500+ karakter gelirse paste store'a yaz (sessizce)
      if (s && s.length > 500 && !processing) {
        storePaste(s);
      }
    };
    process.stdin.on('keypress', onKeypress);

    // ─── İşlem sırasında yazılan mesajı beklet ────────────────────────────────
    // NOT: AI çalışırken yazılan metin otomatik gönderilmez — kullanıcı beklemeli.

    rl.on('line', (line: string) => {
      // ─── AI çalışırken Enter → sadece uyar, gönderme ──────────────────────
      if (processing) {
        if (line.trim()) {
          process.stdout.write(chalk.dim(`  ⏸ AI çalışıyor, lütfen bekleyin… (Esc ile durdurabilirsiniz)\n`));
        }
        return;
      }

      // Paste devam ediyorsa gönderme
      if (inPaste) return;

      // Hızlı paste devam ediyorsa veya yeni bittiyse gönderme
      if (rapidPasteTimer !== null) return;
      if (rapidCharCount >= RAPID_MIN_CHARS) return;

      if (vimState === 'NORMAL') {
        rl?.prompt();
        return;
      }

      if (line.endsWith('\\')) {
        multilineBuffer += line.slice(0, -1) + '\n';
        process.stdout.write(chalk.dim('... '));
        return;
      }

      bufferedLines.push(line);
      if (lineTimer) clearTimeout(lineTimer);
      lineTimer = setTimeout(async () => {
        if (processing) return;
        const finalInput = multilineBuffer + bufferedLines.join('\n');
        bufferedLines = []; multilineBuffer = '';
        if (!finalInput.trim()) { if (rl) rl.prompt(); return; }

        if (finalInput.trim().startsWith('/')) {
          // ─── Format Command Input Display ──────────────────────────────────
          const displayPrompt = getPromptStr().replace(/^\n/, '');
          const linesToMoveUp = finalInput.split('\n').length;
          process.stdout.write(`\x1b[${linesToMoveUp}A\x1b[0J${displayPrompt}${finalInput}\n`);

          // Slash command
          // Close rl to free stdin for @clack/prompts, then recreate.
          if (rl) {
            isProgrammaticClose = true;
            rl.close();
          }
          try {
            const result = await executeCommand(finalInput, ctx);
            if (result?.output) console.log(result.output);
            if (result?.clearAndAnimate) {
              process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
              renderWelcomeAnimation(currentProvider, currentModel);
            }
            if (result?.runAsUserMessage) {
              // Oturum devam ettirme sinyali
              if ((result.runAsUserMessage as string).startsWith('__RESUME__')) {
                const sid = (result.runAsUserMessage as string).slice(10);
                const loaded = loadSession(sid);
                if (loaded) {
                  laneHistories.a = [...(loaded.messages ?? [])];
                  laneHistories.b = [...(loaded.messagesLaneB ?? [])];
                  activeLane = loaded.activeLane ?? 'a';
                  totalUsage = loaded.tokenUsage ?? { inputTokens: 0, outputTokens: 0 };
                  session = loaded;
                  setAgentSessionContext(session.id);
                  console.log(chalk.green(`✓ Oturum yüklendi: ${sid.slice(0, 8)}… (${laneHistories.a.length} mesaj)`));
                } else {
                  console.log(chalk.red(`✗ Oturum bulunamadı: ${sid}`));
                }
                createInterface();
                return;
              }
              createInterface();
              processing = true;
              await runAgentTurn(result.runAsUserMessage);
              return;
            }
            if (result?.shouldExit) process.exit(0);
          } catch (err) {
            console.error(renderError(err instanceof Error ? err : new Error(String(err))));
          }
          createInterface();
          return;
        }

        processing = true;
        addToHistory(finalInput);
        recordMessage(session.id, { role: 'user', content: finalInput }); // #15
        // rl.pause() KALDIRILDI — input alanı görünür kalsın
        await runAgentTurn(finalInput);
      }, 10);
    });

    rl.on('SIGINT', () => {
      if (currentAbortController) {
        currentAbortController.abort();
        processing = false;
        if (rl) { rl.setPrompt(getPromptStr()); rl.prompt(); }
        return;
      }
      if (multilineBuffer) {
        multilineBuffer = '';
        console.log(chalk.dim('  (İptal)'));
        if (rl) rl.prompt();
        return;
      }
      if (rl && rl.line.length > 0) {
        // clear line
        rl.write(null, { ctrl: true, name: 'u' });
        return;
      }
      console.log(chalk.dim('\n  Kapatılıyor...'));
      saveSession(updateSessionMessages(session, laneHistories.a, laneHistories.b, activeLane, { inputTokens: 0, outputTokens: 0 }));
      clearRecovery(); // #10 normal çıkışta recovery temizle
      console.log(chalk.dim(`  Devam etmek için: seth --devam ${session.id}`));
      process.exit(0);
    });

    rl.on('close', () => {
      process.stdin.removeListener('keypress', onKeypress);
      cleanupBracketedPaste();
      if (!isProgrammaticClose) {
        saveSession(updateSessionMessages(session, laneHistories.a, laneHistories.b, activeLane, { inputTokens: 0, outputTokens: 0 }));
        console.log(chalk.dim(`\n  Ctrl+D — çıkılıyor. Devam etmek için: seth --devam ${session.id}`));
        process.exit(0);
      }
    });
  }

  createInterface();
}

// ─── Helpers (renderer.ts'den bağımsız kopya — REPL'e özel) ──────────────────

function formatToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'shell': return String(input.command ?? '').slice(0, 72);
    case 'file_read':
    case 'file_write':
    case 'file_edit': return String(input.path ?? '');
    case 'search':
    case 'grep': return `"${input.query}" in ${input.dir ?? '.'}`;
    case 'list_directory': return String(input.path ?? '.');
    case 'glob': return String(input.pattern ?? '');
    case 'batch_read': return `${(input.paths as string[] | undefined)?.length ?? 0} dosya`;
    case 'web_ara': return String(input.sorgu ?? '');
    case 'web_search': return String(input.query ?? '');
    case 'mcp_arac': return `${input.islem} @ ${input.sunucu}`;
    case 'agent_spawn': return String(input.task ?? '').slice(0, 72);
    case 'enter_plan_mode': return String(input.reason ?? '');
    case 'exit_plan_mode': return 'plan sunum';
    default: return JSON.stringify(input).slice(0, 72);
  }
}
