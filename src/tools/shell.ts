/**
 * @fileoverview Shell tool — cross-platform command execution.
 */

import { spawn } from 'child_process';
import { platform, tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolResult } from '../types.js';

const DEFAULT_TIMEOUT = 30_000;

export const shellTool: ToolDefinition = {
  name: 'shell',
  description:
    'Kabuk komutu çalıştırır. Linux/macOS’ta bash, Windows’ta PowerShell kullanılır. ' +
    'Dosya işlemleri, betik çalıştırma, paket kurulumu, git vb. için kullan.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Çalıştırılacak komut.' },
      timeout: { type: 'number', description: `Zaman aşımı (ms). Varsayılan: ${DEFAULT_TIMEOUT}` },
    },
    required: ['command'],
  },
  isDestructive: false,
  requiresConfirmation: true,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const rawCommand = input.command as string;
    const timeoutMs = (input.timeout as number) ?? DEFAULT_TIMEOUT;

    const isWindows = platform() === 'win32';
    const shell = isWindows ? 'powershell.exe' : 'bash';
    
    // Track CWD changes by appending pwd command
    const cwdFile = join(tmpdir(), `seth-cwd-${randomUUID()}`);
    let command: string;
    
    if (isWindows) {
      // PowerShell: execute command then write PWD to file
      command = `${rawCommand}; Get-Location | Select-Object -ExpandProperty Path | Out-File -FilePath "${cwdFile}" -Encoding utf8`;
    } else {
      // Bash: execute command then write pwd -P to file
      command = `${rawCommand} && pwd -P > "${cwdFile}" || { pwd -P > "${cwdFile}"; exit 1; }`;
    }

    const shellArgs = isWindows ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

    return new Promise<ToolResult>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;
        if (!output) output = exitCode === 0 ? '(completed with no output)' : `(exit code: ${exitCode})`;
        if (exitCode !== 0 && output) output += `\n(exit code: ${exitCode})`;
        if (timedOut) output += '\n(timed out)';

        // Read new CWD
        let newCwd: string | undefined;
        try {
          newCwd = readFileSync(cwdFile, 'utf8').trim();
          unlinkSync(cwdFile);
        } catch {
          // ignore
        }

        resolve({ 
          output: truncateOutput(output), 
          isError: exitCode !== 0,
          newCwd: (newCwd && newCwd !== cwd) ? newCwd : undefined
        });
      };

      child.on('close', (code) => finish(code ?? (timedOut ? 124 : 1)));
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { unlinkSync(cwdFile); } catch {}
          resolve({ output: `Error: ${err.message}`, isError: true });
        }
      });
    });
  },
};

function truncateOutput(output: string, maxLen = 10000): string {
  if (output.length <= maxLen) return output;
  const half = Math.floor(maxLen / 2);
  return `${output.slice(0, half)}\n\n... [${output.length - maxLen} chars truncated] ...\n\n${output.slice(-half)}`;
}
