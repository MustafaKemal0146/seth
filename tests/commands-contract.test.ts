import { describe, it, expect } from 'vitest';
import { COMMANDS, COMMAND_ALIASES, getPublicCommandNames, getPublicSlashCommands } from '../src/commands.js';

describe('command contract', () => {
  it('yardım sözleşmesindeki tüm komutlar handler içerir', () => {
    const missing = getPublicCommandNames().filter((name) => typeof COMMANDS[name] !== 'function');
    expect(missing).toEqual([]);
  });

  it('alias hedefleri geçerli komutlara işaret eder', () => {
    const broken = Object.entries(COMMAND_ALIASES).filter(([, target]) => typeof COMMANDS[target] !== 'function');
    expect(broken).toEqual([]);
  });

  it('autocomplete listesi yardım sözleşmesi ile uyumlu', () => {
    const slash = getPublicSlashCommands();
    const bad = slash.filter((entry) => !entry.startsWith('/') || typeof COMMANDS[entry.slice(1)] !== 'function');
    expect(bad).toEqual([]);
  });
});

