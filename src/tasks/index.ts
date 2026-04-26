/**
 * @fileoverview SETH Görev Sistemi (Tasks) — v3.9.5
 * AGPL-3.0
 * AGPL-3.0
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface TaskDefinition {
  /** Görev benzersiz ID'si */
  id: string;
  /** Görev adı */
  name: string;
  /** Çalıştırılacak komut/dosya */
  command: string;
  /** Çalışma dizini */
  cwd: string;
  /** Durum */
  status: TaskStatus;
  /** Öncelik */
  priority: TaskPriority;
  /** Oluşturulma zamanı */
  createdAt: string;
  /** Başlama zamanı */
  startedAt?: string;
  /** Bitiş zamanı */
  completedAt?: string;
  /** Çıktı (başarılı) */
  output?: string;
  /** Hata mesajı */
  error?: string;
  /** Çıkış kodu */
  exitCode?: number;
  /** Süpervizör PID */
  pid?: number;
  /** Maksimum çalışma süresi (ms) */
  timeout?: number;
  /** Etiketler */
  tags?: string[];
  /** İlişkili akış ID'si */
  flowId?: string;
}

export interface TaskCreateParams {
  name: string;
  command: string;
  cwd?: string;
  priority?: TaskPriority;
  timeout?: number;
  tags?: string[];
  flowId?: string;
}

export interface TaskQuery {
  status?: TaskStatus;
  priority?: TaskPriority;
  tag?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const TASKS_DIR = join(homedir(), '.seth', 'tasks');
const TASKS_FILE = join(TASKS_DIR, 'tasks.json');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tasks: TaskDefinition[] = [];
let loaded = false;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function ensureDir(): void {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true });
  }
}

function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function log(msg: string): void {
  process.stderr.write(`[seth:tasks] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Task Registry
// ---------------------------------------------------------------------------

function loadTasks(): TaskDefinition[] {
  if (loaded) return tasks;
  loaded = true;
  ensureDir();
  
  if (existsSync(TASKS_FILE)) {
    try {
      tasks = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
    } catch {
      tasks = [];
    }
  }
  
  return tasks;
}

function saveTasks(): void {
  ensureDir();
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Task Yönetimi
// ---------------------------------------------------------------------------

export function createTask(params: TaskCreateParams): TaskDefinition {
  loadTasks();
  
  const task: TaskDefinition = {
    id: generateId(),
    name: params.name,
    command: params.command,
    cwd: params.cwd || process.cwd(),
    status: 'pending',
    priority: params.priority || 'normal',
    createdAt: new Date().toISOString(),
    timeout: params.timeout,
    tags: params.tags,
    flowId: params.flowId,
  };
  
  tasks.push(task);
  saveTasks();
  log(`Görev oluşturuldu: ${task.name} (${task.id})`);
  
  return task;
}

export async function executeTask(taskId: string): Promise<TaskDefinition> {
  loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Görev bulunamadı: ${taskId}`);
  
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  saveTasks();
  
  try {
    const { execSync } = await import('child_process');
    
    const output = execSync(task.command, {
      cwd: task.cwd,
      timeout: task.timeout || 300_000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    
    task.status = 'completed';
    task.output = output.trim();
    task.exitCode = 0;
    task.completedAt = new Date().toISOString();
  } catch (err: any) {
    task.status = 'failed';
    task.error = err.stderr || err.message || String(err);
    task.exitCode = err.status || 1;
    task.completedAt = new Date().toISOString();
  }
  
  saveTasks();
  return task;
}

export function cancelTask(taskId: string): boolean {
  loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'completed') return false;
  
  if (task.pid) {
    try {
      process.kill(task.pid, 'SIGTERM');
    } catch { /* process already gone */ }
  }
  
  task.status = 'cancelled';
  task.completedAt = new Date().toISOString();
  saveTasks();
  return true;
}

export function getTask(taskId: string): TaskDefinition | undefined {
  loadTasks();
  return tasks.find(t => t.id === taskId);
}

export function listTasks(query?: TaskQuery): TaskDefinition[] {
  loadTasks();
  
  let result = [...tasks];
  
  if (query?.status) {
    result = result.filter(t => t.status === query.status);
  }
  if (query?.priority) {
    result = result.filter(t => t.priority === query.priority);
  }
  if (query?.tag) {
    result = result.filter(t => t.tags?.includes(query.tag!));
  }
  
  if (query?.limit && query.limit > 0) {
    result = result.slice(0, query.limit);
  }
  
  return result;
}

export function clearCompletedTasks(): number {
  loadTasks();
  const before = tasks.length;
  tasks = tasks.filter(t => t.status === 'pending' || t.status === 'running');
  saveTasks();
  return before - tasks.length;
}

export function getTaskStats(): { total: number; running: number; completed: number; failed: number } {
  loadTasks();
  return {
    total: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };
}

// ---------------------------------------------------------------------------
// Background Task Runner (Arka Plan)
// ---------------------------------------------------------------------------

export function runInBackground(taskId: string): void {
  loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  
  // Arka planda çalıştır
  const child = require('child_process').spawn('sh', ['-c', task.command], {
    cwd: task.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  
  task.pid = child.pid;
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  saveTasks();
  
  let output = '';
  
  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString();
  });
  
  child.stderr?.on('data', (data: Buffer) => {
    output += data.toString();
  });
  
  child.on('close', (code: number) => {
    task.status = code === 0 ? 'completed' : 'failed';
    task.output = output.trim();
    task.exitCode = code;
    task.completedAt = new Date().toISOString();
    saveTasks();
    log(`Görev tamamlandı: ${task.name} (kod: ${code})`);
  });
  
  child.unref();
}

// ---------------------------------------------------------------------------
// İnisiyalizasyon
// ---------------------------------------------------------------------------

export function initTaskSystem(): void {
  loadTasks();
  const running = tasks.filter(t => t.status === 'running');
  for (const task of running) {
    task.status = 'failed';
    task.error = 'Seth yeniden başlatıldı, görev iptal oldu';
    task.completedAt = new Date().toISOString();
  }
  if (running.length > 0) {
    saveTasks();
    log(`${running.length} bekleyen görev iptal edildi (yeniden başlatma)`);
  }
}
