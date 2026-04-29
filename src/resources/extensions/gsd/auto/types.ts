/**
 * auto/types.ts — Constants and types shared across auto-loop modules.
 *
 * Leaf node in the import DAG — no imports from auto/.
 */

import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";

import type { AutoSession } from "./session.js";
import type { GSDPreferences } from "../preferences.js";
import type { GSDState } from "../types.js";
import type { CmuxLogLevel } from "../../shared/cmux-events.js";
import type { LoopDeps } from "./loop-deps.js";

/**
 * Maximum total loop iterations before forced stop. Prevents runaway loops
 * when units alternate IDs (bypassing the same-unit stuck detector).
 * A milestone with 20 slices × 5 tasks × 3 phases ≈ 300 units. 500 gives
 * generous headroom including retries and sidecar work.
 */
export const MAX_LOOP_ITERATIONS = 500;
/** Maximum characters of failure/crash context included in recovery prompts. */
export const MAX_RECOVERY_CHARS = 50_000;

/** Data-driven budget threshold notifications (descending). The 100% entry
 *  triggers special enforcement logic (halt/pause/warn); sub-100 entries fire
 *  a simple notification. */
export const BUDGET_THRESHOLDS: Array<{
  pct: number;
  label: string;
  notifyLevel: "info" | "warning" | "error";
  cmuxLevel: "progress" | "warning" | "error";
}> = [
  { pct: 100, label: "Budget ceiling reached", notifyLevel: "error", cmuxLevel: "error" },
  { pct: 90, label: "Budget 90%", notifyLevel: "warning", cmuxLevel: "warning" },
  { pct: 80, label: "Approaching budget ceiling — 80%", notifyLevel: "warning", cmuxLevel: "warning" },
  { pct: 75, label: "Budget 75%", notifyLevel: "info", cmuxLevel: "progress" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Minimal shape of the event parameter from pi.on("agent_end", ...).
 * The full event has more fields, but the loop only needs messages.
 */
export interface AgentEndEvent {
  messages: unknown[];
}

/**
 * Structured error context attached to a UnitResult when the unit ends
 * due to an infrastructure or timeout error (not user-driven cancellation).
 */
export interface ErrorContext {
  message: string;
  category: "provider" | "timeout" | "idle" | "network" | "aborted" | "session-failed" | "unknown";
  stopReason?: string;
  isTransient?: boolean;
  retryAfterMs?: number;
}

/**
 * Result of a single unit execution (one iteration of the loop).
 */
export interface UnitResult {
  status: "completed" | "cancelled" | "error";
  event?: AgentEndEvent;
  errorContext?: ErrorContext;
}

// ─── Phase pipeline types ────────────────────────────────────────────────────

export type ContinuitySignal =
  | "complete"
  | "continue-loop"
  | "retry-loop"
  | "pause-human"
  | "pause-provider"
  | "pause-budget"
  | "stop-error"
  | "stop-terminal"
  | "stop-no-progress";

export type BreakpointClass =
  | "human-required"
  | "provider"
  | "safety-required"
  | "auto-resumable"
  | "no-progress"
  | "budget"
  | "terminal"
  | "unknown";

export type ContinuitySourcePhase =
  | "pre-dispatch"
  | "guard"
  | "dispatch"
  | "unit"
  | "finalize"
  | "custom-engine"
  | "loop";

export interface ContinuityDecision {
  sourcePhase: ContinuitySourcePhase;
  signal: ContinuitySignal;
  breakpointClass: BreakpointClass;
  reason?: string;
  unitType?: string;
  unitId?: string;
  autoContinued: boolean;
  workflowStatusBefore?: string;
  workflowStatusAfter?: string;
  nextAction?: string;
  nextUnitType?: string;
  nextUnitId?: string;
  continuationBudgetRemaining?: number;
  sameUnitRepeatCount?: number;
  noProgressEvidence?: string[];
}

export interface ContinuityDecisionInput {
  sourcePhase: ContinuitySourcePhase;
  action: "continue" | "break" | "next";
  reason?: string;
  unitType?: string;
  unitId?: string;
  signal?: ContinuitySignal;
  breakpointClass?: BreakpointClass;
  workflowStatusBefore?: string;
  workflowStatusAfter?: string;
  nextAction?: string;
  nextUnitType?: string;
  nextUnitId?: string;
  continuationBudgetRemaining?: number;
  sameUnitRepeatCount?: number;
  noProgressEvidence?: string[];
}

// The following reason sets are used only as a *legacy fallback* by
// `deriveContinuityDecision` when a phase return-site does not yet provide an
// explicit `signal` + `breakpointClass`. New phase out-sites SHOULD declare
// both fields directly on `PhaseResult` rather than relying on reason-string
// classification here. Keep these sets minimal and non-overlapping — any reason
// with a dedicated early-return branch (e.g. `budget-pause`) MUST NOT appear in
// the per-class sets below, otherwise the classification becomes ambiguous and
// prone to silent drift if branch ordering changes.
const RETRY_REASONS = new Set([
  "artifact-verification-retry",
  "verification-retry",
  "custom-engine-verify-retry",
  "stuck-recovery",
]);

const HUMAN_REQUIRED_REASONS = new Set([
  "uat-pause",
  "verification-pause",
  "step-wizard",
  "user-stop",
  "user-backtrack",
  "context-window",
]);

const PROVIDER_REASONS = new Set([
  "provider-pause",
]);

const NO_PROGRESS_REASONS = new Set([
  "stuck-detected",
  "complete-milestone-artifact-db-mismatch",
  "state-unchanged",
]);

const TERMINAL_REASONS = new Set([
  "milestone-complete",
  "no-active-milestone",
  "custom-engine-complete",
]);

export function deriveContinuityDecision(input: ContinuityDecisionInput): ContinuityDecision {
  // Pair-contract invariant: signal and breakpointClass must be both present
  // or both absent. Half-supplied input is a programmer error — either the
  // factory was misused, or a phase return-site partially migrated. The
  // legacy reason-based fallback below intentionally only fires when *both*
  // are missing.
  if ((input.signal == null) !== (input.breakpointClass == null)) {
    throw new Error(
      `ContinuityDecisionInput requires signal and breakpointClass to be both present or both absent (sourcePhase=${input.sourcePhase}, action=${input.action}, reason=${input.reason ?? ""}, hasSignal=${input.signal != null}, hasBreakpointClass=${input.breakpointClass != null})`,
    );
  }

  if (input.signal && input.breakpointClass) {
    return {
      sourcePhase: input.sourcePhase,
      signal: input.signal,
      breakpointClass: input.breakpointClass,
      reason: input.reason,
      unitType: input.unitType,
      unitId: input.unitId,
      autoContinued: input.action !== "break",
      workflowStatusBefore: input.workflowStatusBefore,
      workflowStatusAfter: input.workflowStatusAfter,
      nextAction: input.nextAction,
      nextUnitType: input.nextUnitType,
      nextUnitId: input.nextUnitId,
      continuationBudgetRemaining: input.continuationBudgetRemaining,
      sameUnitRepeatCount: input.sameUnitRepeatCount,
      noProgressEvidence: input.noProgressEvidence,
    };
  }

  let signal: ContinuitySignal;
  let breakpointClass: BreakpointClass;

  if (input.action === "next") {
    signal = "continue-loop";
    breakpointClass = "auto-resumable";
  } else if (input.action === "continue") {
    signal = RETRY_REASONS.has(input.reason ?? "") ? "retry-loop" : "continue-loop";
    breakpointClass = "auto-resumable";
  } else if (input.reason === "budget-pause") {
    signal = "pause-budget";
    breakpointClass = "budget";
  } else if (PROVIDER_REASONS.has(input.reason ?? "")) {
    signal = "pause-provider";
    breakpointClass = "provider";
  } else if (HUMAN_REQUIRED_REASONS.has(input.reason ?? "")) {
    signal = "pause-human";
    breakpointClass = "human-required";
  } else if (NO_PROGRESS_REASONS.has(input.reason ?? "")) {
    signal = "stop-no-progress";
    breakpointClass = "no-progress";
  } else if (TERMINAL_REASONS.has(input.reason ?? "")) {
    signal = "stop-terminal";
    breakpointClass = "terminal";
  } else {
    signal = "stop-error";
    breakpointClass = "safety-required";
  }

  return {
    sourcePhase: input.sourcePhase,
    signal,
    breakpointClass,
    reason: input.reason,
    unitType: input.unitType,
    unitId: input.unitId,
    autoContinued: input.action !== "break",
    workflowStatusBefore: input.workflowStatusBefore,
    workflowStatusAfter: input.workflowStatusAfter,
    nextAction: input.nextAction,
    nextUnitType: input.nextUnitType,
    nextUnitId: input.nextUnitId,
    continuationBudgetRemaining: input.continuationBudgetRemaining,
    sameUnitRepeatCount: input.sameUnitRepeatCount,
    noProgressEvidence: input.noProgressEvidence,
  };
}

export type PhaseResult<T = void> =
  | { action: "continue"; reason?: string; signal?: ContinuitySignal; breakpointClass?: BreakpointClass }
  | { action: "break"; reason: string; signal?: ContinuitySignal; breakpointClass?: BreakpointClass }
  | { action: "next"; data: T; reason?: string; signal?: ContinuitySignal; breakpointClass?: BreakpointClass }

export interface IterationContext {
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  s: AutoSession;
  deps: LoopDeps;
  prefs: GSDPreferences | undefined;
  iteration: number;
  /** UUID grouping all journal events for this iteration. */
  flowId: string;
  /** Returns the next monotonically increasing sequence number (1-based, reset per iteration). */
  nextSeq: () => number;
}

export interface LoopState {
  recentUnits: Array<{ key: string; error?: string }>;
  stuckRecoveryAttempts: number;
  /** Consecutive finalize timeout count — stops auto-mode after threshold. */
  consecutiveFinalizeTimeouts: number;
}

export type AutoLoopStopReason =
  | "max-iterations"
  | "timeout"
  | "memory-pressure"
  | "missing-command-context"
  | "session-lock-lost"
  | "custom-engine-complete"
  | "custom-engine-stop"
  | "custom-engine-verify-pause"
  | "custom-engine-verify-retry-exhausted"
  | "custom-engine-reconcile-pause"
  | "guard-break"
  | "pre-dispatch-break"
  | "dispatch-break"
  | "unit-break"
  | "finalize-break"
  | "state-unchanged"
  | "infrastructure-error"
  | "cooldown-budget-exceeded"
  | "consecutive-iteration-failures"
  | "inactive";

export interface AutoLoopIterationReport {
  index: number;
  unitType?: string;
  unitId?: string;
  status: "completed" | "failed" | "paused" | "stopped" | "skipped" | "retry";
  failureClass: "none" | "unknown" | "manual-attention" | "timeout" | "execution" | "closeout" | "git";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
}

export interface AutoLoopReport {
  status: "completed" | "stopped" | "failed" | "paused";
  stopReason: AutoLoopStopReason;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  totalIterations: number;
  iterations: AutoLoopIterationReport[];
}

/** Max consecutive finalize timeouts before hard-stopping auto-mode. */
export const MAX_FINALIZE_TIMEOUTS = 3;

export interface PreDispatchData {
  state: GSDState;
  mid: string;
  midTitle: string;
}

export interface IterationData {
  unitType: string;
  unitId: string;
  prompt: string;
  finalPrompt: string;
  pauseAfterUatDispatch: boolean;
  state: GSDState;
  mid: string | undefined;
  midTitle: string | undefined;
  isRetry: boolean;
  previousTier: string | undefined;
  /** Model override from pre-dispatch hooks (applied after standard model selection). */
  hookModelOverride?: string;
}

export type WindowEntry = { key: string; error?: string };

// ─── PhaseResult helper factories ─────────────────────────────────────────
//
// Each factory binds (signal, breakpointClass) at the type level so callers
// cannot construct mismatched pairs. Pause variants are split into three
// distinct factories (human / provider / budget) so the (signal, class)
// combination is fixed by the function name itself — see design §3.3.2 and
// design-review HIGH-3.

/** Construct a `break` PhaseResult signalling a human-required pause. */
export function humanPauseBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "pause-human",
    breakpointClass: "human-required",
  };
}

