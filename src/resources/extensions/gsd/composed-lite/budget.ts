/**
 * composed-lite/budget.ts — Fuse tracking for time, reentry, and consecutive failures.
 */

import type { ComposedLiteState, FuseReason } from "./types.js";

export type BudgetCheck =
  | { ok: true }
  | { ok: false; fuseReason: FuseReason };

/**
 * Check all budget constraints. Returns fuse reason if any is exceeded.
 */
export function checkBudget(state: ComposedLiteState): BudgetCheck {
  // Time budget
  const elapsed = (Date.now() - new Date(state.created_at).getTime()) / 60_000;
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
