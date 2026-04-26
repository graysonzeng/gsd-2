import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DISPATCH_RULES, resolveDispatch, type DispatchContext } from "../auto-dispatch.ts";
import { runDispatch } from "../auto/phases.ts";
import type { LoopDeps } from "../auto/loop-deps.ts";
import type { IterationContext, LoopState, PreDispatchData } from "../auto/types.ts";
import { convertDispatchRules, initRegistry, resetRegistry, RuleRegistry } from "../rule-registry.ts";
import type { GSDState } from "../types.ts";

function makeDispatchState(overrides: Partial<GSDState> = {}): GSDState {
  return {
    phase: "planning",
    activeMilestone: { id: "M001", title: "Test Milestone", status: "active" },
    activeSlice: { id: "S01", title: "Slice 1" },
    activeTask: null,
    recentDecisions: [],
    blockers: [],
    nextAction: "",
    registry: [{ id: "M001", status: "active" }],
    ...overrides,
  } as GSDState;
}

function makeDispatchContext(basePath: string, overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    basePath,
    mid: "M001",
    midTitle: "Test Milestone",
    state: makeDispatchState(),
    prefs: {
      phases: {
        skip_research: true,
        skip_slice_research: true,
        reassess_after_slice: false,
      },
    } as any,
    ...overrides,
  };
}

type AdviseContext = DispatchContext & {
  advisedUnit?: { unitType: string; unitId?: string };
};

function makeMockDeps(overrides: Partial<LoopDeps> = {}): LoopDeps & {
  resolveDispatchCalls: AdviseContext[];
  journalEvents: Array<{ eventType: string; data?: Record<string, unknown> }>;
  runPreDispatchHookCalls: string[];
  pauseAutoCalls: string[];
  stopAutoCalls: string[];
} {
  const resolveDispatchCalls: AdviseContext[] = [];
  const journalEvents: Array<{ eventType: string; data?: Record<string, unknown> }> = [];
  const runPreDispatchHookCalls: string[] = [];
  const pauseAutoCalls: string[] = [];
  const stopAutoCalls: string[] = [];

  const baseDeps: LoopDeps = {
    lockBase: () => "/tmp/test-lock",
    buildSnapshotOpts: () => ({}),
    stopAuto: async (_ctx, _pi, reason) => {
      stopAutoCalls.push(reason ?? "");
    },
    pauseAuto: async () => {
      pauseAutoCalls.push("pause");
    },
    clearUnitTimeout: () => {},
    updateProgressWidget: () => {},
    syncCmuxSidebar: () => {},
    logCmuxEvent: () => {},
    invalidateAllCaches: () => {},
    deriveState: async () => makeDispatchState({ phase: "executing", activeTask: { id: "T01", title: "Task 1" } }),
    rebuildState: async () => {},
    loadEffectiveGSDPreferences: () => ({ preferences: {} }),
    preDispatchHealthGate: async () => ({ proceed: true, fixesApplied: [] }),
    syncProjectRootToWorktree: () => {},
    checkResourcesStale: () => null,
    validateSessionLock: () => ({ valid: true } as any),
    updateSessionLock: () => {},
    handleLostSessionLock: () => {},
    sendDesktopNotification: () => {},
    setActiveMilestoneId: () => {},
    pruneQueueOrder: () => {},
    isInAutoWorktree: () => false,
    shouldUseWorktreeIsolation: () => false,
    mergeMilestoneToMain: () => ({ pushed: false, codeFilesChanged: false }),
    teardownAutoWorktree: () => {},
    createAutoWorktree: () => "/tmp/wt",
    captureIntegrationBranch: () => {},
    getIsolationMode: () => "none",
    getCurrentBranch: () => "main",
    autoWorktreeBranch: () => "auto/M001",
    resolveMilestoneFile: () => null,
    reconcileMergeState: () => "clean",
    preflightCleanRoot: () => ({ stashPushed: false, summary: "" }),
    postflightPopStash: () => {},
    getLedger: () => null,
    getProjectTotals: () => ({ cost: 0 }),
    formatCost: (cost: number) => `$${cost.toFixed(2)}`,
    getBudgetAlertLevel: () => 0,
    getNewBudgetAlertLevel: () => 0,
    getBudgetEnforcementAction: () => "none",
    getManifestStatus: async () => null,
    collectSecretsFromManifest: async () => null,
    resolveDispatch: async (dctx) => {
      const advisedContext = dctx as AdviseContext;
      resolveDispatchCalls.push(advisedContext);
      if (advisedContext.advisedUnit?.unitType === "plan-slice") {
        return {
          action: "dispatch" as const,
          unitType: "plan-slice",
          unitId: advisedContext.advisedUnit.unitId ?? "M001/S01",
          prompt: "plan slice",
          pauseAfterDispatch: false,
          matchedRule: "honour-phase-discipline-advice",
        };
      }
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "M001/S01/T01",
        prompt: "do the thing",
        pauseAfterDispatch: true,
        matchedRule: "executing → execute-task",
      };
    },
    runPreDispatchHooks: () => {
      runPreDispatchHookCalls.push("phase-discipline");
      return {
        firedHooks: ["phase-discipline"],
        action: "advise",
        prompt: "do the thing",
        advisedUnitType: "plan-slice",
        advisedUnitId: "M001/S01/T99",
      };
    },
    getPriorSliceCompletionBlocker: () => null,
    getMainBranch: () => "main",
    closeoutUnit: async () => {},
    recordOutcome: () => {},
    writeLock: () => {},
    captureAvailableSkills: () => {},
    ensurePreconditions: () => {},
    updateSliceProgressCache: () => {},
    selectAndApplyModel: async () => ({ routing: null, appliedModel: null }),
    resolveModelId: (id: string, models: Array<{ id: string }>) => models.find((model) => model.id === id) as any,
    startUnitSupervision: () => {},
    getDeepDiagnostic: () => null,
    isDbAvailable: () => false,
    reorderForCaching: (prompt: string) => prompt,
    existsSync: () => true,
    readFileSync: () => "",
    atomicWriteSync: () => {},
    GitServiceImpl: class {} as any,
    resolver: {
      get workPath() {
        return "/tmp/project";
      },
      get projectRoot() {
        return "/tmp/project";
      },
      get lockPath() {
        return "/tmp/project";
      },
      enterMilestone: () => {},
      exitMilestone: () => {},
      mergeAndExit: () => {},
      mergeAndEnterNext: () => {},
    } as any,
    postUnitPreVerification: async () => "continue",
    runPostUnitVerification: async () => ({ action: "continue" } as any),
    postUnitPostVerification: async () => "continue",
    getSessionFile: () => "/tmp/session.json",
    emitJournalEvent: (entry) => {
      journalEvents.push({ eventType: entry.eventType, data: entry.data });
    },
  };

  return {
    ...baseDeps,
    ...overrides,
    resolveDispatchCalls,
    journalEvents,
    runPreDispatchHookCalls,
    pauseAutoCalls,
    stopAutoCalls,
  };
}

