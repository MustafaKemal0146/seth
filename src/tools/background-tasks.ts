/**
 * Paralel görev sistemi — arka planda shell komutları çalıştır, takip et.
 */

import { spawn, type ChildProcess } from 'child_process';
import chalk from 'chalk';
import type { ToolDefinition, ToolResult } from '../types.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface BackgroundTask {
  id: string;
  command: string;
  description?: string;
  cwd: string;
  status: 'running' | 'done' | 'error';
  output: string;
  startTime: number;
  endTime?: number;
  pid?: number;
}

const tasks = new Map<string, BackgroundTask>();
const activeChildren = new Map<string, ChildProcess>();
let taskCounter = Date.now();
let loaded = false;

const TASKS_DIR = join(homedir(), '.seth', 'tasks');
const TASKS_FILE = join(TASKS_DIR, 'background-tasks.json');
const MAX_OUTPUT_CHARS = 200_000;

function ensureTasksDir(): void {
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });
}

function persistTasks(): void {
  ensureTasksDir();
  const serialized = Array.from(tasks.values()).sort((a, b) => b.startTime - a.startTime);
  writeFileSync(TASKS_FILE, JSON.stringify(serialized, null, 2), 'utf-8');
}

function loadPersistedTasks(): void {
  if (loaded) return;
  loaded = true;

  ensureTasksDir();
  if (!existsSync(TASKS_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as BackgroundTask[];
    for (const task of data) {
      if (task.status === 'running') {
        task.status = 'error';
        task.endTime = Date.now();
        task.output = `${task.output}\n[recovery] Süreç yeniden başlatma sırasında kesildi.`;
      }
      tasks.set(task.id, task);
      const n = Number(task.id.split('-').pop() ?? 0);
      if (Number.isFinite(n)) taskCounter = Math.max(taskCounter, n);
    }
    persistTasks();
  } catch {
    // Bozuk dosyayı ezmeden yeni görevlerle devam edelim.
  }
}

function newId(): string {
  return `task-${++taskCounter}`;
}

function appendTaskOutput(task: BackgroundTask, chunk: string): void {
  task.output += chunk;
  if (task.output.length > MAX_OUTPUT_CHARS) {
    task.output = task.output.slice(-MAX_OUTPUT_CHARS);
  }
  persistTasks();
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
    loadPersistedTasks();
    const id = newId();
    const task: BackgroundTask = {
      id,
      command: input.command as string,
      description: input.description ? String(input.description) : undefined,
      cwd,
      status: 'running',
      output: '',
      startTime: Date.now(),
    };
    tasks.set(id, task);
    persistTasks();

    const child: ChildProcess = spawn('sh', ['-c', input.command as string], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.set(id, child);
    task.pid = child.pid;
    persistTasks();

    child.stdout?.on('data', d => appendTaskOutput(task, d.toString()));
    child.stderr?.on('data', d => appendTaskOutput(task, d.toString()));
    child.on('close', code => {
      task.status = code === 0 ? 'done' : 'error';
      task.endTime = Date.now();
      activeChildren.delete(id);
      persistTasks();
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
    loadPersistedTasks();
    if (tasks.size === 0) return { output: 'Aktif görev yok.', isError: false };
    const lines = ['📋 Arka Plan Görevleri:', ''];
    for (const t of tasks.values()) {
      const elapsed = ((( t.endTime ?? Date.now()) - t.startTime) / 1000).toFixed(1);
      const icon = t.status === 'running' ? '⏳' : t.status === 'done' ? '✓' : '✗';
      const color = t.status === 'running' ? chalk.yellow : t.status === 'done' ? chalk.green : chalk.red;
      const desc = t.description ? ` (${t.description.slice(0, 30)})` : '';
      lines.push(`  ${icon} ${color(t.id.padEnd(12))} ${t.status.padEnd(8)} ${elapsed}s  ${t.command.slice(0, 40)}${desc}`);
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
    loadPersistedTasks();
    const t = tasks.get(input.task_id as string);
    if (!t) return { output: `Görev bulunamadı: ${input.task_id}`, isError: true };
    const elapsed = (((t.endTime ?? Date.now()) - t.startTime) / 1000).toFixed(1);
    return {
      output: [
        `Görev: ${t.id}`,
        `Komut: ${t.command}`,
        `Açıklama: ${t.description ?? '(yok)'}`,
        `Dizin: ${t.cwd}`,
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
    loadPersistedTasks();
    const t = tasks.get(input.task_id as string);
    if (!t) return { output: `Görev bulunamadı: ${input.task_id}`, isError: true };
    if (t.status !== 'running') return { output: `Görev zaten durmuş: ${t.status}`, isError: false };

    const child = activeChildren.get(t.id);
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* süreç zaten durmuş olabilir */ }
      activeChildren.delete(t.id);
    } else if (t.pid) {
      try { process.kill(t.pid, 'SIGTERM'); } catch { /* süreç zaten durmuş olabilir */ }
    }
    t.status = 'error';
    t.endTime = Date.now();
    t.output += '\n[manual-stop] Görev kullanıcı tarafından durduruldu.';
    persistTasks();
    return { output: `✓ Görev durduruldu: ${input.task_id}`, isError: false };
  },
};
