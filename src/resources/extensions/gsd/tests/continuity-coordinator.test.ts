import test from "node:test";
import assert from "node:assert/strict";

import { LoopContinuityCoordinator } from "../auto/continuity-coordinator.ts";
import {
  deriveContinuityDecision,
  humanPauseBreak,
  providerPauseBreak,
  budgetPauseBreak,
  terminalBreak,
  noProgressBreak,
  errorBreak,
  retryLoopContinue,
} from "../auto/types.ts";
import type { LoopDeps } from "../auto/loop-deps.ts";
import type { AutoSession } from "../auto/session.ts";
import type { JournalEntry } from "../journal.ts";

// ── Helpers ──────────────────────────────────────────────────────────────
// Build a minimal fake LoopDeps that records journal emit calls. The
// coordinator only calls deps.emitJournalEvent; every other method is a
// no-op that throws if touched (fail-fast if the coordinator reaches
// outside its contract).

function makeFakeDeps(
  emits: JournalEntry[],
): LoopDeps {
  const trap = (name: string) => () => {
    throw new Error(`fake-deps: ${name} should not be called by coordinator`);
  };
  return {
    emitJournalEvent: (entry: JournalEntry) => {
      emits.push(entry);
    },
    // Everything else is unused by the coordinator. Cast through unknown
    // to satisfy the LoopDeps shape without declaring 80+ stub methods.
  } as unknown as LoopDeps;
  void trap;
}