/** Construct a `break` PhaseResult signalling a provider-side pause. */
export function providerPauseBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "pause-provider",
    breakpointClass: "provider",
  };
}

/** Construct a `break` PhaseResult signalling a budget-imposed pause. */
export function budgetPauseBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "pause-budget",
    breakpointClass: "budget",
  };
}

/** Construct a `break` PhaseResult signalling terminal completion
 *  (e.g. `milestone-complete`, `no-active-milestone`,
 *  `custom-engine-complete`). */
export function terminalBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "stop-terminal",
    breakpointClass: "terminal",
  };
}

/** Construct a `break` PhaseResult signalling a no-progress stop
 *  (e.g. `stuck-detected`, `state-unchanged`,
 *  `complete-milestone-artifact-db-mismatch`). */
export function noProgressBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "stop-no-progress",
    breakpointClass: "no-progress",
  };
}

/** Construct a `break` PhaseResult signalling a safety-required stop
 *  (catch-all for `stop-error` / `safety-required`). */
export function errorBreak(reason: string): PhaseResult<never> {
  return {
    action: "break",
    reason,
    signal: "stop-error",
    breakpointClass: "safety-required",
  };
}

/** Construct a `continue` PhaseResult signalling a bounded retry loop
 *  (used by `artifact-verification-retry` / `verification-retry`). */
export function retryLoopContinue(reason: string): PhaseResult<never> {
  return {
    action: "continue",
    reason,
    signal: "retry-loop",
    breakpointClass: "auto-resumable",
  };
}
