import { describe, it, expect } from 'vitest';
import { isToolAllowed } from '../src/tools/permission.js';
import type { ToolDefinition, ToolPermissionConfig } from '../src/types.js';

function mkTool(name: string, destructive = false): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: {},
    isDestructive: destructive,
    execute: async () => ({ output: 'ok' }),
  };
}

describe('security profile permission rules', () => {
  const base: ToolPermissionConfig = {
    allowedTools: [],
    deniedTools: [],
    deniedPatterns: [],
    requireConfirmation: true,
  };

  it('safe profilde güvenlik araçlarını engeller', () => {
    const res = isToolAllowed(mkTool('nmap'), {}, { ...base, securityProfile: 'safe' });
    expect(res.allowed).toBe(false);
  });

  it('safe profilde tehlikeli shell komutunu engeller', () => {
    const res = isToolAllowed(mkTool('shell'), { command: 'apt install nmap' }, { ...base, securityProfile: 'safe' });
    expect(res.allowed).toBe(false);
  });

  it('pentest profilde güvenlik araçlarına onaysız izin verir', () => {
    const res = isToolAllowed(mkTool('nuclei'), {}, { ...base, securityProfile: 'pentest' });
    expect(res.allowed).toBe(true);
    expect(res.needsConfirmation).toBe(false);
  });
});

