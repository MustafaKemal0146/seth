/**
 * @fileoverview Plan modu global state — REPL ile araçlar arasında sinyal taşır.
 */

export interface PlanModeState {
  active: boolean;
  reason: string;
  planText: string;
  waitingForApproval: boolean;
  approved?: boolean;
}

let planState: PlanModeState = {
  active: false,
  reason: '',
  planText: '',
  waitingForApproval: false,
};

export function getPlanModeState(): PlanModeState {
  return planState;
}

export function setPlanModeState(patch: Partial<PlanModeState>): void {
  planState = { ...planState, ...patch };
}

export function resetPlanModeState(): void {
  planState = {
    active: false,
    reason: '',
    planText: '',
    waitingForApproval: false,
  };
}

export function isPlanModeActive(): boolean {
  return planState.active;
}

export function isPlanWaitingApproval(): boolean {
  return planState.waitingForApproval;
}

export function approvePlan(): void {
  planState = { ...planState, waitingForApproval: false, approved: true };
}

export function rejectPlan(): void {
  planState = { ...planState, waitingForApproval: false, approved: false, active: false };
}
