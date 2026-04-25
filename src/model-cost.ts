/**
 * @fileoverview Model maliyet tablosu — her provider/model için gerçek fiyat ($/1M token).
 */

interface ModelPrice {
  input: number;   // $/1M input token
  output: number;  // $/1M output token
}

// Fiyatlar: $/1M token
const PRICES: Record<string, ModelPrice> = {
  // Claude
  'claude-sonnet-4-20250514':       { input: 3.00,  output: 15.00 },
  'claude-3-5-sonnet-latest':       { input: 3.00,  output: 15.00 },
  'claude-3-5-haiku-latest':        { input: 0.80,  output: 4.00  },
  'claude-3-opus-20240229':         { input: 15.00, output: 75.00 },
  // OpenAI
  'gpt-4o':                         { input: 5.00,  output: 15.00 },
  'gpt-4o-mini':                    { input: 0.15,  output: 0.60  },
  'o1-preview':                     { input: 15.00, output: 60.00 },
  'o1-mini':                        { input: 3.00,  output: 12.00 },
  'o3-mini':                        { input: 1.10,  output: 4.40  },
  // Gemini
  'gemini-2.5-pro':                 { input: 1.25,  output: 10.00 },
  'gemini-2.0-flash':               { input: 0.10,  output: 0.40  },
  'gemini-1.5-pro':                 { input: 1.25,  output: 5.00  },
  'gemini-1.5-flash':               { input: 0.075, output: 0.30  },
  // Groq (çok ucuz)
  'llama-3.3-70b-versatile':        { input: 0.059, output: 0.079 },
  'llama-3.1-8b-instant':           { input: 0.005, output: 0.008 },
  'mixtral-8x7b-32768':             { input: 0.024, output: 0.024 },
  'gemma2-9b-it':                   { input: 0.020, output: 0.020 },
  // DeepSeek V4 (güncel)
  'deepseek-v4-flash':              { input: 0.14,  output: 0.28  },
  'deepseek-v4-pro':                { input: 0.435, output: 0.87  },
  // DeepSeek (eski isimler — deprecated 2026-07-24)
  'deepseek-chat':                  { input: 0.14,  output: 0.28  },
  'deepseek-reasoner':              { input: 0.55,  output: 2.19  },
  // Mistral
  'mistral-large-latest':           { input: 2.00,  output: 6.00  },
  'mistral-medium-latest':          { input: 0.40,  output: 1.20  },
  'mistral-small-latest':           { input: 0.10,  output: 0.30  },
  'codestral-latest':               { input: 0.20,  output: 0.60  },
  // xAI
  'grok-3-latest':                  { input: 3.00,  output: 15.00 },
  'grok-3-mini-latest':             { input: 0.30,  output: 0.50  },
  'grok-2-latest':                  { input: 2.00,  output: 10.00 },
};

// Provider varsayılan fiyatları (model bulunamazsa)
const PROVIDER_DEFAULTS: Record<string, ModelPrice> = {
  claude:      { input: 3.00,  output: 15.00 },
  openai:      { input: 5.00,  output: 15.00 },
  gemini:      { input: 1.25,  output: 5.00  },
  groq:        { input: 0.05,  output: 0.08  },
  deepseek:    { input: 0.14,  output: 0.28  },
  mistral:     { input: 2.00,  output: 6.00  },
  xai:         { input: 3.00,  output: 15.00 },
  openrouter:  { input: 3.00,  output: 15.00 },
  ollama:      { input: 0,     output: 0     },
  lmstudio:    { input: 0,     output: 0     },
};

export function getModelPrice(model: string, provider: string): ModelPrice {
  // Tam eşleşme
  if (PRICES[model]) return PRICES[model]!;
  // Kısmi eşleşme (model adı prefix olarak)
  for (const [key, price] of Object.entries(PRICES)) {
    if (model.startsWith(key) || key.startsWith(model)) return price;
  }
  // Provider varsayılanı
  return PROVIDER_DEFAULTS[provider] ?? { input: 3.00, output: 15.00 };
}

/**
 * Token kullanımından USD maliyet hesapla.
 */
export function calculateCostUSD(
  inputTokens: number,
  outputTokens: number,
  model: string,
  provider: string,
): number {
  const price = getModelPrice(model, provider);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * Maliyet formatla — küçük değerler için daha fazla ondalık.
 */
export function formatCostUSD(usd: number): string {
  if (usd === 0) return '$0.00 (yerel)';
  if (usd < 0.0001) return `$${(usd * 1000).toFixed(4)}m (milli-dolar)`;
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}
