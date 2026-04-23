# PR-3a Δ-K1 Kernel Advise Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish synchronizing the minimal Δ-K1 kernel advisory contract on current `main`: preserve the already-present `action: "advise"` runtime path, make the real preferences pipeline accept config-authored `action: "advise"`, and add focused regression coverage so PR-3b can safely consume the branch-tip behaviour.

**Architecture:** Treat PR-3a as a **contract-sync PR**, not a greenfield kernel feature. Current `main` already contains the additive runtime path in `types.ts`, `auto/phases.ts`, and `auto-dispatch.ts`, so this plan is now verify-first: lock the runtime behaviour with focused tests, patch the real validator so config-authored `advise` survives the preferences pipeline, and touch the existing runtime files only if branch-tip inspection reveals drift from the already-landed contract.

**Tech Stack:** TypeScript, existing GSD auto-loop / rule-registry modules, preferences validation pipeline, Node test runner (`node --test` with `resolve-ts.mjs`).

---
## Locked scope for this PR

### Files that **must** change

- Modify: `src/resources/extensions/gsd/preferences-validation.ts` (accept config-authored `pre_dispatch_hooks[].action = "advise"`)
- Modify: `src/resources/extensions/gsd/tests/preferences.test.ts` (real-pipeline validation coverage for `action: "advise"`)
- Create: `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts`

### Files that are **verify-first** and should only be edited if branch-tip evidence shows drift

- Verify only: `src/resources/extensions/gsd/types.ts`
- Verify only: `src/resources/extensions/gsd/rule-registry.ts`
- Verify only: `src/resources/extensions/gsd/auto-dispatch.ts`
- Verify only: `src/resources/extensions/gsd/auto/phases.ts`
- Verify only: `src/resources/extensions/gsd/auto/loop-deps.ts`

### Files that were inspected and are intentionally **out of scope**

- Do **not** modify `src/resources/extensions/gsd/commands-prefs-wizard.ts:1316-1339` in this PR.

Reason: this PR closes the **remaining** Δ-K1 residue only. It does not add any new scheduler semantics beyond the already-partially-landed runtime path, and it does not expand preference UX beyond making handwritten `pre_dispatch_hooks[].action = "advise"` valid in the real load path.

### Reality check versus the spec

- The earlier v7.1 spec treated Δ-K1 as fully missing on `main`. Current code reality is narrower: `types.ts`, `auto/phases.ts`, and `auto-dispatch.ts` already contain the additive `advise` path, while `preferences-validation.ts` still rejects config-authored `action: "advise"`. This plan therefore keeps the runtime files in a verify-first bucket and treats validator acceptance + focused regression coverage as the primary required landing work.

### Budget guard

Stay within this corrected budget envelope:

- `preferences-validation.ts`: approximately `+5` to `+10` lines
- `preferences.test.ts`: approximately `+20` to `+50` lines
- `pre-dispatch-advise.test.ts`: approximately `~110` to `~160` lines
- verify-first runtime files: typically `0` lines; only allow small targeted edits if branch-tip drift is proven

If implementation pressure pushes beyond these bounds, stop and re-scope instead of growing the PR.

### Nomenclature note

Spec §10 says “`advisedUnitId` override propagates to `HookDispatchResult`”. On current `main`, the concrete runtime handoff after dispatch resolution is `IterationData` in `src/resources/extensions/gsd/auto/types.ts:107-120`. In tests, assert the override on `PhaseResult<IterationData>.data.unitId` returned by `runDispatch()`.

## Pre-flight commands

Run these before touching code on the execution branch.

- [ ] **Step 1: Verify the branch tip and clean tree assumptions**

Run:

```bash
git status --short && echo '---' && git log --oneline -6 && echo '---' && git rev-parse HEAD
```

Expected:

- only `?? .codebuddy/`, `?? .mcp.json`, `?? .windsurf/`
- `HEAD` still starts with `bb709fa5a`
- no tracked modifications in the working tree

- [ ] **Step 2: Re-verify the current PR-3a invariants on branch tip**

Run:

