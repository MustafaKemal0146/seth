/**
 * @fileoverview Oturum görev listesini okur (Claude Code TodoWrite benzeri).
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { getAgentSessionContext, todoListesiniOku } from '../session-runtime.js';

export const gorevOkuTool: ToolDefinition = {
  name: 'gorev_oku',
  description:
    'Bu oturum için güncel görev listesini döndürür. ' +
    'Karmaşık işlerde ilerlemeyi takip etmek için önce okuyup sonra gorev_yaz ile güncelleyin.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(_input: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
    const sid = getAgentSessionContext();
    const list = todoListesiniOku(sid);
    if (list.length === 0) {
      return { output: '(Henüz görev yok. gorev_yaz ile ekleyin.)' };
    }
    const lines = list.map((g) => `- [${g.durum}] ${g.id}: ${g.baslik}`);
    return { output: lines.join('\n') };
  },
};
