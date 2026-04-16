/**
 * @fileoverview Plan Modu araçları — EnterPlanMode / ExitPlanMode.
 *
 * Plan modu nasıl çalışır:
 *   1. Ajan, karmaşık bir görevi aldığında enter_plan_mode aracını çağırır.
 *   2. Ajan planlama mesajı yazar (ne yapacağını adım adım).
 *   3. exit_plan_mode aracını çağırarak planı sunar.
 *   4. REPL kullanıcıya "Onayla / Reddet?" diye sorar.
 *   5. Onaylanırsa ajan planı uygular, reddedilirse durur.
 */

import type { ToolDefinition, ToolResult } from '../types.js';
import { setPlanModeState } from '../plan-mode-state.js';

// ─── Enter Plan Mode ──────────────────────────────────────────────────────────

export const enterPlanModeTool: ToolDefinition = {
  name: 'enter_plan_mode',
  description:
    'Karmaşık veya yıkıcı (dosya silme, büyük refactor, çok adımlı görev) işlemlerde ' +
    'önce kullanıcıya plan sun, onay al, sonra uygula. ' +
    'Bu aracı çağırmak plan modunu başlatır; ardından planını yaz, sonra exit_plan_mode ile bitir.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Neden plan modu açılıyor? (görevin kısa özeti)',
      },
    },
    required: ['reason'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const reason = String(input.reason ?? 'Yüksek etkili görev');
    setPlanModeState({ active: true, reason, planText: '', waitingForApproval: false });
    return {
      output:
        `Plan modu aktif. Görev: "${reason}"\n` +
        `Şimdi planını yaz (ne yapacaksın, hangi dosyalara dokunacaksın, hangi komutları çalıştıracaksın).\n` +
        `Planı yazdıktan sonra exit_plan_mode aracını çağır.`,
      isError: false,
    };
  },
};

// ─── Exit Plan Mode ───────────────────────────────────────────────────────────

export const exitPlanModeTool: ToolDefinition = {
  name: 'exit_plan_mode',
  description:
    'Planı kullanıcıya sunar ve onay bekler. ' +
    'plan_summary parametresine yazmak istediğin adımları ver. ' +
    'Kullanıcı onaylamadan ASLA gerçek değişiklik yapma.',
  inputSchema: {
    type: 'object',
    properties: {
      plan_summary: {
        type: 'string',
        description: 'Uygulayacağın planın madde madde özeti.',
      },
    },
    required: ['plan_summary'],
  },
  isDestructive: false,
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const planSummary = String(input.plan_summary ?? '');
    setPlanModeState({ active: true, reason: '', planText: planSummary, waitingForApproval: true });

    // Bu araç çağrısından dönen mesaj agent loop'a gider.
    // REPL, waitingForApproval=true görünce kullanıcıdan onay alır.
    // Onay verilirse agentResumePlan=true set edilir, reddedilirse abort edilir.
    return {
      output:
        `__PLAN_APPROVAL_REQUIRED__\n${planSummary}`,
      isError: false,
    };
  },
};
