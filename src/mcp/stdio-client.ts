/**
 * @fileoverview Tek oturumluk MCP stdio istemcisi (JSON-RPC satır modu).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { McpServerEntry } from './config.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  async connect(entry: McpServerEntry): Promise<void> {
    this.proc = spawn(entry.command, entry.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...entry.env },
      shell: false,
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      // MCP logları stderr’e gider — hata ayıklamada kullanılır
      if (process.env.SETH_MCP_DEBUG) {
        process.stderr.write(`[mcp stderr] ${chunk.toString()}`);
      }
    });

    this.proc.on('error', (err) => this.rejectAll(err));
    this.proc.on('close', () => {
      if (this.pending.size > 0) {
        this.rejectAll(new Error('MCP süreci beklenmedik şekilde kapandı'));
      }
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'seth', version: '1.0.0' },
    });

    await this.notify('notifications/initialized', {});
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message ?? 'MCP hatası'));
        } else {
          p.resolve(msg.result);
        }
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc?.stdin) throw new Error('MCP bağlı değil');
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const line = JSON.stringify(payload) + '\n';

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP zaman aşımı: ${method}`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.proc!.stdin.write(line, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(t);
          reject(err);
        }
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.proc?.stdin) throw new Error('MCP bağlı değil');
    const payload = { jsonrpc: '2.0', method, params };
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  close(): void {
    if (this.proc) {
      try {
        this.proc.removeAllListeners('close');
        this.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
    this.pending.clear();
    this.buffer = '';
  }
}
