// Phase-discipline reviewer blocking semantics
//
// Verifies the registry-level wiring of the BLOCKED sentinel (subsystem failure)
// and the `max_cycles_reached` blocking when the trigger keeps producing a
// retry_on artifact. Both must surface via `isHookBlocked()` so the auto loop
// can pause rather than silently treat the unfinished review as a pass.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  checkPostUnitHooks,
  consumeBlockedHook,
  isHookBlocked,
  isRetryPending,
  peekBlockedHook,
  resetHookState,
  resolveHookArtifactPath,
} from "../../post-unit-hooks.ts";

function createProjectFixture(): { project: string; home: string } {
  const project = mkdtempSync(join(tmpdir(), "gsd-phase-blocking-project-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-phase-blocking-home-"));
  mkdirSync(join(project, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  writeFileSync(
    join(project, ".gsd", "PREFERENCES.md"),
    [
      "---",
      "version: 1",
      "milestone_profile: phase-discipline-8step",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
  return { project, home };
}

test("reviewer hook BLOCKED sentinel surfaces via isHookBlocked with reason reviewer_unavailable", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    // First fire — code-review hook is dispatched after execute-task.
    const dispatch = checkPostUnitHooks("execute-task", "M001/S01/T01", project);
    assert.notEqual(dispatch, null, "code-review hook must dispatch after execute-task");
    assert.equal(dispatch?.unitType, "hook/phase-discipline-code-review");

    // Simulate `runPhaseDisciplineReviewerHook` writing the BLOCKED sentinel
    // (subsystem failure path). retry_on must NOT exist for this case.
    const blockedPath = resolveHookArtifactPath(project, "M001/S01/T01", "CODE-REVIEW-BLOCKED.md");
    writeFileSync(blockedPath, "# blocked\n- Block Reason: reviewer_unavailable\n", "utf8");

    // Hook completion now reports BLOCKED instead of advancing or retrying.
    const completion = checkPostUnitHooks(dispatch!.unitType, dispatch!.unitId, project);
    assert.equal(completion, null);
    assert.equal(isRetryPending(), false, "retry_on must not be raised on subsystem failure");
    assert.equal(isHookBlocked(), true, "registry must surface blocked state");
    const blocker = consumeBlockedHook();
    assert.ok(blocker, "blocker record must be populated");
    assert.equal(blocker!.reason, "reviewer_unavailable");
    assert.equal(blocker!.hookName, "phase-discipline-code-review");
    assert.equal(blocker!.triggerUnitId, "M001/S01/T01");
    assert.equal(blocker!.artifactPath, blockedPath);
    assert.equal(isHookBlocked(), false, "consume clears the blocked record");
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("reviewer hook retry_on with cycle == max_cycles surfaces blocked with reason max_cycles_reached", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    // Cycle 1 dispatch.
    const first = checkPostUnitHooks("execute-task", "M001/S01/T01", project);
    assert.notEqual(first, null);

    // Reviewers returned a non-pass verdict → write retry_on. Cycle 1 < 2,
    // so this must trigger a retry of the trigger unit.
    const retryPath = resolveHookArtifactPath(project, "M001/S01/T01", "CODE-REVIEW-RETRY.md");
    writeFileSync(retryPath, "retry requested by code-review\n", "utf8");
    const firstCompletion = checkPostUnitHooks(first!.unitType, first!.unitId, project);
    assert.equal(firstCompletion, null);
    assert.equal(isRetryPending(), true, "cycle 1 retry should fire");
    assert.equal(isHookBlocked(), false, "cycle 1 must not block yet");

    // Operator clears retry artifact and execute-task is dispatched again
    // (auto-loop simulation). Now cycle 2 of the hook fires.
    rmSync(retryPath, { force: true });
    // consumeRetryTrigger() drained in real flow; not strictly needed here.
    const second = checkPostUnitHooks("execute-task", "M001/S01/T01", project);
    assert.notEqual(second, null);

    // Cycle 2 reviewers still produced a non-pass verdict and wrote retry_on
    // again. With cycle 2 == max_cycles (2), the registry must NOT silently
    // proceed — instead surface as blocked with reason max_cycles_reached.
    writeFileSync(retryPath, "retry requested by code-review (round 2)\n", "utf8");
    const secondCompletion = checkPostUnitHooks(second!.unitType, second!.unitId, project);
    assert.equal(secondCompletion, null);
    assert.equal(isRetryPending(), false, "no further retry once budget is exhausted");
    assert.equal(isHookBlocked(), true, "exhausted budget must block auto");
    const blocker = peekBlockedHook();
    assert.ok(blocker);
    assert.equal(blocker!.reason, "max_cycles_reached");
    assert.equal(blocker!.cycle, 2);
    assert.equal(blocker!.maxCycles, 2);
    assert.equal(consumeBlockedHook()?.reason, "max_cycles_reached");
    assert.equal(isHookBlocked(), false);
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("BLOCKED sentinel takes precedence over retry_on (subsystem failure must not be retried)", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    const dispatch = checkPostUnitHooks("execute-task", "M001/S01/T01", project);
    assert.notEqual(dispatch, null);

    // Defensive case: a stale retry_on from a prior cycle is still on disk
    // alongside a fresh BLOCKED sentinel. The registry must treat the fresh
    // BLOCKED signal as authoritative — re-running the trigger unit will not
    // resolve a provider/network outage.
    writeFileSync(resolveHookArtifactPath(project, "M001/S01/T01", "CODE-REVIEW-RETRY.md"), "stale retry\n", "utf8");
    writeFileSync(
      resolveHookArtifactPath(project, "M001/S01/T01", "CODE-REVIEW-BLOCKED.md"),
      "# blocked\n- Block Reason: reviewer_unavailable\n",
      "utf8",
    );

    const completion = checkPostUnitHooks(dispatch!.unitType, dispatch!.unitId, project);
    assert.equal(completion, null);
    assert.equal(isRetryPending(), false, "BLOCKED must override retry_on");
    assert.equal(isHookBlocked(), true);
    const blocker = consumeBlockedHook();
    assert.equal(blocker?.reason, "reviewer_unavailable");
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("design-review BLOCKED sentinel surfaces blocked after plan-slice", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    // plan-slice triggers both design-review and impl-plan-validator. The
    // first matching hook (design-review) is dispatched first.
    const dispatch = checkPostUnitHooks("plan-slice", "M001/S01", project);
    assert.notEqual(dispatch, null);
    assert.equal(dispatch?.unitType, "hook/phase-discipline-design-review");

    writeFileSync(
      resolveHookArtifactPath(project, "M001/S01", "DESIGN-REVIEW-BLOCKED.md"),
      "# blocked\n- Block Reason: reviewer_unavailable\n",
      "utf8",
    );

    const completion = checkPostUnitHooks(dispatch!.unitType, dispatch!.unitId, project);
    assert.equal(completion, null);
    assert.equal(isHookBlocked(), true);
    const blocker = consumeBlockedHook();
    assert.equal(blocker?.hookName, "phase-discipline-design-review");
    assert.equal(blocker?.triggerUnitId, "M001/S01");
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