```bash
node -e "const fs=require('node:fs'); const files=[['src/resources/extensions/gsd/types.ts','action: \"proceed\" | \"skip\" | \"replace\" | \"advise\"'],['src/resources/extensions/gsd/auto-dispatch.ts','honour-phase-discipline-advice'],['src/resources/extensions/gsd/auto/phases.ts','preDispatchResult.action === \"advise\"'],['src/resources/extensions/gsd/preferences-validation.ts','must be modify, skip, or replace']]; for (const [p,q] of files) { const c=fs.readFileSync(p,'utf8'); console.log('--- '+p); console.log(c.includes(q)?'FOUND':'MISSING', q); }"
```

Expected:

- `types.ts` prints `FOUND action: "proceed" | "skip" | "replace" | "advise"`
- `auto-dispatch.ts` prints `FOUND honour-phase-discipline-advice`
- `auto/phases.ts` prints `FOUND preDispatchResult.action === "advise"`
- `preferences-validation.ts` prints `FOUND must be modify, skip, or replace`

If any runtime expectation differs, stop and re-calibrate against current `main` before implementing. If the validator string is already gone, update this plan before coding because PR-3a may already be fully or partially landed.

### Task 1: Write the failing advisory tests first

**Files:**

- Create: `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts`
- Read for patterns only: `src/resources/extensions/gsd/tests/rule-registry.test.ts:371-384`
- Read for patterns only: `src/resources/extensions/gsd/tests/auto-loop.test.ts:623-739`
- Read for patterns only: `src/resources/extensions/gsd/auto/types.ts:78-120`
- Read for patterns only: `src/resources/extensions/gsd/auto/phases.ts:886-1082`

- [ ] **Step 1: Create the new focused test file with four behaviour targets and realistic helpers**

Do **not** copy the earlier placeholder scaffold that used `{ deps } as any` and an `executing` fixture. Build the test file around three helpers:

- `makeDispatchContext()` — use a deterministic `planning` fixture so the stock fallback path is stable.
- `makeMockDeps()` — branch `resolveDispatch(dctx)` on `dctx.advisedUnit` so the `runDispatch()` test can distinguish the first and second resolution.
- `makeIterationContext()` — construct a real `IterationContext` shape; do not fake it with `{ deps } as any`.

Minimum deterministic dispatch fixture:

```ts
function makeDispatchContext(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    basePath: "/tmp/phase-discipline-advice",
    mid: "M001",
    midTitle: "Test Milestone",
    state: {
      phase: "planning",
      activeMilestone: { id: "M001", title: "Test Milestone", status: "active" },
      activeSlice: { id: "S01", title: "Slice 1" },
      registry: [{ id: "M001", status: "active" }],
      blockers: [],
      nextAction: "",
    } as any,
    prefs: { phases: { skip_research: true, skip_slice_research: true, reassess_after_slice: false } } as any,
    ...overrides,
  };
}
```

Test targets:

- `resolveDispatch` honours `advisedUnit` when the advised stock rule is runnable.
- `resolveDispatch` falls through when the advised stock rule is not runnable.
- `evaluatePreDispatch` still returns `proceed` when no hooks are registered.
- `runDispatch` performs exactly one advisory re-resolution and the final `IterationData.unitId` reflects `advisedUnitId`.

Acceptance criteria for the test file:

- Build the final assertions and fixtures directly from the current helper patterns shown below.
- Keep exactly these four behaviour targets:
  - `advise` honoured when runnable
  - `advise` ignored with fallback when not runnable
  - empty-hook `proceed` behaviour unchanged
  - `advisedUnitId` override reaches `IterationData.unitId`
- Do **not** add integration or preferences validation cases here.

- [ ] **Step 2: Flesh out the helpers using existing local test patterns**

Use the `auto-loop.test.ts` `makeMockDeps()` shape as the base for your real helper, but apply these required corrections:

