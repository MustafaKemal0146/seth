import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempSandbox, cleanupTempSandbox, sandboxWriteFile, sandboxReadFile } from '../src/sandbox/index.js';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

describe('Sandbox Security', () => {
  let sandboxDir: string;
  let secretFile: string;

  beforeEach(() => {
    sandboxDir = createTempSandbox();
    secretFile = join(tmpdir(), 'secret.txt');
    writeFileSync(secretFile, 'secret content', 'utf-8');
  });

  afterEach(() => {
    cleanupTempSandbox(sandboxDir);
    // Cleanup secretFile if it still exists
    if (existsSync(secretFile)) {
      import('fs').then(fs => fs.rmSync(secretFile));
    }
  });

  it('prevents path traversal in sandboxWriteFile', () => {
    const maliciousPath = '../secret.txt';
    expect(() => {
      sandboxWriteFile(sandboxDir, maliciousPath, 'hacked');
    }).toThrow(/sandbox|traversal|Erişim/i);

    // Validate secret is not overwritten
    expect(readFileSync(secretFile, 'utf-8')).toBe('secret content');
  });

  it('prevents path traversal in sandboxReadFile', () => {
    const maliciousPath = '../secret.txt';
    expect(() => {
      sandboxReadFile(sandboxDir, maliciousPath);
    }).toThrow(/sandbox|traversal|Erişim/i);
  });
});
