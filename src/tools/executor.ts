/**
 * @fileoverview Tool executor — validates input, checks permissions, executes.
 */

import type { ToolDefinition, ToolResult, ToolPermissionConfig, ToolCallRecord, PermissionLevel } from '../types.js';
import type { ToolRegistry } from './registry.js';
import { isToolAllowed } from './permission.js';
import * as readline from 'readline';
import chalk from 'chalk';
import { cmd } from '../theme.js';

// Tools that are always safe (read-only) and never need confirmation in 'normal' mode.
const READ_ONLY_TOOLS = new Set([
  'file_read',
  'search',
  'grep',
  'list_directory',
  'glob',
  'batch_read',
  'gorev_oku',
  'gorev_yaz',
  'arac_ara',
  'web_ara',
]);

export class ToolExecutor {
  private permissionLevel: PermissionLevel = 'normal';
  private whitelistedTools: Set<string> = new Set();
  
  public onConfirmStart?: () => void;
  public onConfirmEnd?: () => void;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionConfig: ToolPermissionConfig,
    private readonly confirmFn?: (message: string) => Promise<boolean>,
  ) {}

  /** Change the runtime permission level. */
  setPermissionLevel(level: PermissionLevel): void {
    this.permissionLevel = level;
    // Reset whitelist when level changes
    this.whitelistedTools.clear();
  }

  getPermissionLevel(): PermissionLevel { return this.permissionLevel; }

  /** Whitelist a tool so it will never prompt again in this session. */
  whitelistTool(name: string): void { this.whitelistedTools.add(name); }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
  ): Promise<{ result: ToolResult; record: ToolCallRecord }> {
    const startTime = Date.now();
    const tool = this.registry.get(toolName);

    if (!tool) {
      const result: ToolResult = { output: `Hata: Bilinmeyen araç "${toolName}".`, isError: true };
      return {
        result,
        record: { toolName, input, output: result.output, durationMs: Date.now() - startTime, isError: true },
      };
    }

    // Permission check (static config)
    const permission = isToolAllowed(tool, input, this.permissionConfig);
    if (!permission.allowed) {
      const result: ToolResult = { output: `Erişim engellendi: ${permission.reason}`, isError: true };
      return {
        result,
        record: { toolName, input, output: result.output, durationMs: Date.now() - startTime, isError: true },
      };
    }

    // ─── Runtime confirmation based on PermissionLevel ─────────────
    const needsConfirm = this.shouldConfirm(tool, input, permission.needsConfirmation);

    if (needsConfirm) {
      const answer = await this.requestConfirmation(tool, input);
      if (answer === 'no') {
        const result: ToolResult = { output: 'Kullanıcı bu aracın çalıştırılmasına izin vermedi.', isError: true };
        return {
          result,
          record: { toolName, input, output: result.output, durationMs: Date.now() - startTime, isError: true },
        };
      }
      if (answer === 'always') {
        this.whitelistedTools.add(toolName);
      }
    }

    // Execute
    try {
      const result = await tool.execute(input, cwd);
      const durationMs = Date.now() - startTime;
      return {
        result,
        record: { toolName, input, output: result.output, durationMs, isError: result.isError ?? false, newCwd: result.newCwd },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: ToolResult = { output: `Araç çalışma hatası: ${message}`, isError: true };
      return {
        result,
        record: { toolName, input, output: result.output, durationMs: Date.now() - startTime, isError: true },
      };
    }
  }

  /** Decide if this tool call needs confirmation based on permission level. */
  private shouldConfirm(tool: ToolDefinition, input: Record<string, unknown>, staticNeedsConfirm: boolean): boolean {
    // Auto-approve mode (--auto / -y flag)
    if (this.confirmFn) return false;

    // Session whitelist (user said "bir daha sorma")
    if (this.whitelistedTools.has(tool.name)) return false;

    switch (this.permissionLevel) {
      case 'full':
        // Never ask
        return false;

      case 'normal':
        // Read-only tools: no confirm
        if (READ_ONLY_TOOLS.has(tool.name)) return false;
        // Shell with safe commands: no confirm (handled by staticNeedsConfirm from permission.ts)
        return staticNeedsConfirm;

      case 'dar':
        // Always ask for everything
        return true;

      default:
        return staticNeedsConfirm;
    }
  }

  /**
   * Ask the user for confirmation. Uses a simple readline prompt (NOT @clack/prompts)
   * to avoid the double-render bug caused by clack creating its own readline interface.
   *
   * Returns: 'yes' | 'no' | 'always'
   */
  private async requestConfirmation(tool: ToolDefinition, input: Record<string, unknown>): Promise<'yes' | 'no' | 'always'> {
    if (this.onConfirmStart) this.onConfirmStart();
    const summary = this.formatToolSummary(tool, input);

    return new Promise((resolve) => {
      const prompt = `${chalk.yellow('  ⚠')} ${summary} ${chalk.dim('[E]vet / [H]ayır / [D]aima')} `;
      process.stdout.write(prompt);

      const wasRaw = process.stdin.isRaw;

      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.removeListener('data', onData);
        process.removeListener('SIGINT', onSigInt);
        // Raw mode'u geri al — readline tekrar devralacak
        if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
      };

      const finishAndResolve = (val: 'yes' | 'no' | 'always') => {
        cleanup();
        if (this.onConfirmEnd) this.onConfirmEnd();
        resolve(val);
      };

      const onData = (buf: Buffer) => {
        const key = buf.toString().toLowerCase().trim();
        // Tuş karakterini terminale YAZMA — sadece cevabı yaz
        if (key === 'e' || key === 'y' || key === '\r' || key === '\n') {
          process.stdout.write(chalk.green('Evet') + '\n');
          finishAndResolve('yes');
        } else if (key === 'd' || key === 'a') {
          process.stdout.write(cmd('Daima') + '\n');
          finishAndResolve('always');
        } else if (key === 'h' || key === 'n') {
          process.stdout.write(chalk.red('Hayır') + '\n');
          finishAndResolve('no');
        } else if (key === '\x03') {
          // Ctrl+C
          process.stdout.write(chalk.red('İptal') + '\n');
          finishAndResolve('no');
        }
        // Diğer tuşları yut — sohbete gitmesin
      };

      process.stdin.on('data', onData);

      const onSigInt = () => {
        process.stdout.write(chalk.red('İptal edildi') + '\n');
        finishAndResolve('no');
      };
      
      process.on('SIGINT', onSigInt);
    });
  }

  private formatToolSummary(tool: ToolDefinition, input: Record<string, unknown>): string {
    if (tool.name === 'shell') return `Komut: ${chalk.bold(String(input.command ?? '').slice(0, 80))}`;
    if (tool.name === 'file_write') return `Yaz: ${chalk.bold(String(input.path ?? ''))}`;
    if (tool.name === 'file_edit') return `Düzenle: ${chalk.bold(String(input.path ?? ''))}`;
    if (tool.name === 'mcp_arac') {
      return `MCP ${chalk.bold(String(input.sunucu ?? ''))} → ${chalk.bold(String(input.islem ?? ''))}`;
    }
    return `${tool.name}(${JSON.stringify(input).slice(0, 80)})`;
  }
}