```ts
function makeMockDeps(overrides?: Partial<LoopDeps>): LoopDeps {
  return {
    lockBase: () => "/tmp/test-lock",
    buildSnapshotOpts: () => ({}),
    stopAuto: async () => {},
    pauseAuto: async () => {},
    clearUnitTimeout: () => {},
    // ... (rest of the mock deps implementation)
    resolveDispatch: async (dctx) => {
      if (dctx.advisedUnit?.unitType === "plan-slice") {
        return {
          action: "dispatch",
          unitType: "plan-slice",
          unitId: dctx.advisedUnit.unitId ?? "M001/S01",
          prompt: "plan slice",
          pauseAfterDispatch: false,
        } as const;
      }
      return {
        action: "dispatch",
        unitType: "execute-task",
        unitId: "M001/S01/T01",
        prompt: "do the thing",
        pauseAfterDispatch: true,
      } as const;
    },
    runPreDispatchHooks: () => ({ firedHooks: [], action: "proceed", prompt: "do the thing" }),
    getPriorSliceCompletionBlocker: () => null,
    getMainBranch: () => "main",
    // ... (rest of the mock deps implementation)
  } as LoopDeps;
}
```

Add a dedicated `makeIterationContext()` helper based on `auto/types.ts` and the `auto-loop.test.ts` pattern:

```ts
function makeIterationContext(overrides: Partial<IterationContext> = {}): IterationContext {
  return {
    ctx: {
      model: {},
      modelRegistry: undefined,
      ui: { notify: () => {} },
    } as any,
    pi: { getActiveTools: () => [] } as any,
    s: {
      basePath: "/tmp/phase-discipline-advice",
      pendingVerificationRetry: false,
    } as any,
    prefs: undefined,
    deps: makeMockDeps(),
    iteration: 0,
    flowId: "test-flow",
    nextSeq: () => 1,
    ...overrides,
  };
}
```

Required assertions for the `runDispatch()` test:

- `deps.resolveDispatch` was called twice.
- The second call carried `advisedUnit`.
- Final `IterationData.unitType` / `unitId` come from the advised dispatch.
- Final `pauseAfterUatDispatch` comes from the advised dispatch, not the original one.

- [ ] **Step 3: Run the new test file and confirm it fails before implementation**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
```

Expected:

- exit code is non-zero
- at least one failure mentions missing advisory support such as absent `matchedRule === "honour-phase-discipline-advice"`, missing second dispatch resolution, or missing `advisedUnitId` propagation
- it is acceptable if the fallback test and empty-hook proceed test already pass before the implementation lands

- [ ] **Step 4: Commit the failing test scaffold**

```bash
git add src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
git commit -m "test: add failing coverage for pre-dispatch advise"
```

### Task 2: Extend the advisory types and pre-dispatch contract
> **Execution rule (updated after main-branch re-verification):** only execute the runtime-editing portions of this task if the branch tip actually lacks the already-expected `advise` contract. On current `main`, the normal path is to update `preferences-validation.ts`, update `preferences.test.ts`, and leave `types.ts` / `rule-registry.ts` / `auto/loop-deps.ts` untouched unless a failing test proves drift.

**Files:**

- Modify: `src/resources/extensions/gsd/types.ts:413-447`
- Modify: `src/resources/extensions/gsd/rule-registry.ts:276-341`
- Modify: `src/resources/extensions/gsd/auto/loop-deps.ts:160-173`

- [ ] **Step 1: Extend `PreDispatchHookConfig` and `PreDispatchResult` in `types.ts`**

Replace the current type surface with this exact contract shape:

```ts
export interface PreDispatchHookConfig {
  name: string;
  before: string[];
  action: "modify" | "skip" | "replace" | "advise";
  prepend?: string;
  append?: string;
  prompt?: string;
  unit_type?: string;
  skip_if?: string;
  model?: string;
  enabled?: boolean;
}

