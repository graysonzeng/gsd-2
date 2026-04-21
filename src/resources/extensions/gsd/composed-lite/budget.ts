/**
 * composed-lite/budget.ts — Fuse tracking for time, reentry, and consecutive failures.
 */

import type { ComposedLiteState, FuseReason } from "./types.js";

export type BudgetCheck =
  | { ok: true }
  | { ok: false; fuseReason: FuseReason };

function roundMinutes(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

export function getElapsedBudgetMinutes(state: ComposedLiteState, nowMs: number = Date.now()): number {
  const createdAtMs = new Date(state.created_at).getTime();
  const wallClockMinutes = Math.max(0, (nowMs - createdAtMs) / 60_000);
  const totalPausedMinutes = state.budget.total_paused_minutes ?? 0;
  const activePauseMinutes = state.budget.pause_started_at
    ? Math.max(0, (nowMs - new Date(state.budget.pause_started_at).getTime()) / 60_000)
    : 0;
  return Math.max(0, wallClockMinutes - totalPausedMinutes - activePauseMinutes);
}

export function syncElapsedBudgetMinutes(state: ComposedLiteState, nowMs: number = Date.now()): number {
  const elapsed = roundMinutes(getElapsedBudgetMinutes(state, nowMs));
  state.budget.elapsed_minutes = elapsed;
  return elapsed;
}

export function pauseBudget(state: ComposedLiteState, pausedAt: string = new Date().toISOString()): void {
  if (!state.budget.pause_started_at) {
    state.budget.pause_started_at = pausedAt;
  }
}

export function resumeBudget(state: ComposedLiteState, resumedAt: string = new Date().toISOString()): void {
  if (!state.budget.pause_started_at) {
    syncElapsedBudgetMinutes(state, new Date(resumedAt).getTime());
    return;
  }

  const pausedAtMs = new Date(state.budget.pause_started_at).getTime();
  const resumedAtMs = new Date(resumedAt).getTime();
  const pausedMinutes = Math.max(0, (resumedAtMs - pausedAtMs) / 60_000);
  state.budget.total_paused_minutes = (state.budget.total_paused_minutes ?? 0) + pausedMinutes;
  state.budget.pause_started_at = null;
  syncElapsedBudgetMinutes(state, resumedAtMs);
}

/**
 * Check all budget constraints. Returns fuse reason if any is exceeded.
 */
export function checkBudget(state: ComposedLiteState): BudgetCheck {
  // Time budget
  const elapsed = getElapsedBudgetMinutes(state);
  if (elapsed >= state.budget.max_time_minutes) {
    return { ok: false, fuseReason: "budget_time_exhausted" };
  }

  // Verify reentry budget
  if (state.budget.verify_reentry_count >= state.budget.max_verify_reentry) {
    return { ok: false, fuseReason: "verify_reentry_exhausted" };
  }

  // Consecutive failures
  if (state.budget.consecutive_failures >= state.budget.max_consecutive_failures) {
    return { ok: false, fuseReason: "consecutive_failures" };
  }

  return { ok: true };
}
