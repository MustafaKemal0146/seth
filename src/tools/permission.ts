/**
 * @fileoverview Tool permission checking.
 */

import type { ToolDefinition, ToolPermissionConfig } from '../types.js';

const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'rd', 'format', 'mkfs',
  'dd', 'shred', 'wipefs',
  'drop', 'truncate', 'delete',
]);

const SAFE_COMMANDS = new Set([
  'ls', 'dir', 'pwd', 'cd', 'echo', 'cat', 'head', 'tail',
  'grep', 'rg', 'find', 'which', 'where', 'whoami',
  'git status', 'git diff', 'git log', 'git branch',
  'node --version', 'npm --version', 'python --version',
  'date', 'tree', 'wc', 'sort', 'uniq',
]);

export function isToolAllowed(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  config: ToolPermissionConfig,
): { allowed: boolean; reason?: string; needsConfirmation: boolean } {
  // Check denied tools
  if (config.deniedTools.includes(tool.name)) {
    return {
      allowed: false,
      reason: `Araç "${tool.name}" yapılandırma ile reddedildi.`,
      needsConfirmation: false,
    };
  }

  // Check denied patterns
  for (const pattern of config.deniedPatterns) {
    if (tool.name.toLowerCase().includes(pattern.toLowerCase())) {
      return {
        allowed: false,
        reason: `Araç "${tool.name}", reddedilen desen "${pattern}" ile eşleşiyor.`,
        needsConfirmation: false,
      };
    }
  }

  // Allowed list bypass — if explicitly allowed, skip confirmation
  if (config.allowedTools.includes(tool.name)) {
    return { allowed: true, needsConfirmation: false };
  }

  // Shell commands — extra scrutiny
  if (tool.name === 'shell' && typeof input.command === 'string') {
    const command = input.command.trim();
    const firstWord = command.split(/\s+/)[0]?.toLowerCase() ?? '';

    // Safe commands don't need confirmation
    if (SAFE_COMMANDS.has(command) || SAFE_COMMANDS.has(firstWord)) {
      return { allowed: true, needsConfirmation: false };
    }

    // Destructive commands always need confirmation
    if (DESTRUCTIVE_COMMANDS.has(firstWord)) {
      return {
        allowed: true,
        needsConfirmation: true,
        reason: `Yıkıcı komut: ${firstWord}`,
      };
    }
  }

  // File write/edit always needs confirmation unless explicitly allowed
  if (tool.isDestructive || tool.requiresConfirmation) {
    return { allowed: true, needsConfirmation: config.requireConfirmation };
  }

  // Default: needs confirmation based on config
  return { allowed: true, needsConfirmation: config.requireConfirmation };
}

export function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  return SAFE_COMMANDS.has(trimmed) || SAFE_COMMANDS.has(firstWord);
}
