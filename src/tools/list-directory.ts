/**
 * @fileoverview List directory tool — tree-like directory listing.
 */

import { readdir, stat } from 'fs/promises';
import { resolve, join, relative } from 'path';
import type { ToolDefinition, ToolResult } from '../types.js';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ENTRIES = 200;

export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description:
    'Dizin içeriğini ağaç benzeri listeler; dosya ve alt klasör türlerini gösterir.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Dizin yolu (mutlak veya cwd’ye göreli). Varsayılan: cwd',
      },
      max_depth: { type: 'number', description: `Maksimum derinlik. Varsayılan: ${DEFAULT_MAX_DEPTH}` },
      show_hidden: {
        type: 'boolean',
        description: 'Nokta (.) ile başlayan gizli öğeleri göster. Varsayılan: false',
      },
      pattern: { type: 'string', description: 'Glob benzeri süzgeç (örn. "*.ts", "src/*").' },
    },
    required: [],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const targetPath = resolve(cwd, (input.path as string) ?? '.');
    const maxDepth = (input.max_depth as number) ?? DEFAULT_MAX_DEPTH;
    const showHidden = (input.show_hidden as boolean) ?? false;
    const pattern = input.pattern as string | undefined;

    try {
      const entries: string[] = [];
      let totalEntries = 0;

      await walkDirectory(targetPath, '', 0, maxDepth, showHidden, pattern, entries, {
        count: 0,
        max: DEFAULT_MAX_ENTRIES,
      });

      if (entries.length === 0) {
        return { output: `Directory "${targetPath}" is empty or no matches found.` };
      }

      const header = `📁 ${targetPath}\n${'─'.repeat(40)}\n`;
      const truncated = entries.length >= DEFAULT_MAX_ENTRIES 
        ? `\n... (truncated at ${DEFAULT_MAX_ENTRIES} entries)`
        : '';

      return { output: header + entries.join('\n') + truncated };
    } catch (err) {
      return { 
        output: `Cannot list directory "${targetPath}": ${err instanceof Error ? err.message : String(err)}`, 
        isError: true 
      };
    }
  },
};

interface Counter {
  count: number;
  max: number;
}

async function walkDirectory(
  basePath: string,
  relativePath: string,
  depth: number,
  maxDepth: number,
  showHidden: boolean,
  pattern: string | undefined,
  entries: string[],
  counter: Counter,
  prefix: string = '',
): Promise<void> {
  if (counter.count >= counter.max) return;
  if (depth > maxDepth) return;

  const currentPath = relativePath ? join(basePath, relativePath) : basePath;
  
  let items: string[];
  try {
    items = await readdir(currentPath);
  } catch {
    return;
  }

  const sorted = await sortEntries(currentPath, items);
  const visible = sorted.filter(item => (showHidden || !item.startsWith('.')) && (!pattern || matchesPattern(item, pattern)));

  for (let idx = 0; idx < visible.length; idx++) {
    if (counter.count >= counter.max) return;
    const item = visible[idx]!;
    const isLast = idx === visible.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    const itemRelPath = relativePath ? join(relativePath, item) : item;
    const fullPath = join(basePath, itemRelPath);

    let isDir = false;
    try {
      const stats = await stat(fullPath);
      isDir = stats.isDirectory();
    } catch {
      continue;
    }

    const icon = isDir ? '📂' : getFileIcon(item);
    entries.push(`${prefix}${connector}${icon} ${item}${isDir ? '/' : ''}`);
    counter.count++;

    if (isDir && depth < maxDepth) {
      await walkDirectory(basePath, itemRelPath, depth + 1, maxDepth, showHidden, pattern, entries, counter, prefix + childPrefix);
    }
  }
}

async function sortEntries(dirPath: string, items: string[]): Promise<string[]> {
  const dirs: string[] = [];
  const files: string[] = [];

  for (const item of items) {
    try {
      const stats = await stat(join(dirPath, item));
      if (stats.isDirectory()) {
        dirs.push(item);
      } else {
        files.push(item);
      }
    } catch {
      files.push(item);
    }
  }

  return [...dirs.sort(), ...files.sort()];
}

function matchesPattern(name: string, pattern: string): boolean {
  // Simple glob matching: * matches anything, ? matches single char
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*/g, '.*')                  // * -> .*
    .replace(/\?/g, '.');                  // ? -> .
  
  return new RegExp(`^${regex}$`, 'i').test(name);
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  
  const iconMap: Record<string, string> = {
    ts: '🔷',
    tsx: '⚛️',
    js: '📜',
    jsx: '⚛️',
    json: '📋',
    md: '📝',
    txt: '📄',
    html: '🌐',
    css: '🎨',
    scss: '🎨',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
    java: '☕',
    c: '⚙️',
    cpp: '⚙️',
    h: '⚙️',
    sh: '🐚',
    yml: '⚙️',
    yaml: '⚙️',
    toml: '⚙️',
    lock: '🔒',
    env: '🔐',
    git: '📦',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    svg: '🖼️',
    gif: '🖼️',
  };

  return iconMap[ext] ?? '📄';
}
