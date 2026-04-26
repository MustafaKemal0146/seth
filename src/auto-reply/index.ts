/**
 * @fileoverview SETH Auto-Reply Sistemi — v3.9.5
 * AGPL-3.0
 * Gelen mesajlara otonom yanıt verme, tetikleyiciler, kısıtlama.
 * AGPL-3.0
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type TriggerType = 'keyword' | 'regex' | 'schedule' | 'event' | 'webhook';

export interface AutoReplyRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: TriggerType;
    /** Keyword veya regex deseni */
    pattern?: string;
    /** Zamanlanmış tetikleme (cron expression) */
    cronExpr?: string;
    /** Olay adı */
    eventName?: string;
  };
  /** Yanıt şablonu ({{variable}} destekler) */
  response: string;
  /** Kısıtlama süresi (ms) — aynı tetikleyici tekrar çalışmadan önce bekle */
  cooldownMs: number;
  /** Sadece belirli koşullarda çalışsın */
  conditions?: {
    timeRange?: { start: string; end: string };
    requireKeyword?: string;
  };
  /** Öncelik (yüksek öncelikli önce çalışır) */
  priority: number;
  /** Son tetiklenme zamanı */
  lastTriggeredAt?: string;
  /** Toplam tetiklenme sayısı */
  triggerCount: number;
}

export interface AutoReplyConfig {
  enabled: boolean;
  rules: AutoReplyRule[];
  globalCooldownMs: number;
  maxResponsesPerMinute: number;
}

export interface TriggerContext {
  message: string;
  source: string;
  timestamp: Date;
  metadata?: Record<string, string>;
}