export interface PreDispatchResult {
  action: "proceed" | "skip" | "replace" | "advise";
  prompt?: string;
  unitType?: string;
  unitId?: string;
  advisedUnitType?: string;
  advisedUnitId?: string;
  model?: string;
  firedHooks: string[];
}
```

Rules:

- Keep the existing snake_case config field `unit_type` unchanged.
- Do **not** introduce any new scheduler-owned enum or helper type in this PR.
- `unitId?` remains additive and must not change existing `replace` semantics.
- Do **not** add `advise_if_mismatch` in PR-3a. It is preset-level policy and belongs to PR-3b when a real consumer exists.

- [ ] **Step 2: Teach `RuleRegistry.evaluatePreDispatch()` to propagate `advise` unchanged**

Insert one additive branch inside the existing `for (const hook of hooks)` loop, between `replace` and `modify` handling:

```ts
if (hook.action === "advise") {
  firedHooks.push(hook.name);
  return {
    action: "advise",
    prompt: currentPrompt,
    advisedUnitType: hook.unit_type,
    model: hook.model,
    firedHooks,
  };
}
```

- [ ] **Step 3: Expand the injected `LoopDeps.runPreDispatchHooks` return type**

Change the type-only contract in `auto/loop-deps.ts` from:

```ts
runPreDispatchHooks: (...) => {
  firedHooks: string[];
  action: string;
  prompt?: string;
  unitType?: string;
  model?: string;
};
```

To:

```ts
runPreDispatchHooks: (...) => {
  firedHooks: string[];
  action: string;
  prompt?: string;
  unitType?: string;
  unitId?: string;
  advisedUnitType?: string;
  advisedUnitId?: string;
  model?: string;
};
```

- [ ] **Step 4: Run the focused test file again to keep the failure surface narrow**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
```

Expected:

- legacy-path assertions are still failing only because dispatch honouring is not implemented yet
- no new syntax or type-shape crashes from `types.ts` / `loop-deps.ts` edits

- [ ] **Step 5: Commit the contract-layer delta**

```bash
git add src/resources/extensions/gsd/types.ts src/resources/extensions/gsd/rule-registry.ts src/resources/extensions/gsd/auto/loop-deps.ts
git commit -m "feat: add pre-dispatch advise contract"
```

### Task 3: Honour advisory hints in the dispatch pipeline
> **Execution rule (updated after main-branch re-verification):** this task is now primarily a regression-verification task. Do **not** re-add the prefix rule or advisory re-dispatch if Pre-flight Step 2 and the focused tests show the contract is already present on branch tip. Touch `auto-dispatch.ts` / `auto/phases.ts` only to repair proven drift.

**Files:**

- Modify: `src/resources/extensions/gsd/auto-dispatch.ts:64-96, 197-220, 1048-1084`
- Modify: `src/resources/extensions/gsd/auto/phases.ts:904-1062`
- Test: `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts`

- [ ] **Step 1: Add `advisedUnit` to `DispatchContext` and insert the prefix rule in `auto-dispatch.ts`**

First extend `DispatchContext` with the advisory hint:

```ts
export interface DispatchContext {
  basePath: string;
  mid: string;
  midTitle: string;
  state: GSDState;
  prefs: GSDPreferences | undefined;
  session?: import("./auto/session.js").AutoSession;
  structuredQuestionsAvailable?: "true" | "false";
  sessionContextWindow?: number;
  modelRegistry?: MinimalModelRegistry;
  advisedUnit?: { unitType: string; unitId?: string };
}
```

Then add an explicit candidate-rule index and the highest-priority rule at the top of `DISPATCH_RULES`:

```ts
const DISPATCH_RULES_BY_UNIT_TYPE = new Map<string, DispatchRule[]>([
  ["rewrite-docs", []],
  ["complete-slice", []],
  ["run-uat", []],
  ["reassess-roadmap", []],
  ["discuss-milestone", []],
  ["research-milestone", []],
  ["plan-milestone", []],
  ["research-slice", []],
  ["refine-slice", []],
  ["plan-slice", []],
  ["gate-evaluate", []],
  ["replan-slice", []],
  ["reactive-execute", []],
  ["execute-task", []],
  ["validate-milestone", []],
  ["complete-milestone", []],
]);

export const DISPATCH_RULES: DispatchRule[] = [
  {
    name: "honour-phase-discipline-advice",
    match: async (ctx) => {
      const advice = ctx.advisedUnit;
      if (!advice) return null;
      const stockRules = DISPATCH_RULES_BY_UNIT_TYPE.get(advice.unitType) ?? [];
      for (const stockRule of stockRules) {
        const stockAction = await stockRule.match({ ...ctx, advisedUnit: undefined });
        if (!stockAction || stockAction.action !== "dispatch") continue;
        return advice.unitId
          ? { ...stockAction, unitId: advice.unitId }
          : stockAction;
      }
      logWarning("dispatch", `phase-discipline advised ${advice.unitType} but it is not runnable; falling back`);
      return null;
    },
  },
  // existing rules continue here unchanged
];
```

