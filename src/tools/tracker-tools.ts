/**
 * @fileoverview Tracker Tools — yapılandırılmış görev takibi.
 * gemini-cli'nin trackerTools.ts'inden ilham alınmıştır.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolDefinition, ToolResult } from '../types.js';

const TRACKER_FILE = join(homedir(), '.seth', 'tracker.json');

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';

export interface TrackerTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

function loadTasks(): TrackerTask[] {
  if (!existsSync(TRACKER_FILE)) return [];
  try { return JSON.parse(readFileSync(TRACKER_FILE, 'utf-8')) as TrackerTask[]; } catch { return []; }
}

function saveTasks(tasks: TrackerTask[]): void {
  const dir = join(homedir(), '.seth');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TRACKER_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

export const trackerReadTool: ToolDefinition = {
  name: 'tracker_read',
  description: 'Görev listesini oku. Tüm görevleri veya belirli duruma göre filtrele.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked', 'all'], description: 'Filtre (varsayılan: all)' },
    },
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tasks = loadTasks();
    const status = input.status as string ?? 'all';
    const filtered = status === 'all' ? tasks : tasks.filter(t => t.status === status);
    if (filtered.length === 0) return { output: 'Görev bulunamadı.' };
    const lines = filtered.map(t =>
      `[${t.id.slice(-4)}] ${t.status.toUpperCase().padEnd(12)} ${t.priority.padEnd(7)} ${t.title}${t.notes ? ` — ${t.notes}` : ''}`
    );
    return { output: `${filtered.length} görev:\n${lines.join('\n')}` };
  },
};

export const trackerWriteTool: ToolDefinition = {
  name: 'tracker_write',
  description: 'Görev ekle veya güncelle.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Görev ID (güncelleme için, yeni için boş bırak)' },
      title: { type: 'string', description: 'Görev başlığı' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      notes: { type: 'string', description: 'Notlar' },
    },
    required: ['title'],
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tasks = loadTasks();
    const now = new Date().toISOString();
    const id = input.id as string;

    if (id) {
      const idx = tasks.findIndex(t => t.id === id || t.id.endsWith(id));
      if (idx === -1) return { output: `Görev bulunamadı: ${id}`, isError: true };
      tasks[idx] = { ...tasks[idx]!, ...input as Partial<TrackerTask>, updatedAt: now };
      saveTasks(tasks);
      return { output: `✓ Görev güncellendi: ${tasks[idx]!.title}` };
    }

    const task: TrackerTask = {
      id: `task_${Date.now()}`,
      title: String(input.title ?? ''),
      status: (input.status as TaskStatus) ?? 'pending',
      priority: (input.priority as TrackerTask['priority']) ?? 'medium',
      notes: input.notes as string | undefined,
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    saveTasks(tasks);
    return { output: `✓ Görev eklendi: ${task.title} [${task.id.slice(-4)}]` };
  },
};