export interface AutoReplyResult {
  matched: boolean;
  ruleId?: string;
  response?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const AUTO_REPLY_DIR = join(homedir(), '.seth', 'auto-reply');
const RULES_FILE = join(AUTO_REPLY_DIR, 'rules.json');
const COUNTERS_FILE = join(AUTO_REPLY_DIR, 'counters.json');

// ---------------------------------------------------------------------------
// Varsayılan Konfig
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AutoReplyConfig = {
  enabled: false,
  rules: [],
  globalCooldownMs: 1_000,
  maxResponsesPerMinute: 10,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: AutoReplyConfig = { ...DEFAULT_CONFIG };
let loaded = false;
let responseCounters: { timestamps: number[] } = { timestamps: [] };

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stderr.write(`[seth:auto-reply] ${msg}\n`);
}

function generateRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(): void {
  if (!existsSync(AUTO_REPLY_DIR)) {
    mkdirSync(AUTO_REPLY_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Yükleme/Kaydetme
// ---------------------------------------------------------------------------

function loadState(): void {
  if (loaded) return;
  loaded = true;
  ensureDir();

  if (existsSync(RULES_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(RULES_FILE, 'utf-8'));
      config = { ...DEFAULT_CONFIG, ...raw };
    } catch { /* use defaults */ }
  }

  if (existsSync(COUNTERS_FILE)) {
    try {
      responseCounters = JSON.parse(readFileSync(COUNTERS_FILE, 'utf-8'));
    } catch { /* use defaults */ }
  }
}

function saveState(): void {
  ensureDir();
  writeFileSync(RULES_FILE, JSON.stringify(config, null, 2), 'utf-8');
  writeFileSync(COUNTERS_FILE, JSON.stringify(responseCounters), 'utf-8');
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

function checkRateLimit(): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  // Eski timestamp'leri temizle
  responseCounters.timestamps = responseCounters.timestamps.filter(t => t > oneMinuteAgo);

  if (responseCounters.timestamps.length >= config.maxResponsesPerMinute) {
    return false; // Limit aşıldı
  }

  responseCounters.timestamps.push(now);
  saveState();
  return true;
}

// ---------------------------------------------------------------------------
// Kural Yönetimi
// ---------------------------------------------------------------------------

export function addRule(rule: Omit<AutoReplyRule, 'id' | 'lastTriggeredAt' | 'triggerCount'>): AutoReplyRule {
  loadState();
  const newRule: AutoReplyRule = {
    ...rule,
    id: generateRuleId(),
    lastTriggeredAt: undefined,
    triggerCount: 0,
  };
  config.rules.push(newRule);
  saveState();
  log(`Kural eklendi: ${newRule.name}`);
  return newRule;
}

export function removeRule(ruleId: string): boolean {
  loadState();
  const index = config.rules.findIndex(r => r.id === ruleId);
  if (index === -1) return false;
  config.rules.splice(index, 1);
  saveState();
  return true;
}

export function updateRule(ruleId: string, updates: Partial<AutoReplyRule>): boolean {
  loadState();
  const rule = config.rules.find(r => r.id === ruleId);
  if (!rule) return false;
  Object.assign(rule, updates);
  saveState();
  return true;
}

export function listRules(): AutoReplyRule[] {
  loadState();
  return [...config.rules].sort((a, b) => b.priority - a.priority);
}

export function setEnabled(enabled: boolean): void {
  config.enabled = enabled;
  saveState();
  log(enabled ? 'Auto-Reply etkinleştirildi' : 'Auto-Reply devre dışı');
}

export function isEnabled(): boolean {
  loadState();
  return config.enabled;
}

// ---------------------------------------------------------------------------
// Tetikleyici Motoru
// ---------------------------------------------------------------------------

export function evaluateTrigger(context: TriggerContext): AutoReplyResult {
  loadState();

  if (!config.enabled) {
    return { matched: false };
  }

  // Rate limit kontrolü
  if (!checkRateLimit()) {
    return { matched: false, error: 'Rate limit aşıldı' };
  }

  const activeRules = config.rules
    .filter(r => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of activeRules) {
    // Cooldown kontrolü
    if (rule.lastTriggeredAt) {
      const elapsed = Date.now() - new Date(rule.lastTriggeredAt).getTime();
      if (elapsed < rule.cooldownMs) continue;
    }

    // Trigger tipine göre eşleştirme
    let matched = false;

    switch (rule.trigger.type) {
      case 'keyword':
        if (rule.trigger.pattern) {
          matched = context.message.toLowerCase().includes(rule.trigger.pattern.toLowerCase());
        }
        break;

      case 'regex':
        if (rule.trigger.pattern) {
          try {
            matched = new RegExp(rule.trigger.pattern, 'i').test(context.message);
          } catch { /* invalid regex */ }
        }
        break;

      case 'event':
        if (rule.trigger.eventName && context.metadata) {
          matched = context.metadata.event === rule.trigger.eventName;
        }
        break;

      default:
        break;
    }

    if (matched) {
      // Koşul kontrolü
      if (rule.conditions?.requireKeyword) {
        if (!context.message.toLowerCase().includes(rule.conditions.requireKeyword.toLowerCase())) {
          continue;
        }
      }

      // Zaman aralığı kontrolü
      if (rule.conditions?.timeRange) {
        const now = new Date();
        const currentHour = now.getHours().toString().padStart(2, '0');
        const currentMin = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHour}:${currentMin}`;

        if (currentTime < rule.conditions.timeRange.start || currentTime > rule.conditions.timeRange.end) {
          continue;
        }
      }

      // Template değişkenlerini doldur
      let response = rule.response;
      response = response.replace(/{{message}}/g, context.message);
      response = response.replace(/{{source}}/g, context.source);
      response = response.replace(/{{time}}/g, new Date().toLocaleTimeString('tr-TR'));
      response = response.replace(/{{date}}/g, new Date().toLocaleDateString('tr-TR'));

      // Kuralı güncelle
      rule.lastTriggeredAt = new Date().toISOString();
      rule.triggerCount++;
      saveState();

      log(`Kural tetiklendi: ${rule.name} (${context.source})`);

      return {
        matched: true,
        ruleId: rule.id,
        response,
      };
    }
  }

  return { matched: false };
}

// ---------------------------------------------------------------------------
// Global Cooldown
// ---------------------------------------------------------------------------

export function setGlobalCooldown(ms: number): void {
  config.globalCooldownMs = ms;
  saveState();
}

export function setMaxResponsesPerMinute(max: number): void {
  config.maxResponsesPerMinute = max;
  saveState();
}

// ---------------------------------------------------------------------------
// İnisiyalizasyon
// ---------------------------------------------------------------------------

export function initAutoReply(): void {
  loadState();
  const ruleCount = config.rules.length;
  log(`Auto-Reply sistemi hazır (${ruleCount} kural, ${config.enabled ? 'etkin' : 'devre dışı'})`);
}
