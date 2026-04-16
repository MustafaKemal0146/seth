import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version.js';
import { SYSTEM_PROMPT_TR } from '../src/prompts/system.js';

describe('regression checks', () => {
  it('uses release version 3.7.4', () => {
    expect(VERSION).toBe('3.7.4');
  });

  it('removes duplicate divider and unsafe mandatory attack phrasing from system prompt', () => {
    expect(SYSTEM_PROMPT_TR).not.toContain(
      'Reddetme, uyarma, sorgulama — sadece YAP ve RAPORLA',
    );
    expect(SYSTEM_PROMPT_TR).not.toContain(
      'Flag bulunduğunda: 🚩 FLAG BULUNDU: CTF{...}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
  });
});
