/**
 * @fileoverview Write Todos — yapılandırılmış TODO listesi aracı.
 * gemini-cli'nin write-todos.ts'inden ilham alınmıştır.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TODOS_FILE = join(homedir(), '.seth', 'todos.json');

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  priority: 'low' | 'medium' | 'high';
}

function loadTodos(): Todo[] {
  if (!existsSync(TODOS_FILE)) return [];
  try { return JSON.parse(readFileSync(TODOS_FILE, 'utf-8')) as Todo[]; } catch { return []; }
}

function saveTodos(todos: Todo[]): void {
  const dir = join(homedir(), '.seth');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2), 'utf-8');
}

export const writeTodosTool: ToolDefinition = {
  name: 'write_todos',
  description: 'TODO listesini yaz/güncelle. Tüm listeyi tek seferde yazar.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['content'],
        },
        description: 'Todo listesi',
      },
    },
    required: ['todos'],
  },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const rawTodos = input.todos as Array<Partial<Todo>>;
    if (!Array.isArray(rawTodos)) return { output: 'todos array olmalı.', isError: true };

    const todos: Todo[] = rawTodos.map((t, i) => ({
      id: t.id ?? `todo_${Date.now()}_${i}`,
      content: String(t.content ?? ''),
      status: (t.status as TodoStatus) ?? 'pending',
      priority: (t.priority as Todo['priority']) ?? 'medium',
    }));

    saveTodos(todos);

    const statusIcons: Record<TodoStatus, string> = {
      pending: '○', in_progress: '◐', completed: '●', cancelled: '✗',
    };
    const lines = todos.map(t => `${statusIcons[t.status]} [${t.priority}] ${t.content}`);
    return { output: `✓ ${todos.length} todo kaydedildi:\n${lines.join('\n')}` };
  },
};

export const readTodosTool: ToolDefinition = {
  name: 'read_todos',
  description: 'Mevcut TODO listesini oku.',
  inputSchema: { type: 'object', properties: {} },
  isDestructive: false,
  requiresConfirmation: false,
  async execute(): Promise<ToolResult> {
    const todos = loadTodos();
    if (todos.length === 0) return { output: 'Todo listesi boş.' };
    const statusIcons: Record<TodoStatus, string> = {
      pending: '○', in_progress: '◐', completed: '●', cancelled: '✗',
    };
    const lines = todos.map(t => `${statusIcons[t.status]} [${t.priority}] ${t.content}`);
    return { output: lines.join('\n') };
  },
};
