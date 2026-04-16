/**
 * Paralel görev sistemi — arka planda shell komutları çalıştır, takip et.
 */

import { spawn, type ChildProcess } from 'child_process';
import chalk from 'chalk';
import type { ToolDefinition, ToolResult } from '../types.js';

export interface BackgroundTask {
  id: string;
  command: string;
  status: 'running' | 'done' | 'error';
  output: string;
  startTime: number;
  endTime?: number;
  pid?: number;
}

const tasks = new Map<string, BackgroundTask>();
let taskCounter = 0;

function newId(): string {
  return `task-${++taskCounter}`;
}

export const taskCreateTool: ToolDefinition = {
  name: 'task_create',
  description: 'Arka planda shell komutu çalıştır. Uzun süren işlemler için kullan. task_id döner.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Çalıştırılacak shell komutu' },
      description: { type: 'string', description: 'Görev açıklaması' },
    },
    required: ['command'],
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input, cwd): Promise<ToolResult> {
    const id = newId();
    const task: BackgroundTask = {
      id,
      command: input.command as string,
      status: 'running',
      output: '',
      startTime: Date.now(),
    };
    tasks.set(id, task);

    const child: ChildProcess = spawn('sh', ['-c', input.command as string], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    task.pid = child.pid;

    child.stdout?.on('data', d => { task.output += d.toString(); });
    child.stderr?.on('data', d => { task.output += d.toString(); });
    child.on('close', code => {
      task.status = code === 0 ? 'done' : 'error';
      task.endTime = Date.now();
    });

    return {
      output: `✓ Görev başlatıldı: ${id}\n  Komut: ${input.command}\n  Durum takibi için: task_list veya task_get("${id}")`,
      isError: false,
    };
  },
};

export const taskListTool: ToolDefinition = {
  name: 'task_list',
  description: 'Tüm arka plan görevlerini listele — durum, süre, çıktı özeti.',
  inputSchema: { type: 'object', properties: {} },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(): Promise<ToolResult> {
    if (tasks.size === 0) return { output: 'Aktif görev yok.', isError: false };
    const lines = ['📋 Arka Plan Görevleri:', ''];
    for (const t of tasks.values()) {
      const elapsed = ((( t.endTime ?? Date.now()) - t.startTime) / 1000).toFixed(1);
      const icon = t.status === 'running' ? '⏳' : t.status === 'done' ? '✓' : '✗';
      const color = t.status === 'running' ? chalk.yellow : t.status === 'done' ? chalk.green : chalk.red;
      lines.push(`  ${icon} ${color(t.id.padEnd(10))} ${t.status.padEnd(8)} ${elapsed}s  ${t.command.slice(0, 50)}`);
    }
    return { output: lines.join('\n'), isError: false };
  },
};

export const taskGetTool: ToolDefinition = {
  name: 'task_get',
  description: 'Belirli bir arka plan görevinin çıktısını ve durumunu getir.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Görev ID (task_list ile öğren)' },
    },
    required: ['task_id'],
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input): Promise<ToolResult> {
    const t = tasks.get(input.task_id as string);
    if (!t) return { output: `Görev bulunamadı: ${input.task_id}`, isError: true };
    const elapsed = (((t.endTime ?? Date.now()) - t.startTime) / 1000).toFixed(1);
    return {
      output: [
        `Görev: ${t.id}`,
        `Komut: ${t.command}`,
        `Durum: ${t.status}`,
        `Süre: ${elapsed}s`,
        '',
        '--- Çıktı ---',
        t.output.slice(-3000) || '(henüz çıktı yok)',
      ].join('\n'),
      isError: t.status === 'error',
    };
  },
};

export const taskStopTool: ToolDefinition = {
  name: 'task_stop',
  description: 'Çalışan bir arka plan görevini durdur.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Durdurulacak görev ID' },
    },
    required: ['task_id'],
  },
  isDestructive: true,
  requiresConfirmation: false,
  async execute(input): Promise<ToolResult> {
    const t = tasks.get(input.task_id as string);
    if (!t) return { output: `Görev bulunamadı: ${input.task_id}`, isError: true };
    if (t.status !== 'running') return { output: `Görev zaten durmuş: ${t.status}`, isError: false };
    if (t.pid) {
      try { process.kill(t.pid, 'SIGTERM'); } catch { /* zaten durmuş */ }
    }
    t.status = 'error';
    t.endTime = Date.now();
    return { output: `✓ Görev durduruldu: ${input.task_id}`, isError: false };
  },
};
