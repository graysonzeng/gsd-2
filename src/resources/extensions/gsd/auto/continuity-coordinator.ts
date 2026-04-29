/**
 * auto/continuity-coordinator.ts — Stage-A: emit-only owner.
 *
 * Centralizes ContinuityDecision construction and emission. This module
 * does NOT change loop control flow — it is a pure extraction of the
 * helpers previously inlined in auto/loop.ts (`emitContinuityDecision` /
 * `buildPhaseContinuityDecision`).
 *
 * Stage B will extend this module to drive `signal -> decision -> loop
 * action` decisions (`decideLoopAction(decision)`). That work is
 * intentionally NOT in this design — see §7 of the Stage A design doc.
 */

import type { LoopDeps } from "./loop-deps.js";
import type { AutoSession } from "./session.js";
import {
  deriveContinuityDecision,
  type ContinuityDecision,
  type ContinuitySignal,
  type ContinuitySourcePhase,
  type BreakpointClass,
  type PhaseResult,
} from "./types.js";

export class LoopContinuityCoordinator {
  private readonly deps: LoopDeps;
  private readonly session: AutoSession;
  private flowId: string | null = null;
  private nextSeq: (() => number) | null = null;

  constructor(deps: LoopDeps, session: AutoSession) {
    this.deps = deps;
    this.session = session;
  }

  /** Reset per-iteration flow grouping. Called from autoLoop top of each iter. */
  beginIteration(flowId: string, nextSeq: () => number): void {
    this.flowId = flowId;
    this.nextSeq = nextSeq;
  }

  /** Phase-driven emit (pre-dispatch / guard / dispatch / unit / finalize).
   *
   *  PhaseResult's three variants all carry `reason` / `signal` /
   *  `breakpointClass` at the type level (continue/next make them optional;
   *  break.reason is required). Read directly — no `"X" in result` guards
   *  and no per-action ternary needed.
   */
  emitPhase(
    sourcePhase: ContinuitySourcePhase,
    result: PhaseResult<unknown>,
    ctx?: {
      unitType?: string;
      unitId?: string;
      workflowStatusBefore?: string;
      workflowStatusAfter?: string;
      nextAction?: string;
      nextUnitType?: string;
      nextUnitId?: string;
      continuationBudgetRemaining?: number;
      sameUnitRepeatCount?: number;
      noProgressEvidence?: string[];
    },
  ): ContinuityDecision {
    const decision = deriveContinuityDecision({
      sourcePhase,
      action: result.action,
      reason: result.reason,
      signal: result.signal,
      breakpointClass: result.breakpointClass,
      unitType: ctx?.unitType,
      unitId: ctx?.unitId,
      workflowStatusBefore: ctx?.workflowStatusBefore,
      workflowStatusAfter: ctx?.workflowStatusAfter,
      nextAction: ctx?.nextAction,
      nextUnitType: ctx?.nextUnitType,
      nextUnitId: ctx?.nextUnitId,
      continuationBudgetRemaining: ctx?.continuationBudgetRemaining,
      sameUnitRepeatCount: ctx?.sameUnitRepeatCount,
      noProgressEvidence: ctx?.noProgressEvidence,
    });
    this.write(decision);
    return decision;
  }

  /** Custom-engine exit-point emit. Used for the 9 emit call sites in the
   *  custom-engine block of loop.ts (see Stage A design §3.2). Caller must
   *  always supply both signal and breakpointClass — the type signature
   *  enforces this. */
  emitCustomEngine(args: {
    signal: ContinuitySignal;
    breakpointClass: BreakpointClass;
    action: "continue" | "break" | "next";
    reason?: string;
    unitType?: string;
    unitId?: string;
  }): ContinuityDecision {
    const decision = deriveContinuityDecision({
      sourcePhase: "custom-engine",
      action: args.action,
      signal: args.signal,
      breakpointClass: args.breakpointClass,
      reason: args.reason,
      unitType: args.unitType,
      unitId: args.unitId,
    });
    this.write(decision);
    return decision;
  }

  /** Last decision currently held on the session. Stage B will use this
   *  as the input to decideLoopAction(); Stage A only exposes a getter. */
  getLastDecision(): ContinuityDecision | null {
    return this.session.lastContinuityDecision ?? null;
  }

  private write(decision: ContinuityDecision): void {
    if (this.flowId == null || this.nextSeq == null) {
      throw new Error(
        "LoopContinuityCoordinator.write called before beginIteration()",
      );
    }
    this.session.lastContinuityDecision = decision;
    this.deps.emitJournalEvent({
      ts: new Date().toISOString(),
      flowId: this.flowId,
      seq: this.nextSeq(),
      eventType: "continuity-decision",
      data: {
        sourcePhase: decision.sourcePhase,
        continuitySignal: decision.signal,
        breakpointClass: decision.breakpointClass,
        reason: decision.reason,
        unitType: decision.unitType,
        unitId: decision.unitId,
        autoContinued: decision.autoContinued,
        workflowStatusBefore: decision.workflowStatusBefore,
        workflowStatusAfter: decision.workflowStatusAfter,
        nextAction: decision.nextAction,
        nextUnitType: decision.nextUnitType,
        nextUnitId: decision.nextUnitId,
        continuationBudgetRemaining: decision.continuationBudgetRemaining,
        sameUnitRepeatCount: decision.sameUnitRepeatCount,
        noProgressEvidence: decision.noProgressEvidence,
      },
    });
  }
}
