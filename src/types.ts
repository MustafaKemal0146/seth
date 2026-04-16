/**
 * @fileoverview SETH — Tüm paylaşımlı tip tanımları.
 * Açık çoklu-ajan ve qwen-code mimarilerinden ilham alınmış temiz-oda uygulaması.
 */

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type ProviderName = 'claude' | 'gemini' | 'openai' | 'ollama' | 'openrouter' | 'groq';

export interface ProviderCapabilities {
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsVision: boolean;
}

// ---------------------------------------------------------------------------
// Content Blocks
// ---------------------------------------------------------------------------

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: ContentBlock[] | string;
}

// ---------------------------------------------------------------------------
// LLM Interface
// ---------------------------------------------------------------------------

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatOptions {
  readonly model: string;
  readonly systemPrompt?: string;
  readonly tools?: readonly ToolSchema[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly abortSignal?: AbortSignal;
}

export interface ChatResponse {
  readonly id: string;
  readonly content: ContentBlock[];
  readonly model: string;
  readonly stopReason: string;
  readonly usage: TokenUsage;
}

export interface StreamEvent {
  readonly type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error';
  readonly data: unknown;
}

export interface LLMProvider extends ProviderCapabilities {
  readonly name: ProviderName;
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
  stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<StreamEvent>;
}

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** Dosya araçlarından dönen yapısal veri — renderer kararları için. */
export interface FileToolData {
  readonly type: 'create' | 'update';
  readonly path: string;
  readonly content?: string;
  readonly diff?: string;
  readonly lineCount: number;
  /** Değişiklik özeti (file_edit için: "Replaced 2 occurrence(s) of 3 line(s) with 5 line(s)") */
  readonly summary?: string;
}

export interface AgentToolData {
  readonly task: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ToolResult {
  readonly output: string;
  readonly isError?: boolean;
  /** Kabuk komutu dizin değiştirdiyse yeni yolu döndürür. */
  readonly newCwd?: string;
  /** Yapısal veri döndüren araçlar için opsiyonel alan (ör. kırpılmış dosya gösterimi detayları). */
  readonly data?: FileToolData | AgentToolData;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly isDestructive?: boolean;
  readonly requiresConfirmation?: boolean;
  execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionLevel = 'full' | 'normal' | 'dar';

export interface ToolPermissionConfig {
  readonly allowedTools: string[];
  readonly deniedTools: string[];
  readonly deniedPatterns: string[];
  readonly requireConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionData {
  readonly id: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly messages: ChatMessage[];
  /** Çift hat: B geçmişi (A = `messages`) */
  readonly messagesLaneB?: ChatMessage[];
  readonly activeLane?: 'a' | 'b';
  readonly tokenUsage: TokenUsage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
}

/** REPL düşünme göstergesi: minimal = durağan metin; animated = dönen çubuk + mesajlar */
export type ThinkingStyle = 'minimal' | 'animated';

/** REPL canlı model çıktısı: off = yalnızca tur sonunda markdown; plain = ham chunk; markdown = canlı markdown (TTY). */
export type ReplStreamMode = 'off' | 'plain' | 'markdown';

export interface ReplUiConfig {
  readonly thinkingStyle?: ThinkingStyle;
  readonly streamMode?: ReplStreamMode;
  /** Son eksik satırı canlı akışta gösterme (varsayılan true). */
  readonly streamHideIncompleteLine?: boolean;
  /** Markdown TTY yeniden çizim aralığı ms (varsayılan 24). */
  readonly streamThrottleMs?: number;
  /** Klavyede Vim (Normal/Insert) modu desteği. */
  readonly vimMode?: boolean;
}

export interface SETHConfig {
  readonly defaultProvider: ProviderName;
  readonly defaultModel: string;
  readonly providers: Partial<Record<ProviderName, ProviderConfig>>;
  readonly tools: ToolPermissionConfig;
  readonly agent: {
    readonly maxTurns: number;
    readonly maxTokens: number;
    readonly enabled: boolean;
  };
  /** Oturum toplam token üst sınırı (giriş+çıkış); `/context` ile ayarlanır. */
  readonly contextBudgetTokens?: number;
  readonly debug: boolean;
  readonly autoApprove?: boolean;
  readonly repl?: ReplUiConfig;
  readonly theme?: string;
  /** Birincil sağlayıcı başarısız olursa kullanılacak yedek sağlayıcı */
  readonly fallbackProvider?: ProviderName;
  readonly fallbackModel?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface AgentBudget {
  readonly maxTurns: number;
  readonly maxTokens: number;
  turnsUsed: number;
  tokensUsed: number;
}

export interface TurnResult {
  readonly response: ChatResponse;
  readonly toolCalls: ToolCallRecord[];
  readonly shouldContinue: boolean;
}

export interface ToolCallRecord {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly output: string;
  readonly durationMs: number;
  readonly isError: boolean;
  readonly newCwd?: string;
}
