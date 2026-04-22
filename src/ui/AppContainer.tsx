import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { UseSethAgentOptions } from './hooks/useSethAgent.js';
import type { SETHConfig } from '../types.js';
import { loadConfig, resolveModel } from '../config/settings.js';
import { createProvider } from '../providers/base.js';
import { createDefaultRegistry } from '../tools/registry.js';
import { ToolExecutor } from '../tools/executor.js';
import { SYSTEM_PROMPT_TR } from '../prompts/system.js';

// EventEmitter bellek sızıntısı uyarısını engellemek için limit döngü içinde dinamik ayarlanır
// process.setMaxListeners(50); // Artık loop.ts içinde yönetiliyor

export async function startModernUi(configOverrides: Partial<SETHConfig>) {
  const cfg = loadConfig(configOverrides);
  const providerName = cfg.defaultProvider;
  const model = resolveModel(providerName, cfg, configOverrides.defaultModel);
  
  const provider = await createProvider(providerName, cfg);
  const registry = await createDefaultRegistry(cfg);
  const executor = new ToolExecutor(registry, cfg.tools);
  executor.setSecurityProfile(cfg.tools.securityProfile ?? 'standard');

  const agentOptions: UseSethAgentOptions = {
    provider,
    model,
    systemPrompt: SYSTEM_PROMPT_TR,
    toolRegistry: registry,
    toolExecutor: executor,
    maxTurns: cfg.agent.maxTurns,
    maxTokens: cfg.agent.maxTokens,
    cwd: process.cwd(),
    debug: cfg.debug,
    effort: cfg.effort,
  };

  return render(<App agentOptions={agentOptions} />);
}
