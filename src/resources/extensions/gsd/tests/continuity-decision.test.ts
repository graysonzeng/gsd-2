import test from "node:test";
import assert from "node:assert/strict";

import { deriveContinuityDecision } from "../auto/types.ts";

test("deriveContinuityDecision maps next to continue-loop auto-resumable", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "dispatch",
    action: "next",
    unitType: "execute-task",
    unitId: "M001/S01/T01",
  });

  assert.equal(decision.signal, "continue-loop");
  assert.equal(decision.breakpointClass, "auto-resumable");
  assert.equal(decision.autoContinued, true);
});

test("deriveContinuityDecision maps verification retry to retry-loop auto-resumable", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "finalize",
    action: "continue",
    reason: "verification-retry",
    unitType: "execute-task",
    unitId: "M001/S01/T01",
  });

  assert.equal(decision.signal, "retry-loop");
  assert.equal(decision.breakpointClass, "auto-resumable");
  assert.equal(decision.autoContinued, true);
});

test("deriveContinuityDecision maps provider pause to pause-provider", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "unit",
    action: "break",
    reason: "provider-pause",
    unitType: "execute-task",
    unitId: "M001/S01/T01",
  });

  assert.equal(decision.signal, "pause-provider");
  assert.equal(decision.breakpointClass, "provider");
  assert.equal(decision.autoContinued, false);
});

test("deriveContinuityDecision maps budget pause to pause-budget", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "guard",
    action: "break",
    reason: "budget-pause",
  });

  assert.equal(decision.signal, "pause-budget");
  assert.equal(decision.breakpointClass, "budget");
  assert.equal(decision.autoContinued, false);
});

// Regression guard for HIGH-1 (code-review 2026-04-28):
// `budget-pause` must classify as pause-budget / budget regardless of which
// legacy-fallback branch order `deriveContinuityDecision` uses. This locks
// the contract even if the dedicated early-return branch gets refactored —
// previously `HUMAN_REQUIRED_REASONS` also contained "budget-pause", which
// would have silently downgraded the classification to pause-human if the
// early-return branch moved.
test("deriveContinuityDecision — budget-pause legacy fallback without explicit signal still maps to pause-budget", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "guard",
    action: "break",
    reason: "budget-pause",
    // NOTE: intentionally no signal / breakpointClass — exercise the
    // reason-based fallback path.
    unitType: "execute-task",
    unitId: "M001/S01/T01",
  });

  assert.equal(decision.signal, "pause-budget");
  assert.equal(decision.breakpointClass, "budget");
  assert.notEqual(decision.signal, "pause-human");
  assert.notEqual(decision.breakpointClass, "human-required");
  assert.equal(decision.autoContinued, false);
  assert.equal(decision.reason, "budget-pause");
});

test("deriveContinuityDecision maps milestone complete to stop-terminal", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "pre-dispatch",
    action: "break",
    reason: "milestone-complete",
  });

  assert.equal(decision.signal, "stop-terminal");
  assert.equal(decision.breakpointClass, "terminal");
});

test("deriveContinuityDecision maps stuck-detected to stop-no-progress", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "dispatch",
    action: "break",
    reason: "stuck-detected",
    unitType: "execute-task",
    unitId: "M001/S01/T01",
  });

  assert.equal(decision.signal, "stop-no-progress");
  assert.equal(decision.breakpointClass, "no-progress");
});

test("deriveContinuityDecision preserves explicit signal and breakpointClass", () => {
  const decision = deriveContinuityDecision({
    sourcePhase: "dispatch",
    action: "break",
    reason: "dispatch-stop",
    signal: "pause-human",
    breakpointClass: "human-required",
    unitType: "run-uat",
    unitId: "M001",
  });

  assert.equal(decision.signal, "pause-human");
  assert.equal(decision.breakpointClass, "human-required");
  assert.equal(decision.reason, "dispatch-stop");
  assert.equal(decision.unitType, "run-uat");
  assert.equal(decision.unitId, "M001");
});
