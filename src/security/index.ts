/**
 * @fileoverview SETH Güvenlik Denetim Sistemi (Audit) — v3.9.5
 * AGPL-3.0
 * Tüm araç çağrılarını loglar, izin politikalarını uygular.
 * AGPL-3.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SETHConfig, SecurityProfile } from '../types.js';
import { generateId as makeId } from '../utils/id.js';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type AuditEventType =
  | 'tool_execution'
  | 'tool_approval'
  | 'tool_denial'
  | 'shell_command'
  | 'file_access'
  | 'network_request'
  | 'plugin_load'
  | 'config_change'
  | 'auth_failure'
  | 'security_violation';

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  toolName?: string;
  userId?: string;
  details: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  sessionId?: string;
}

export interface AuditPolicy {
  /** İzin verilen araçlar */
  allowedTools: string[];
  /** Yasaklanan araçlar */
  deniedTools: string[];
  /** Yasaklı desenler (regex) */
  deniedPatterns: string[];
  /** Onay gerektiren araçlar */
  requireConfirmation: boolean;
  /** Güvenlik profili */
  securityProfile: SecurityProfile;
  /** Denetim zorunlu mu? */
  auditRequired: boolean;
}

export interface AuditQuery {
  type?: AuditEventType;
  severity?: AuditEvent['severity'];
  toolName?: string;
  limit?: number;
  since?: string;
}

