/**
 * @fileoverview grep — search ile aynı uygulama (Claude Code Grep uyumluluğu).
 */

import type { ToolDefinition } from '../types.js';
import { searchTool } from './search.js';

export const grepTool: ToolDefinition = {
  ...searchTool,
  name: 'grep',
  description:
    'search aracı ile aynı: kod tabanında metin veya regex ara (ripgrep benzeri). ' +
    'node_modules ve ikili dosyalar atlanır.',
};
