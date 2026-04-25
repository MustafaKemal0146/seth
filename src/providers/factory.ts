import type { ProviderName, ProviderConfig } from '../types.js';

async function listOpenAiCompatibleModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(7_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { data?: Array<{ id?: string }> };
  const models = (json.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x)).sort();
  return models;
}

function providerBaseUrl(name: ProviderName, config?: ProviderConfig): string | null {
  switch (name) {
    case 'openai': return config?.baseUrl ?? 'https://api.openai.com/v1';
    case 'openrouter': return config?.baseUrl ?? 'https://openrouter.ai/api/v1';
    case 'groq': return config?.baseUrl ?? 'https://api.groq.com/openai/v1';
    case 'deepseek': return config?.baseUrl ?? 'https://api.deepseek.com/v1';
    case 'mistral': return config?.baseUrl ?? 'https://api.mistral.ai/v1';
    case 'xai': return config?.baseUrl ?? 'https://api.x.ai/v1';
    case 'lmstudio': return `${config?.baseUrl ?? 'http://localhost:1234'}/v1`;
    case 'litellm': return `${config?.baseUrl ?? 'http://localhost:4000'}/v1`;
    case 'copilot': return `${config?.baseUrl ?? 'http://localhost:3000'}/v1`;
    default: return null;
  }
}

export async function listModels(name: ProviderName, config?: ProviderConfig): Promise<string[]> {
  switch (name) {
    case 'ollama': {
      const { OllamaProvider } = await import('./ollama.js');
      const provider = new OllamaProvider(config?.baseUrl ?? 'http://localhost:11434');
      return provider.listModels();
    }
    case 'claude':
      return [
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-latest',
      ];
    case 'gemini':
      return [
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
      ];
    case 'deepseek': {
      const baseUrl = providerBaseUrl(name, config);
      if (!baseUrl) return ['deepseek-v4-flash', 'deepseek-v4-pro'];
      try {
        const models = await listOpenAiCompatibleModels(baseUrl, config?.apiKey);
        if (models.length > 0) return models;
      } catch { /* fallback */ }
      return ['deepseek-v4-flash', 'deepseek-v4-pro'];
    }
    case 'openai':
    case 'groq':
    case 'mistral':
    case 'xai':
    case 'openrouter':
    case 'lmstudio':
    case 'litellm':
    case 'copilot': {
      const baseUrl = providerBaseUrl(name, config);
      if (!baseUrl) return config?.model ? [config.model] : [];
      try {
        const models = await listOpenAiCompatibleModels(baseUrl, config?.apiKey);
        if (models.length > 0) return models;
      } catch {
        // Kontrollü fallback: bağlantı yoksa yapılandırılmış modele düş.
      }
      return config?.model ? [config.model] : [];
    }
    default:
      return [];
  }
}
