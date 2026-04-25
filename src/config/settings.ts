/**
 * @fileoverview Configuration loader for SETH.
 * Loads from: ~/.seth/settings.json → .env → environment variables → CLI flags
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SETHConfig, ProviderName } from '../types.js';

const CONFIG_DIR = join(homedir(), '.seth');
const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json');
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getSessionsDir(): string {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  return SESSIONS_DIR;
}

/** Takım dosyaları (~/.seth/teams/) */
export function getTeamsDir(): string {
  const d = join(CONFIG_DIR, 'teams');
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
  }
  return d;
}

export function getSettingsPath(): string {
  return SETTINGS_FILE;
}

const DEFAULT_CONFIG: SETHConfig = {
  defaultProvider: 'ollama',
  defaultModel: 'qwen3-coder',
  providers: {
    claude: { apiKey: undefined, model: 'claude-sonnet-4-20250514' },
    gemini: { apiKey: undefined, model: 'gemini-2.5-pro' },
    openai: { apiKey: undefined, model: 'gpt-4o' },
    ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3-coder' },
    openrouter: { apiKey: undefined, model: 'openai/gpt-4o' },
    groq: { apiKey: undefined, model: 'llama-3.3-70b-versatile' },
    mistral: { apiKey: undefined, model: 'mistral-large-latest' },
    deepseek: { apiKey: undefined, model: 'deepseek-chat' },
    xai: { apiKey: undefined, model: 'grok-3-latest' },
    lmstudio: { baseUrl: 'http://localhost:1234', model: 'local-model' },
    litellm: { baseUrl: 'http://localhost:4000', model: 'gpt-3.5-turbo' },
    copilot: { baseUrl: 'http://localhost:3000', model: 'gpt-4o' },
  },
  tools: {
    allowedTools: [],
    deniedTools: [],
    deniedPatterns: [],
    requireConfirmation: true,
    securityProfile: 'standard',
  },
  agent: {
    maxTurns: 25,
    maxTokens: 5000000,
    enabled: true,
  },
  contextBudgetTokens: 500_000,
  repl: {
    thinkingStyle: 'minimal',
  },
  theme: 'dark',
  debug: false,
};

export function loadConfig(overrides?: Partial<SETHConfig>): SETHConfig {
  // 1. Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // 2. Load from settings.json
  if (existsSync(SETTINGS_FILE)) {
    try {
      const raw = readFileSync(SETTINGS_FILE, 'utf-8');
      const fileConfig = JSON.parse(raw) as Partial<SETHConfig>;
      config = deepMerge(config, fileConfig);
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // 3. Load .env if exists in cwd
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as { config: () => void };
    dotenv.config();
  } catch {
    // dotenv optional — not critical if missing
  }

  // 4. Environment variable overrides
  const envKeys: Record<string, string> = {
    ANTHROPIC_API_KEY: 'claude',
    GEMINI_API_KEY: 'gemini',
    OPENAI_API_KEY: 'openai',
    OLLAMA_BASE_URL: 'ollama',
    OPENROUTER_API_KEY: 'openrouter',
    GROQ_API_KEY: 'groq',
    MISTRAL_API_KEY: 'mistral',
    DEEPSEEK_API_KEY: 'deepseek',
    XAI_API_KEY: 'xai',
    LMSTUDIO_BASE_URL: 'lmstudio',
  };

  for (const [envKey, provider] of Object.entries(envKeys)) {
    const val = process.env[envKey];
    if (val) {
      const providerName = provider as ProviderName;
      if (!config.providers[providerName]) {
        (config.providers as Record<string, unknown>)[providerName] = {};
      }
      if (envKey.endsWith('_BASE_URL')) {
        (config.providers[providerName] as Record<string, unknown>).baseUrl = val;
      } else {
        (config.providers[providerName] as Record<string, unknown>).apiKey = val;
      }
    }
  }

  // 5. Debug mode from env
  if (process.env.SETH_DEBUG === '1' || process.env.SETH_DEBUG === 'true') {
    (config as Record<string, unknown>).debug = true;
  }

  // 6. CLI overrides
  if (overrides) {
    config = deepMerge(config, overrides);
  }

  return config;
}

export function saveConfig(config: Partial<SETHConfig>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  let existing: Record<string, unknown> = {};
  if (existsSync(SETTINGS_FILE)) {
    try {
      existing = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch {
      // ignore
    }
  }
  const merged = deepMerge(existing, config as Partial<Record<string, unknown>>);
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, any>,
        sourceVal as Record<string, any>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

export function resolveProviderApiKey(provider: ProviderName, config: SETHConfig): string | undefined {
  const providerConfig = config.providers[provider];
  if (providerConfig?.apiKey) return providerConfig.apiKey;

  const envMap: Record<ProviderName, string> = {
    claude: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    ollama: '',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    xai: 'XAI_API_KEY',
    lmstudio: '',
    litellm: 'LITELLM_API_KEY',
    copilot: '',
  };

  const envKey = envMap[provider];
  if (envKey) return process.env[envKey];
  return undefined;
}

export function resolveModel(provider: ProviderName, config: SETHConfig, modelOverride?: string): string {
  if (modelOverride) return modelOverride;
  const providerConfig = config.providers[provider];
  if (providerConfig?.model) return providerConfig.model;
  return config.defaultModel;
}

/**
 * Seçilen modeli kalıcı yapar: `defaultModel` ve `providers[provider].model` senkron
 * (resolveModel önce sağlayıcı modeline bakar).
 */
export function persistModelForProvider(provider: ProviderName, model: string): void {
  saveConfig({
    defaultModel: model,
    providers: {
      [provider]: { model },
    } as SETHConfig['providers'],
  });
}

/** Sağlayıcı değişiminde varsayılan sağlayıcı + model kaydı. */
export function persistProviderAndModel(provider: ProviderName, model: string): void {
  saveConfig({
    defaultProvider: provider,
    defaultModel: model,
    providers: {
      [provider]: { model },
    } as SETHConfig['providers'],
  });
}

/** Belirtilen sağlayıcının API anahtarını siler. */
export function deleteApiKey(provider: ProviderName): void {
  // deepMerge undefined değerleri yok saydığı için saveConfig kullanılamaz.
  // Direkt JSON dosyasını okuyup key'i sil.
  if (!existsSync(SETTINGS_FILE)) return;
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')); } catch { return; }
  const providers = raw.providers as Record<string, Record<string, unknown>> | undefined;
  if (providers?.[provider]) {
    delete providers[provider].apiKey;
    writeFileSync(SETTINGS_FILE, JSON.stringify(raw, null, 2), 'utf-8');
  }
}

/** Oturum toplam token üst sınırı; `contextBudgetTokens` yoksa `agent.maxTokens`. */
export function getEffectiveContextBudgetTokens(config: SETHConfig): number {
  return config.contextBudgetTokens ?? config.agent.maxTokens;
}
