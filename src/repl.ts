/**
 * @fileoverview SETH Ink REPL — React+Ink tabanlı etkileşimli terminal UI.
 *
 * main-code'daki gibi:
 *   - Full-screen Ink render
 *   - Spinner, ToolCall, ToolResult, StatsBar, ContextBar bileşenleri
 *   - Plan modu onay akışı
 *   - Alt-ajan derinlik göstergesi
 *   - Otomatik context %85 uyarısı
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, render, measureElement } from 'ink';
import * as readline from 'readline';
import * as path from 'path';
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
  listSessions,
} from './storage/session.js';
import {
  resolveModel,
  loadConfig,
  saveConfig,
  persistModelForProvider,
  persistProviderAndModel,
  getEffectiveContextBudgetTokens,
} from './config/settings.js';
import { executeCommand, parseCommand } from './commands.js';
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
import { VERSION } from './version.js';
import chalk from 'chalk';
import { cmd, navyBright, promptBright } from './theme.js';
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
  void startBackgroundCleanup(path.join(homedir(), '.seth', 'sessions'));

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

    const promptSym = promptBright('>');

    if (userMsgs > 0 || cumTokens > 0) {
      const lanePart = activeLane !== 'a' ? `${activeLane.toUpperCase()}·` : '';
      const info = chalk.dim(`[${lanePart}${userMsgs}msg·${tokenStr}/${budgetStr}]`);
      const ctxBar = pct > 0 ? ` ${pctColor(bar)}${chalk.dim(` ${pct}%`)}` : '';
      return `${promptSym} ${info}${ctxBar} `;
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
        const target = path.resolve(currentCwd, dir);
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
        systemPrompt,
        toolRegistry: tools,
        toolExecutor: executor,
        maxTurns: agentEnabled ? appConfig.agent.maxTurns : 1,
        maxTokens: getEffectiveContextBudgetTokens(appConfig),
        cwd: currentCwd,
        debug: appConfig.debug,
        abortSignal: currentAbortController.signal,
        // Fallback sağlayıcı — settings.json'da fallbackProvider tanımlıysa
        ...(appConfig.fallbackProvider && appConfig.fallbackProvider !== currentProvider ? {
          fallbackProvider: await createProvider(appConfig.fallbackProvider, appConfig).catch(() => undefined),
          fallbackModel: appConfig.fallbackModel,
        } : {}),

        onTurnStart: () => {
          stream.onTurnStart(finalInput);
          // Her istekte (tur başladığında) kullanım takibi yap
          import('./auth.js').then(({ trackUsage, currentUser }) => {
            if (currentUser) {
              trackUsage(currentUser.id, 'ai_request', { 
                model: currentModel, 
                provider: currentProvider,
                input_length: finalInput.length 
              });
            }
          });

          if (!didClearSpinner) {
            startSpinner('Düşünüyor…', true, { thinkingMode: spinOpts.thinkingMode });
          }
        },

        onToolCall: (name, input) => {
          clearSpin();
          // Hook: PreToolUse
          runHooks('PreToolUse', name, { tool: name, input: JSON.stringify(input).slice(0, 200) });
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
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: getPromptStr(),
      terminal: true,
      historySize: 500,
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
        if (s === 'd' || s === 'D') { if (rl) rl.write(null, { ctrl: true, name: 'u' }); renderVimStatus(); return true; }

        // Geçmiş (G = en son, gg = en eski)
        if (s === 'G') { if (rl) rl.write(null, { name: 'down' }); renderVimStatus(); return true; }
        if (s === 'g') { if (rl) rl.write(null, { name: 'up' }); renderVimStatus(); return true; }

        // Yank & paste (yy = satırı kopyala, p = yapıştır — readline'da ctrl+y)
        if (s === 'y') { /* yank: readline'da clipboard yok, no-op */ renderVimStatus(); return true; }
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
      // Esc → işlemi durdur (abort)
      if (key?.name === 'escape' && processing && currentAbortController) {
        currentAbortController.abort();
        process.stdout.write(chalk.red('\n  ⚡ Durduruldu (Esc)\n'));
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
      // Büyük paste algılama: 500+ karakter gelirse paste store'a yaz
      if (s && s.length > 500 && !processing) {
        const hash = storePaste(s);
        process.stdout.write(chalk.dim(`\n  📋 Büyük içerik algılandı (${s.length} karakter) — hash: ${hash.slice(0, 8)}…\n`));
      }
    };
    process.stdin.on('keypress', onKeypress);

    // ─── İşlem sırasında yazılan mesajı beklet ────────────────────────────────
    let pendingInput = '';   // AI çalışırken yazılan metin
    let pendingVisible = false;
    let pendingWaiting = false; // Zaten bekliyor mu?

    const clearPendingPrompt = () => {
      if (pendingVisible) {
        process.stdout.write(`\r\x1b[K`);
        pendingVisible = false;
      }
    };

    rl.on('line', (line: string) => {
      // ─── AI çalışırken Enter → beklet ──────────────────────────────────────
      if (processing) {
        const queued = pendingInput || line;
        if (queued.trim()) {
          clearPendingPrompt();
          pendingInput = queued;
          process.stdout.write(chalk.dim(`  ⏸ Kuyrukta: "${queued.slice(0, 60)}"\n`));
          // Zaten bekleyen bir interval varsa yeni oluşturma
          if (!pendingWaiting) {
            pendingWaiting = true;
            const waitInterval = setInterval(() => {
              if (!processing) {
                clearInterval(waitInterval);
                pendingWaiting = false;
                const toSend = pendingInput;
                pendingInput = '';
                if (toSend.trim()) {
                  addToHistory(toSend);
                  processing = true;
                  runAgentTurn(toSend).then(() => {
                    if (rl) { rl.setPrompt(getPromptStr()); rl.prompt(); }
                  });
                }
              }
            }, 200);
          }
        }
        return;
      }

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
              renderWelcomeAnimation(currentProvider, currentModel, userEmail);
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
        // rl.pause() KALDIRILDI — input alanı görünür kalsın
        await runAgentTurn(finalInput);
      }, 10);
    });

    rl.on('SIGINT', () => {
      if (currentAbortController) {
        currentAbortController.abort();
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
      console.log(chalk.dim(`  Devam etmek için: seth --devam ${session.id}`));
      process.exit(0);
    });

    rl.on('close', () => {
      process.stdin.removeListener('keypress', onKeypress);
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
