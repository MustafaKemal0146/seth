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
    case 'mistral': {
      const apiKey = resolveProviderApiKey('mistral', config);
      if (!apiKey) throw new ProviderError('MISTRAL_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'mistral');
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(apiKey, 'https://api.mistral.ai/v1');
    }
    case 'deepseek': {
      const apiKey = resolveProviderApiKey('deepseek', config);
      if (!apiKey) throw new ProviderError('DEEPSEEK_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'deepseek');
      const { DeepSeekProvider } = await import('./deepseek.js');
      return new DeepSeekProvider(apiKey);
    }
    case 'xai': {
      const apiKey = resolveProviderApiKey('xai', config);
      if (!apiKey) throw new ProviderError('XAI_API_KEY is not set. Set it in ~/.seth/settings.json or as an environment variable.', 'xai');
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(apiKey, 'https://api.x.ai/v1');
    }
    case 'lmstudio': {
      const baseUrl = config.providers.lmstudio?.baseUrl ?? 'http://localhost:1234';
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider('lm-studio', `${baseUrl}/v1`);
    }
    case 'litellm': {
      const baseUrl = config.providers.litellm?.baseUrl ?? 'http://localhost:4000';
      const apiKey = resolveProviderApiKey('litellm', config) ?? 'litellm';
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(apiKey, `${baseUrl}/v1`);
    }
    case 'copilot': {
      const baseUrl = config.providers.copilot?.baseUrl ?? 'http://localhost:3000';
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider('n/a', `${baseUrl}/v1`);
    }
    default: {
      throw new ProviderError(`Unknown provider: ${name as string}`, name as string);
    }
  }
}
