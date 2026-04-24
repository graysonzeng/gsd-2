import assert from "node:assert/strict";
import test from "node:test";

import { runDispatch } from "../auto/phases.ts";
import type { LoopDeps } from "../auto/loop-deps.ts";
import type { IterationContext, LoopState, PreDispatchData } from "../auto/types.ts";
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

function makeMockDeps(overrides: Partial<LoopDeps> = {}): LoopDeps & {
  journalEvents: Array<{ eventType: string; data?: Record<string, unknown> }>;
  pauseAutoCalls: number;
  stopAutoCalls: string[];
  fanOutCalls: Array<{ unitType: string; unitId: string }>;
} {
  const journalEvents: Array<{ eventType: string; data?: Record<string, unknown> }> = [];
  const stopAutoCalls: string[] = [];
  const fanOutCalls: Array<{ unitType: string; unitId: string }> = [];
  let pauseAutoCalls = 0;

  const deps: LoopDeps = {
    lockBase: () => "/tmp/test-lock",
    buildSnapshotOpts: () => ({}),
    stopAuto: async (_ctx: unknown, _pi: unknown, reason: string | undefined) => {
      stopAutoCalls.push(reason ?? "");
    },
    pauseAuto: async () => {
      pauseAutoCalls += 1;
    },
    clearUnitTimeout: () => {},
    updateProgressWidget: () => {},
    syncCmuxSidebar: () => {},
    logCmuxEvent: () => {},
    invalidateAllCaches: () => {},
    deriveState: async () => makeDispatchState(),
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
    formatCost: () => "$0.00",
    getBudgetAlertLevel: () => 0,
    getNewBudgetAlertLevel: () => 0,
    getBudgetEnforcementAction: () => "none",
    getManifestStatus: async () => null,
    collectSecretsFromManifest: async () => null,
    resolveDispatch: async () => ({
      action: "dispatch" as const,
      unitType: "research-slice",
      unitId: "M001/S01",
      prompt: "research slice",
      pauseAfterDispatch: false,
      matchedRule: "planning → research-slice",
    }),
    runPreDispatchHooks: () => ({
      action: "proceed",
      prompt: "research slice",
      model: "openai/gpt-5.4",
      firedHooks: ["phase-discipline-profile-dispatch", "phase-discipline-scout-fanout"],
      fanOutSpec: {
        builtin: "phase-discipline-scout-fanout",
        unitType: "research-slice",
        unitId: "M001/S01",
        scouts: [
          { focus: "codebase_scan", task: "codebase" },
          { focus: "constraints_risks", task: "constraints" },
          { focus: "prior_art", task: "prior" },
        ],
      },
    } as any),
    getPriorSliceCompletionBlocker: () => null,
    getMainBranch: () => "main",
    closeoutUnit: async () => {},
    recordOutcome: () => {},
    writeLock: () => {},
    captureAvailableSkills: () => {},
    ensurePreconditions: () => {},
    updateSliceProgressCache: () => {},
    selectAndApplyModel: async () => ({ routing: null, appliedModel: null }),
    resolveModelId: () => null as any,
    startUnitSupervision: () => {},
    getDeepDiagnostic: () => null,
    isDbAvailable: () => false,
    reorderForCaching: (prompt: string) => prompt,
    existsSync: () => true,
    readFileSync: () => "",
    atomicWriteSync: () => {},
    GitServiceImpl: class {} as any,
    resolver: {} as any,
    postUnitPreVerification: async () => "continue",
    runPostUnitVerification: async () => ({ action: "continue" } as any),
    postUnitPostVerification: async () => "continue",
    getSessionFile: () => "/tmp/session.json",
    emitJournalEvent: (entry: { eventType: string; data?: Record<string, unknown> }) => {
      journalEvents.push({ eventType: entry.eventType, data: entry.data });
    },
    runPhaseDisciplineScoutFanOut: async ({ unitType, unitId }: { unitType: string; unitId: string }) => {
      fanOutCalls.push({ unitType, unitId });
      return {
        researchArtifactPath: "/tmp/S01-RESEARCH.md",
        scoutCount: 3,
        rawLogDir: "/tmp/.phase-discipline",
      };
    },
  } as unknown as LoopDeps;

  return {
    ...deps,
    ...overrides,
    journalEvents,
    pauseAutoCalls,
    stopAutoCalls,
    fanOutCalls,
  };
}

function makeIterationContext(deps: LoopDeps): IterationContext {
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
      basePath: "/tmp/pre-dispatch-fanout",
      originalBasePath: "",
      pendingVerificationRetry: false,
    } as any,
    prefs: undefined,
    deps,
    iteration: 0,
    flowId: "fanout-flow",
    nextSeq: () => ++seq,
  };
}

function makePreDispatchData(): PreDispatchData {
  return {
    state: makeDispatchState(),
    mid: "M001",
    midTitle: "Test Milestone",
  };
}

function makeLoopState(): LoopState {
  return {
    recentUnits: [],
    stuckRecoveryAttempts: 0,
    consecutiveFinalizeTimeouts: 0,
  };
}

test("runDispatch short-circuits to continue after successful scout fan-out", async () => {
  const deps = makeMockDeps();
  const result = await runDispatch(makeIterationContext(deps), makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "continue");
  assert.deepEqual(deps.fanOutCalls, [{ unitType: "research-slice", unitId: "M001/S01" }]);
  const dispatchMatch = deps.journalEvents.find((entry) => entry.eventType === "dispatch-match");
  assert.ok(dispatchMatch);
  assert.deepEqual(dispatchMatch?.data, { unitType: "research-slice", unitId: "M001/S01" });
});

test("runDispatch does not execute scout fan-out when prior-slice blocker trips first", async () => {
  const deps = makeMockDeps({
    getPriorSliceCompletionBlocker: () => "finish previous slice first",
  });
  const result = await runDispatch(makeIterationContext(deps), makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "break");
  assert.deepEqual(deps.fanOutCalls, []);
  assert.deepEqual(deps.stopAutoCalls, ["finish previous slice first"]);
});

test("runDispatch pauses auto and breaks when scout fan-out fails", async () => {
  const deps = makeMockDeps({
    runPhaseDisciplineScoutFanOut: async () => {
      throw new Error("scout exploded");
    },
  });
  const result = await runDispatch(makeIterationContext(deps), makePreDispatchData(), makeLoopState());

  assert.equal(result.action, "break");
  if (result.action === "break") {
    assert.equal(result.reason, "pre-dispatch-fanout-failed");
  }
});