export interface AuditStats {
  totalEvents: number;
  criticalCount: number;
  warningCount: number;
  errorCount: number;
  uniqueTools: string[];
  lastEvent: AuditEvent | null;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const AUDIT_DIR = join(homedir(), '.seth', 'audit');
const AUDIT_FILE = join(AUDIT_DIR, 'audit.log.json');
const MAX_EVENTS = 10_000;

const DESTRUCTIVE_TOOLS = new Set([
  'shell', 'file_write', 'file_edit', 'sqlmap', 'nmap', 'nikto',
  'gobuster', 'ffuf', 'nuclei', 'masscan', 'wpscan', 'hashcat',
  'john', 'browser_automation',
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let events: AuditEvent[] = [];
let loaded = false;
let policy: AuditPolicy = {
  allowedTools: [],
  deniedTools: [],
  deniedPatterns: [],
  requireConfirmation: true,
  securityProfile: 'standard',
  auditRequired: true,
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stderr.write(`[seth:security] ${msg}\n`);
}

function generateId(): string {
  return makeId('audit');
}

function ensureDir(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Audit Kaydı
// ---------------------------------------------------------------------------

function loadEvents(): AuditEvent[] {
  if (loaded) return events;
  loaded = true;
  ensureDir();

  if (existsSync(AUDIT_FILE)) {
    try {
      events = JSON.parse(readFileSync(AUDIT_FILE, 'utf-8'));
    } catch {
      events = [];
    }
  }

  return events;
}

function saveEvents(): void {
  ensureDir();
  // Sınırla
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }
  writeFileSync(AUDIT_FILE, JSON.stringify(events, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Audit API
// ---------------------------------------------------------------------------

export function recordEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
  loadEvents();

  const auditEvent: AuditEvent = {
    ...event,
    id: generateId(),
    timestamp: new Date().toISOString(),
    details: { ...event.details },
  };

  events.push(auditEvent);
  saveEvents();

  if (auditEvent.severity === 'critical' || auditEvent.severity === 'error') {
    log(`[${auditEvent.severity.toUpperCase()}] ${auditEvent.type}: ${auditEvent.details.message || ''}`);
  }

  return auditEvent;
}

export function recordToolExecution(
  toolName: string,
  input: Record<string, unknown>,
  approved: boolean,
  sessionId?: string,
): AuditEvent {
  const severity = approved
    ? (DESTRUCTIVE_TOOLS.has(toolName) ? 'warning' : 'info')
    : 'warning';

  return recordEvent({
    type: approved ? 'tool_execution' : 'tool_denial',
    toolName,
    severity,
    details: {
      input,
      message: approved ? `"${toolName}" çalıştırıldı` : `"${toolName}" reddedildi`,
    },
    source: 'tool_registry',
    sessionId,
  });
}

export function recordShellCommand(
  command: string,
  approved: boolean,
  sessionId?: string,
): AuditEvent {
  return recordEvent({
    type: approved ? 'shell_command' : 'security_violation',
    severity: approved ? 'warning' : 'critical',
    details: {
      command: command.slice(0, 500),
      message: approved ? 'Shell komutu çalıştırıldı' : 'Güvenlik ihlali: shell komutu engellendi',
    },
    source: 'shell_tool',
    sessionId,
  });
}

export function recordSecurityViolation(
  message: string,
  details: Record<string, unknown>,
  sessionId?: string,
): AuditEvent {
  return recordEvent({
    type: 'security_violation',
    severity: 'critical',
    details: { message, ...details },
    source: 'security_manager',
    sessionId,
  });
}

export function recordAuthFailure(reason: string, details?: Record<string, unknown>): AuditEvent {
  return recordEvent({
    type: 'auth_failure',
    severity: 'error',
    details: { message: reason, ...details },
    source: 'auth',
  });
}

// ---------------------------------------------------------------------------
// Sorgulama
// ---------------------------------------------------------------------------

export function queryEvents(query?: AuditQuery): AuditEvent[] {
  loadEvents();
  let result = [...events];

  if (query?.type) result = result.filter(e => e.type === query.type);
  if (query?.severity) result = result.filter(e => e.severity === query.severity);
  if (query?.toolName) result = result.filter(e => e.toolName === query.toolName);
  if (query?.since) result = result.filter(e => e.timestamp >= query.since!);
  if (query?.limit) result = result.slice(0, query.limit);

  return result.reverse(); // En yeniler önce
}

export function getAuditStats(): AuditStats {
  loadEvents();
  const uniqueTools = new Set(events.map(e => e.toolName).filter(Boolean));

  return {
    totalEvents: events.length,
    criticalCount: events.filter(e => e.severity === 'critical').length,
    warningCount: events.filter(e => e.severity === 'warning').length,
    errorCount: events.filter(e => e.severity === 'error').length,
    uniqueTools: Array.from(uniqueTools) as string[],
    lastEvent: events[events.length - 1] || null,
  };
}

// ---------------------------------------------------------------------------
// Politika Yönetimi
// ---------------------------------------------------------------------------

export function setPolicy(newPolicy: Partial<AuditPolicy>): void {
  policy = { ...policy, ...newPolicy };
}

export function getPolicy(): AuditPolicy {
  return { ...policy };
}

export function isToolAllowed(toolName: string): { allowed: boolean; reason?: string } {
  if (policy.deniedTools.includes(toolName)) {
    return { allowed: false, reason: 'Araç yasaklandı' };
  }
  if (policy.allowedTools.length > 0 && !policy.allowedTools.includes(toolName)) {
    return { allowed: false, reason: 'Araç izin listesinde yok' };
  }
  return { allowed: true };
}

export function isDestructiveTool(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

// ---------------------------------------------------------------------------
// Güvenlik Kontrol
// ---------------------------------------------------------------------------

export function checkCommandSafety(command: string): { safe: boolean; reason?: string } {
  for (const pattern of policy.deniedPatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(command)) {
        return { safe: false, reason: `Yasaklı desen eşleşti: ${pattern}` };
      }
    } catch { /* invalid regex */ }
  }

  // Tehlikeli komutlar
  const dangerousCommands = ['rm -rf /', 'dd if=', ':(){ :|:& };:', '> /dev/sda'];
  for (const dc of dangerousCommands) {
    if (command.includes(dc)) {
      return { safe: false, reason: 'Tehlikeli komut tespit edildi' };
    }
  }

  return { safe: true };
}

// ---------------------------------------------------------------------------
// İnisiyalizasyon
// ---------------------------------------------------------------------------

export function initSecurity(config?: SETHConfig): void {
  loadEvents();

  if (config?.tools) {
    setPolicy({
      allowedTools: config.tools.allowedTools || [],
      deniedTools: config.tools.deniedTools || [],
      deniedPatterns: config.tools.deniedPatterns || [],
      requireConfirmation: config.tools.requireConfirmation ?? true,
      securityProfile: config.tools.securityProfile ?? 'standard',
    });
  }

  const { totalEvents } = getAuditStats();
  log(`Denetim sistemi hazır (${totalEvents} kayıtlı olay)`);
}