function makeIterationContext(overrides: Partial<IterationContext> = {}): IterationContext {
  let seq = 0;
  return {
    ctx: {
      model: {},
      modelRegistry: undefined,
      ui: {
        notify: () => {},
      },
    } as any,
    pi: {
      getActiveTools: () => [],
    } as any,
    s: {
      basePath: "/tmp/phase-discipline-advice",
      originalBasePath: "",
      pendingVerificationRetry: false,
    } as any,
    prefs: undefined,
    deps: makeMockDeps(),
    iteration: 0,
    flowId: "test-flow",
    nextSeq: () => ++seq,
    ...overrides,
  };
}

function makePreDispatchData(overrides: Partial<PreDispatchData> = {}): PreDispatchData {
  return {
    state: makeDispatchState({ phase: "executing", activeTask: { id: "T01", title: "Task 1" } }),
    mid: "M001",
    midTitle: "Test Milestone",
    ...overrides,
  };
}

function makeLoopState(): LoopState {
  return {
    recentUnits: [],
    stuckRecoveryAttempts: 0,
    consecutiveFinalizeTimeouts: 0,
  };
}

test("advise honoured when runnable", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-advise-"));
  t.after(() => {
    resetRegistry();
    rmSync(tmp, { recursive: true, force: true });
  });

  initRegistry(convertDispatchRules(DISPATCH_RULES));

  const result = await resolveDispatch({
    ...makeDispatchContext(tmp),
    advisedUnit: { unitType: "plan-slice", unitId: "M001/S01/T99" },
  } as AdviseContext);

  assert.equal(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.equal(result.unitType, "plan-slice");
    assert.equal(result.unitId, "M001/S01/T99");
    assert.equal(result.matchedRule, "honour-phase-discipline-advice");
  }
});

test("advise ignored with fallback when not runnable", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-advise-fallback-"));
  t.after(() => {
    resetRegistry();
    rmSync(tmp, { recursive: true, force: true });
  });

  initRegistry(convertDispatchRules(DISPATCH_RULES));

  const result = await resolveDispatch({
    ...makeDispatchContext(tmp),
    advisedUnit: { unitType: "execute-task", unitId: "M001/S01/T99" },
  } as AdviseContext);

  assert.equal(result.action, "dispatch");
  if (result.action === "dispatch") {
    assert.equal(result.unitType, "plan-slice");
    assert.equal(result.unitId, "M001/S01");
    assert.equal(result.matchedRule, "planning → plan-slice");
  }
});

test("empty-hook proceed behaviour unchanged", () => {
  resetRegistry();
  const registry = new RuleRegistry([]);
  const result = registry.evaluatePreDispatch("execute-task", "M001/S01/T01", "prompt", "/tmp/test");

  assert.equal(result.action, "proceed");
  assert.equal(result.prompt, "prompt");
  assert.deepEqual(result.firedHooks, []);
});