After the array, register the current stock rules explicitly by name so the mapping is stable and reviewable:

```ts
const byName = (name: string) => {
  const rule = DISPATCH_RULES.find((entry) => entry.name === name);
  if (!rule) throw new Error(`Missing dispatch rule: ${name}`);
  return rule;
};

DISPATCH_RULES_BY_UNIT_TYPE.get("rewrite-docs")!.push(byName("rewrite-docs (override gate)"));
DISPATCH_RULES_BY_UNIT_TYPE.get("complete-slice")!.push(byName("summarizing → complete-slice"));
DISPATCH_RULES_BY_UNIT_TYPE.get("run-uat")!.push(byName("run-uat (post-completion)"));
DISPATCH_RULES_BY_UNIT_TYPE.get("reassess-roadmap")!.push(byName("reassess-roadmap (post-completion)"));
DISPATCH_RULES_BY_UNIT_TYPE.get("discuss-milestone")!.push(byName("needs-discussion → discuss-milestone"), byName("pre-planning (no context) → discuss-milestone"));
DISPATCH_RULES_BY_UNIT_TYPE.get("research-milestone")!.push(byName("pre-planning (no research) → research-milestone"));
DISPATCH_RULES_BY_UNIT_TYPE.get("plan-milestone")!.push(byName("pre-planning (has research) → plan-milestone"));
DISPATCH_RULES_BY_UNIT_TYPE.get("research-slice")!.push(byName("planning (multiple slices need research) → parallel-research-slices"), byName("planning (no research, not S01) → research-slice"));
DISPATCH_RULES_BY_UNIT_TYPE.get("refine-slice")!.push(byName("refining → refine-slice"));
DISPATCH_RULES_BY_UNIT_TYPE.get("plan-slice")!.push(byName("planning → plan-slice"), byName("executing → execute-task (recover missing task plan → plan-slice)"));
DISPATCH_RULES_BY_UNIT_TYPE.get("gate-evaluate")!.push(byName("evaluating-gates → gate-evaluate"));
DISPATCH_RULES_BY_UNIT_TYPE.get("replan-slice")!.push(byName("replanning-slice → replan-slice"));
DISPATCH_RULES_BY_UNIT_TYPE.get("reactive-execute")!.push(byName("executing → reactive-execute (parallel dispatch)"));
DISPATCH_RULES_BY_UNIT_TYPE.get("execute-task")!.push(byName("executing → execute-task"));
DISPATCH_RULES_BY_UNIT_TYPE.get("validate-milestone")!.push(byName("validating-milestone → validate-milestone"));
DISPATCH_RULES_BY_UNIT_TYPE.get("complete-milestone")!.push(byName("completing-milestone → complete-milestone"));
```

Real implementation constraint:

- Do **not** refactor the rule table.
- Do **not** reorder any existing stock rule relative to each other.
- The prefix rule may be index `0`; everything else keeps its original order.
- Keep the candidate arrays ordered from most specific to least specific so fallback semantics match the current stock table.
- Rely on the outer `resolveDispatch()` / `RuleRegistry.evaluateDispatch()` loop to stamp `matchedRule = "honour-phase-discipline-advice"`; do not duplicate that write inside the prefix rule body.

- [ ] **Step 2: Re-enter dispatch resolution from `runDispatch()` when a hook advises a different unit**

Do **not** only splice an `advise` branch into the current block. The final `runDispatch()` ordering must make the **post-advice unit** the authoritative unit for journal, stuck detection, pause propagation, and the downstream prior-slice guard.

The required ordering is:

1. Resolve the initial `dispatchResult` exactly as today.
2. Handle `stop` / non-dispatch early exits exactly as today.
3. Materialise tentative `unitType`, `unitId`, `prompt` from the initial dispatch.
4. Run `deps.runPreDispatchHooks(...)` on that tentative unit.
5. `skip` remains highest priority and returns `{ action: "continue" }`.
6. If the hook returns `action: "advise"`, call `deps.resolveDispatch({... advisedUnit })` **once**. If it returns a dispatch, replace `unitType`, `unitId`, `prompt`, and `pauseAfterUatDispatch` with the advised dispatch values.
7. `replace` / prompt-mutation then apply to the final selected unit.
8. Only after the final selected unit is known, emit `dispatch-match`, update the stuck window, and run `getPriorSliceCompletionBlocker(...)`.