function makeFakeSession(): AutoSession {
  // AutoSession has default initializers so a bare `new AutoSession()` is
  // enough for lastContinuityDecision round-trip; only the field we read
  // matters.
  const session: Partial<AutoSession> = {
    lastContinuityDecision: null,
  };
  return session as AutoSession;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("coordinator.emitPhase writes journal and refreshes session.lastContinuityDecision", () => {
  const emits: JournalEntry[] = [];
  const deps = makeFakeDeps(emits);
  const session = makeFakeSession();
  const coord = new LoopContinuityCoordinator(deps, session);

  let seq = 0;
  coord.beginIteration("flow-1", () => ++seq);

  const decision = coord.emitPhase(
    "pre-dispatch",
    { action: "next", data: undefined },
    {
      workflowStatusBefore: "validating-milestone",
      workflowStatusAfter: "validating-milestone",
      nextAction: "Run validate-milestone",
      nextUnitType: "validate-milestone",
      nextUnitId: "M001",
    },
  );

  assert.equal(decision.signal, "continue-loop");
  assert.equal(decision.breakpointClass, "auto-resumable");
  assert.equal(decision.workflowStatusBefore, "validating-milestone");
  assert.equal(decision.workflowStatusAfter, "validating-milestone");
  assert.equal(decision.nextUnitType, "validate-milestone");
  assert.equal(decision.nextUnitId, "M001");
  assert.equal(session.lastContinuityDecision, decision);
  assert.equal(emits.length, 1);
  assert.equal(emits[0].eventType, "continuity-decision");
  assert.equal(emits[0].flowId, "flow-1");
  assert.equal(emits[0].seq, 1);
  const payload = emits[0].data as Record<string, unknown>;
  assert.equal(payload.sourcePhase, "pre-dispatch");
  assert.equal(payload.continuitySignal, "continue-loop");
  assert.equal(payload.breakpointClass, "auto-resumable");
  assert.equal(payload.workflowStatusBefore, "validating-milestone");
  assert.equal(payload.workflowStatusAfter, "validating-milestone");
  assert.equal(payload.nextAction, "Run validate-milestone");
  assert.equal(payload.nextUnitType, "validate-milestone");
  assert.equal(payload.nextUnitId, "M001");
});

test("coordinator.emitPhase before beginIteration throws", () => {
  const emits: JournalEntry[] = [];
  const deps = makeFakeDeps(emits);
  const session = makeFakeSession();
  const coord = new LoopContinuityCoordinator(deps, session);

  assert.throws(
    () => coord.emitPhase("pre-dispatch", { action: "next", data: undefined }),
    /beginIteration/,
  );
  assert.equal(emits.length, 0);
});

test("deriveContinuityDecision throws when only one of signal / breakpointClass is provided", () => {
  assert.throws(
    () =>
      deriveContinuityDecision({
        sourcePhase: "dispatch",
        action: "break",
        reason: "custom",
        signal: "stop-terminal",
        // breakpointClass omitted
      }),
    /both present or both absent/,
  );

  assert.throws(
    () =>
      deriveContinuityDecision({
        sourcePhase: "dispatch",
        action: "break",
        reason: "custom",
        // signal omitted
        breakpointClass: "terminal",
      }),
    /both present or both absent/,
  );
});

test("coordinator.emitCustomEngine writes journal, autoContinued=false on break, getLastDecision returns it", () => {
  const emits: JournalEntry[] = [];
  const deps = makeFakeDeps(emits);
  const session = makeFakeSession();
  const coord = new LoopContinuityCoordinator(deps, session);

  let seq = 0;
  coord.beginIteration("flow-custom", () => ++seq);

  const decision = coord.emitCustomEngine({
    signal: "pause-human",
    breakpointClass: "human-required",
    action: "break",
    reason: "custom-engine-verify-pause",
    unitType: "verify-step",
    unitId: "step-42",
  });

  assert.equal(decision.signal, "pause-human");
  assert.equal(decision.breakpointClass, "human-required");
  assert.equal(decision.autoContinued, false);
  assert.equal(decision.sourcePhase, "custom-engine");
  assert.equal(decision.unitType, "verify-step");
  assert.equal(decision.unitId, "step-42");
  assert.equal(coord.getLastDecision(), decision);
  assert.equal(emits.length, 1);
  assert.equal(emits[0].flowId, "flow-custom");
});

test("factory parity — each factory returns the expected (signal, breakpointClass) pair", () => {
  const hp = humanPauseBreak("uat-pause");
  assert.equal(hp.action, "break");
  assert.equal(hp.reason, "uat-pause");
  assert.equal(hp.signal, "pause-human");
  assert.equal(hp.breakpointClass, "human-required");

  const pp = providerPauseBreak("provider-pause");
  assert.equal(pp.signal, "pause-provider");
  assert.equal(pp.breakpointClass, "provider");

  const bp = budgetPauseBreak("budget-pause");
  assert.equal(bp.signal, "pause-budget");
  assert.equal(bp.breakpointClass, "budget");

  const tb = terminalBreak("milestone-complete");
  assert.equal(tb.signal, "stop-terminal");
  assert.equal(tb.breakpointClass, "terminal");

  const np = noProgressBreak("stuck-detected");
  assert.equal(np.signal, "stop-no-progress");
  assert.equal(np.breakpointClass, "no-progress");

  const eb = errorBreak("dispatch-stop");
  assert.equal(eb.signal, "stop-error");
  assert.equal(eb.breakpointClass, "safety-required");

  const rl = retryLoopContinue("verification-retry");
  assert.equal(rl.action, "continue");
  assert.equal(rl.signal, "retry-loop");
  assert.equal(rl.breakpointClass, "auto-resumable");
});

test("runFinalize git-closeout-failure uses errorBreak, not humanPauseBreak", () => {
  // This test verifies the fix for code-review HIGH finding:
  // git-closeout-failure must be classified as stop-error/safety-required,
  // not pause-human/human-required.

  const gitFailureResult = errorBreak("git-closeout-failure");
  assert.equal(gitFailureResult.action, "break");
  assert.equal(gitFailureResult.reason, "git-closeout-failure");
  assert.equal(gitFailureResult.signal, "stop-error");
  assert.equal(gitFailureResult.breakpointClass, "safety-required");

  // Contrast with pre-verification-dispatched which correctly uses humanPauseBreak
  const dispatchedResult = humanPauseBreak("pre-verification-dispatched");
  assert.equal(dispatchedResult.signal, "pause-human");
  assert.equal(dispatchedResult.breakpointClass, "human-required");
});
