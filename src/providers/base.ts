/**
 * @fileoverview LLM Provider interface and factory.
 * Clean-room implementation — provider-agnostic abstraction layer.
 */

import type { LLMProvider, ProviderName, SETHConfig } from '../types.js';
import { ProviderError } from '../core/errors.js';
import { resolveProviderApiKey } from '../config/settings.js';

/**
 * Create an LLM provider instance by name.
 * Uses lazy imports to avoid loading unused SDKs.
 */
export async function createProvider(
  name: ProviderName,
  config: SETHConfig,
): Promise<LLMProvider> {
  switch (name) {
    case 'claude': {
      const apiKey = resolveProviderApiKey('claude', config);
      if (!apiKey) throw new ProviderError('ANTHROPIC_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'claude');
      const { ClaudeProvider } = await import('./claude.js');
      return new ClaudeProvider(apiKey);
    }
    case 'openai': {
      const apiKey = resolveProviderApiKey('openai', config);
      if (!apiKey) throw new ProviderError('OPENAI_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'openai');
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(apiKey);
    }
    case 'gemini': {
      const apiKey = resolveProviderApiKey('gemini', config);
      if (!apiKey) throw new ProviderError('GEMINI_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'gemini');
      const { GeminiProvider } = await import('./gemini.js');
      return new GeminiProvider(apiKey);
    }
    case 'ollama': {
      const baseUrl = config.providers.ollama?.baseUrl ?? 'http://localhost:11434';
      const { OllamaProvider } = await import('./ollama.js');
      return new OllamaProvider(baseUrl);
    }
    case 'openrouter': {
      const apiKey = resolveProviderApiKey('openrouter', config);
      if (!apiKey) throw new ProviderError('OPENROUTER_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'openrouter');
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(apiKey, 'https://openrouter.ai/api/v1');
    }
    case 'groq': {
      const apiKey = resolveProviderApiKey('groq', config);
      if (!apiKey) throw new ProviderError('GROQ_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'groq');
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(apiKey, 'https://api.groq.com/openai/v1');
    }
    default: {
      throw new ProviderError(`Unknown provider: ${name as string}`, name as string);
    }
  }
}