Use this control-flow shape:

```ts
const preDispatchResult = deps.runPreDispatchHooks(unitType, unitId, prompt, s.basePath);

if (preDispatchResult.action === "skip") {
  return { action: "continue" };
}

let pauseAfterUatDispatch = dispatchResult.pauseAfterDispatch ?? false;

if (preDispatchResult.action === "advise" && preDispatchResult.advisedUnitType) {
  const advisedDispatch = await deps.resolveDispatch({
    basePath: s.basePath,
    mid,
    midTitle,
    state,
    prefs,
    session: s,
    structuredQuestionsAvailable,
    sessionContextWindow: ctx.model?.contextWindow,
    modelRegistry: ctx.modelRegistry as MinimalModelRegistry | undefined,
    advisedUnit: {
      unitType: preDispatchResult.advisedUnitType,
      unitId: preDispatchResult.advisedUnitId,
    },
  });

  if (advisedDispatch.action === "dispatch") {
    unitType = advisedDispatch.unitType;
    unitId = advisedDispatch.unitId;
    prompt = advisedDispatch.prompt;
    pauseAfterUatDispatch = advisedDispatch.pauseAfterDispatch ?? false;
    deps.emitJournalEvent({
      ts: new Date().toISOString(),
      flowId: ic.flowId,
      seq: ic.nextSeq(),
      eventType: "dispatch-readvised",
      data: { unitType, unitId, advisedFrom: dispatchResult.matchedRule },
    });
  }
} else if (preDispatchResult.action === "replace") {
  prompt = preDispatchResult.prompt ?? prompt;
  if (preDispatchResult.unitType) unitType = preDispatchResult.unitType;
} else if (preDispatchResult.prompt) {
  prompt = preDispatchResult.prompt;
}
```

Preserve these existing invariants in the real edit:

- `skip` still returns `{ action: "continue" }`
- `replace` still mutates `unitType` / `prompt` in place
- non-empty `prompt` on `proceed` still overwrites `prompt`
- journal emission for `pre-dispatch-hook` remains intact
- `dispatch-match`, stuck detection, and `pauseAfterUatDispatch` all reflect the final post-advice unit
- the downstream `priorSliceBlocker` guard still sees the final post-advice `unitType` / `unitId`
- advisory re-dispatch does **not** re-trigger pre-dispatch hooks on the advised unit; this is an intentional loop guard, not an omission

- [ ] **Step 3: Update the new test file to assert the real runtime path**

Your finished `pre-dispatch-advise.test.ts` should assert these exact outcomes:

```ts
test("advise honoured when runnable", async () => {
  // first dispatch picks execute-task; hook advises plan-slice; second resolution honours it
  assert.equal(result.action, "next");
  if (result.action === "next") {
    assert.equal(result.data.unitType, "plan-slice");
    assert.equal(result.data.unitId, "M001/S01");
    assert.equal(result.data.pauseAfterUatDispatch, false);
  }
  assert.equal(resolveDispatchCalls.length, 2);
  assert.deepEqual(resolveDispatchCalls[1]?.advisedUnit, { unitType: "plan-slice", unitId: "M001/S01" });
});

test("advise not runnable falls through to original dispatch", async () => {
  assert.equal(result.action, "next");
  if (result.action === "next") {
    assert.equal(result.data.unitType, "execute-task");
    assert.equal(result.data.unitId, "M001/S01/T01");
    assert.equal(result.data.pauseAfterUatDispatch, true);
  }
});

test("empty-hook proceed behaviour is unchanged", () => {
  assert.equal(result.action, "proceed");
  assert.equal(result.prompt, "prompt");
});

test("advisedUnitId override wins over stock rule unitId", async () => {
  assert.equal(result.action, "next");
  if (result.action === "next") {
    assert.equal(result.data.unitId, "M001/S01/T99");
  }
});
```

Also assert that any `dispatch-match` journal event emitted by the test double references the final post-advice unit, not the original pre-advice dispatch.