// NOTE: This validates the runtime passthrough contract for programmatic callers.
// YAML pre_dispatch_hooks still cannot populate advisedUnitId in PR-3a.
test("advisedUnitId override reaches IterationData.unitId", async () => {
  const deps = makeMockDeps();
  const ic = makeIterationContext({ deps });
  const result = await runDispatch(ic, makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "next");
  if (result.action === "next") {
    assert.equal(result.data.unitType, "plan-slice");
    assert.equal(result.data.unitId, "M001/S01/T99");
    assert.equal(result.data.pauseAfterUatDispatch, false);
  }

  assert.equal(deps.resolveDispatchCalls.length, 2);
  assert.deepEqual(deps.resolveDispatchCalls[1]?.advisedUnit, {
    unitType: "plan-slice",
    unitId: "M001/S01/T99",
  });

  const dispatchMatch = deps.journalEvents.find((entry) => entry.eventType === "dispatch-match");
  assert.ok(dispatchMatch, "dispatch-match journal event should be emitted");
  assert.deepEqual(dispatchMatch?.data, {
    unitType: "plan-slice",
    unitId: "M001/S01/T99",
  });
});

test("dispatch-readvised journal event emitted on successful advise", async () => {
  const deps = makeMockDeps();
  const ic = makeIterationContext({ deps });
  const result = await runDispatch(ic, makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "next");
  const readvised = deps.journalEvents.find((entry) => entry.eventType === "dispatch-readvised");
  assert.ok(readvised, "dispatch-readvised event should be emitted");
  assert.deepEqual(readvised?.data, {
    unitType: "plan-slice",
    unitId: "M001/S01/T99",
    advisedFrom: "executing → execute-task",
  });
});

test("pre-dispatch-hook journal includes advisory payload", async () => {
  const deps = makeMockDeps();
  const ic = makeIterationContext({ deps });
  const result = await runDispatch(ic, makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "next");
  const hookEvent = deps.journalEvents.find((entry) => entry.eventType === "pre-dispatch-hook");
  assert.ok(hookEvent, "pre-dispatch-hook event should be emitted");
  assert.deepEqual(hookEvent?.data, {
    firedHooks: ["phase-discipline"],
    action: "advise",
    advisedUnitType: "plan-slice",
    advisedUnitId: "M001/S01/T99",
  });
});

test("advisory stop signal propagates through runDispatch", async () => {
  const deps = makeMockDeps({
    resolveDispatch: async (dctx) => {
      const advisedContext = dctx as AdviseContext;
      deps.resolveDispatchCalls.push(advisedContext);
      if (advisedContext.advisedUnit) {
        return {
          action: "stop" as const,
          level: "error" as const,
          reason: "escalation required",
          matchedRule: "escalating-task → pause-for-escalation",
        };
      }
      return {
        action: "dispatch" as const,
        unitType: "execute-task",
        unitId: "M001/S01/T01",
        prompt: "do the thing",
        pauseAfterDispatch: true,
        matchedRule: "executing → execute-task",
      };
    },
  });
  const ic = makeIterationContext({ deps });
  const result = await runDispatch(ic, makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "break");
  if (result.action === "break") {
    assert.equal(result.reason, "dispatch-stop");
  }
  assert.equal(deps.stopAutoCalls.length, 1);
  const dispatchStop = deps.journalEvents.find((entry) => entry.eventType === "dispatch-stop");
  assert.ok(dispatchStop, "dispatch-stop event should be emitted for advisory stop");
  assert.deepEqual(dispatchStop?.data, { reason: "escalation required" });
});

test("advise re-dispatch does not re-run pre-dispatch hooks", async () => {
  const deps = makeMockDeps();
  const ic = makeIterationContext({ deps });
  const result = await runDispatch(ic, makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "next");
  assert.equal(deps.runPreDispatchHookCalls.length, 1);
  assert.equal(deps.resolveDispatchCalls.length, 2);
});

test("warning-level pre-dispatch block pauses auto", async () => {
  const deps = makeMockDeps({
    runPreDispatchHooks: () => ({
      firedHooks: ["phase-discipline-phase-guard"],
      action: "block",
      level: "warning",
      reason: "guard blocked",
      issues: [{
        code: "verify_fuse_blocked",
        level: "warning",
        stage: "phase-guard",
        source: "phase-discipline.phase-guard",
        detail: "guard blocked",
        unitType: "complete-milestone",
        unitId: "M001",
      }],
    } as any),
  });
  const ic = makeIterationContext({ deps });
  const result = await runDispatch(ic, makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "break");
  if (result.action === "break") {
    assert.equal(result.reason, "pre-dispatch-block");
  }
  assert.equal(deps.pauseAutoCalls.length, 1);
  assert.equal(deps.stopAutoCalls.length, 0);
  const hookEvent = deps.journalEvents.find((entry) => entry.eventType === "pre-dispatch-hook");
  assert.deepEqual(hookEvent?.data, {
    firedHooks: ["phase-discipline-phase-guard"],
    action: "block",
    level: "warning",
    reason: "guard blocked",
  });
});