- [ ] **Step 4: Run the focused advisory tests and confirm they pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
```

Expected:

- exit code `0`
- all four tests in `pre-dispatch-advise.test.ts` pass
- no failure references to missing `advisedUnit`, missing `matchedRule`, or missing `advisedUnitId`

- [ ] **Step 5: Run extension typecheck**

Run:

```bash
npm run typecheck:extensions
```

Expected:

- `tsc --noEmit --project tsconfig.extensions.json` completes with exit code `0`
- no TS errors in `types.ts`, `auto-dispatch.ts`, `auto/phases.ts`, or `auto/loop-deps.ts`

- [ ] **Step 6: Commit the dispatch honouring implementation**

```bash
git add src/resources/extensions/gsd/auto-dispatch.ts src/resources/extensions/gsd/auto/phases.ts src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
git commit -m "feat: honour pre-dispatch advise in auto dispatch"
```

### Task 4: Final verification and review guard

**Files:**

- Verify only: `src/resources/extensions/gsd/types.ts`
- Verify only: `src/resources/extensions/gsd/rule-registry.ts`
- Verify only: `src/resources/extensions/gsd/auto-dispatch.ts`
- Verify only: `src/resources/extensions/gsd/auto/phases.ts`
- Verify only: `src/resources/extensions/gsd/auto/loop-deps.ts`
- Verify only: `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts`

- [ ] **Step 1: Re-run the focused test and typecheck as the final gate**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts && npm run typecheck:extensions
```

Expected:

- first command segment passes all tests in the new file
- second command segment exits `0`
- no unexpected file additions outside the locked scope

- [ ] **Step 2: Inspect the diff against the locked scope**

Run:

```bash
git diff --stat -- src/resources/extensions/gsd/types.ts src/resources/extensions/gsd/rule-registry.ts src/resources/extensions/gsd/auto-dispatch.ts src/resources/extensions/gsd/auto/phases.ts src/resources/extensions/gsd/auto/loop-deps.ts src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
```

Expected:

- diff only mentions the 6 locked-scope files above
- net change is still in the rough budget envelope documented at the top of this plan
- no edits to `preferences-validation.ts`, `preferences.test.ts`, or `commands-prefs-wizard.ts`
- `DISPATCH_RULES_BY_UNIT_TYPE` registration remains explicit and reviewable; if a new stock dispatch rule was added during the same branch, stop and update the map deliberately instead of assuming advise support is automatic

- [ ] **Step 3: Record the no-go condition if scope drift appears**

If the diff shows any additional file, do **not** “just fix it in the same PR”. Instead, stop with this exact summary in the execution session:

```text
PR-3a exceeded its locked scope. New coupling appeared outside the corrected kernel boundary. Stop here, save a handoff, and write a follow-up micro-plan before editing more files.
```

- [ ] **Step 4: Create the final implementation commit**

```bash
git add src/resources/extensions/gsd/types.ts src/resources/extensions/gsd/rule-registry.ts src/resources/extensions/gsd/auto-dispatch.ts src/resources/extensions/gsd/auto/phases.ts src/resources/extensions/gsd/auto/loop-deps.ts src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts
git commit -m "feat: add kernel advisory dispatch preference"
```

## Self-review against the spec

### Spec coverage

- `types.ts` adds `"advise"`, `advisedUnitType`, `advisedUnitId`, and `unitId` on `PreDispatchResult`.
- `rule-registry.ts` propagates `advise` without disturbing `modify` / `skip` / `replace`.
- `auto-dispatch.ts` honours an advisory hint through a prefix rule and falls through cleanly when not runnable.
- `auto/phases.ts` is the current-main glue required to thread advisory data from hooks into dispatch re-resolution, with journal / stuck / pause state keyed off the final post-advice unit.
- `pre-dispatch-advise.test.ts` covers the four PR-3a unit-test requirements from §10.

### Placeholder scan

- No `TBD`
- No `TODO`
- No “implement later”
- No unnamed files
- No unresolved test commands

### Type consistency

The plan uses one consistent vocabulary throughout:

- `action: "advise"`
- `advisedUnitType`
- `advisedUnitId`
- `DispatchContext.advisedUnit`
- `IterationData.unitId` as the concrete runtime sink for the override

Plan complete and saved to `docs/superpowers/plans/2026-04-23-pr-3a-kernel-advise-action.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
