# PR-3b Phase-Discipline Preset + B-min Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

 **Goal:** Land the extension-side `phase-discipline-8step` preset on top of the current branch tip, where the PR-1 CLI tool-restriction chain and the PR-2 Stage-B `shared-harness/*` subset are already present, and close the remaining PR-3a validator/preset-consumer residue so auto-mode can inject the preset hooks, execute cross-review through `shared-harness/*`, and drive the B-min 8-step advisory skeleton without creating a second runtime.

 **Architecture:** Keep PR-3b focused on the real consumer layer. Preferences opt-in via `milestone_profile`, preset merge happens inside the existing preferences loading path, `profile-dispatch.ts` consumes the already-landed `action: "advise"` runtime contract, reviewer fan-out consumes the current branch's `shared-harness/*`, and this round also closes the remaining authoring/validation residue in `preferences-validation.ts`. One reality correction is required: current hook execution on the branch tip is still prompt-only, so PR-3b must add the smallest possible built-in phase-discipline hook glue for the named reviewer hooks and the profile-dispatch pre-dispatch handler; otherwise the new `phase-discipline/*.ts` files would never execute.
 
 **Tech Stack:** TypeScript, existing GSD preferences / rule-registry / auto-mode hook pipeline, the current branch's `shared-harness/*`, Node test runner (`node --test` via `resolve-ts.mjs`).
 
**2026-04-24 review disposition / execution mode:** this workspace is no longer at the greenfield state assumed by the original draft. `src/resources/extensions/gsd/phase-discipline/*` already exists as a partial, uncommitted PR-3b implementation on `feat/phase-discipline-preset-v1`, including a first-pass `README.md` and unit tests for `merge` / `profile-dispatch` / `reviewer-hook`, and PR-3a's runtime advise path is already present in the working tree. Execution for this session is therefore a **gap-closing hardening pass over the existing draft**, not a first-pass create-from-scratch implementation. Accepted review items for this pass are: add a real integration test, tighten the existing `phase-discipline/README.md` and test coverage where needed, move the built-in reviewer fast-path to `src/resources/extensions/gsd/auto/run-unit.ts` before `newSession()`, replace name-based built-in routing with explicit `builtin` markers on preset-owned hooks, add a hard timeout to reviewer execution, regression-lock `builtin` marker survival across merge + revalidation, and remove preset-level hardcoded `openai/gpt-5.4` defaults so the primary reviewer falls back to runtime/current-model resolution.

---

 ## Locked scope for this PR

If the CLI chain or `shared-harness/*` anchor is missing, stop. Do **not** start PR-3b by re-implementing those dependencies inside this branch. If only the validator string is still `FOUND`, proceed and treat that as the first implementation task.

On the current branch tip, the most subtle case is PR-3a residue: `types.ts` and dispatch runtime already contain the additive `advise` path, but `preferences-validation.ts` may still reject config-authored `action: "advise"`. This plan therefore treats validator acceptance + preset-consumer glue as in-scope work for PR-3b, while keeping all new kernel semantics out of scope.

### Reality corrections versus the spec

These are not optional opinions; they are required boundary fixes from read-only inspection of current `src/`:

- `PostUnitHookConfig` / `PreDispatchHookConfig` live in `src/resources/extensions/gsd/types.ts`, not in `preferences-types.ts`. So hook-field additions belong in `types.ts`, while `preferences-types.ts` only carries `GSDPreferences` and `KNOWN_PREFERENCE_KEYS`.
- Current `main` already carries `PreDispatchResult.action: "advise"` in `types.ts` and advisory re-dispatch in `auto/phases.ts` + `auto-dispatch.ts`. PR-3b must **consume** that contract, not try to re-invent or extend the kernel semantics here.
- `preferences-validation.ts` is in the real load path today. If it still hardcodes `pre_dispatch_hooks.action` to `modify|skip|replace`, that is the remaining PR-3a authoring residue and this PR must close it as consumer-side glue. PR-3b may validate its **new hook fields**, but it must not introduce any new kernel semantics beyond accepting the already-landed `advise` authoring contract.
- `preferences.ts` currently has only one real persisted merge stage: global + project preferences through `mergePreferences(...)`. There is no preset-injection layer yet, so PR-3b must add one through the existing `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` path instead of inventing a parallel resolver surface.
- `post-unit-hooks.ts` is only a facade over `RuleRegistry`; existing runtime callers still enter through `checkPostUnitHooks()` / `runPreDispatchHooks()`. Keep PR-3b glue compatible with that facade so tests and auto-loop consumers do not split into two hook paths.
- Current post-unit hook execution is prompt-only: `rule-registry.ts` returns `HookDispatchResult { prompt, model, unitType: "hook/${config.name}" }`, `auto.ts` dispatches the hook unit, and `auto/run-unit.ts` is the last pre-`pi.sendMessage(...)` choke-point. That is sufficient for prompt-driven hooks, but **not** for `reviewer-hook.ts` fan-out or dynamic `profile-dispatch.ts` logic. PR-3b therefore needs the smallest possible phase-discipline-specific built-in bridge, and in this workspace the reviewer fast-path must live in `auto/run-unit.ts` early enough to avoid wasting `newSession()`.
- `phase-discipline-findings-to-memories` can stay prompt-driven. The required custom runtime glue is only for:
  - `phase-discipline-profile-dispatch` (sync, pre-dispatch)
  - `phase-discipline-code-review` / `phase-discipline-design-review` (async, post-unit reviewer fan-out)

### Files that must change

- Modify: `src/resources/extensions/gsd/types.ts`
- Modify: `src/resources/extensions/gsd/preferences-types.ts`
- Modify: `src/resources/extensions/gsd/preferences-validation.ts`
- Modify: `src/resources/extensions/gsd/preferences.ts`
- Modify: `src/resources/extensions/gsd/rule-registry.ts`
- Modify: `src/resources/extensions/gsd/auto/run-unit.ts`
- Modify: `src/resources/extensions/gsd/tests/preferences.test.ts`
- Modify: `src/resources/extensions/gsd/tests/post-unit-hooks.test.ts`
- Modify: `src/resources/extensions/gsd/tests/rule-registry.test.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/preset.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/merge.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/profile-map.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/findings-carry.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/README.md`
- Modify: `src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts`
- Create: `src/tests/phase-discipline-integration.test.ts`

### Files intentionally out of scope

- Do **not** re-open PR-1 CLI files (`src/cli.ts`, `src/cli-web-branch.ts`, `packages/pi-coding-agent/*`)
- Do **not** re-open PR-2 extraction files under `composed-lite/` or `shared-harness/`
- Do **not** re-open PR-3a files for new kernel semantics (`auto-dispatch.ts`, `auto/phases.ts`, `auto/loop-deps.ts`) unless a compile break proves a missed consumer glue edge
- Do **not** pull in PR-4 docs-map implementation work
- Do **not** add `advise_if_mismatch` anywhere outside PR-3b preset policy logic

### Budget guard

Stay near this envelope:

- main-side preference / validation / glue files: `~140-220` lines total
- new `phase-discipline/` directory: `~380-560` lines total
- tests: `~260-420` lines total

If the diff starts growing beyond that because the hook runtime bridge wants a generic plugin framework, stop. PR-3b is allowed one narrow phase-discipline-specific bridge, not a generalized new hook platform.

## Pre-flight checks

- [ ] **Step 1: Verify the three upstream dependency anchors are really present**

Run:

```bash
node -e "const fs=require('node:fs'); const checks=[['src/cli-web-branch.ts','resolveCreateAgentSessionToolOptions'],['src/resources/extensions/gsd/shared-harness/index.ts','shared-harness'],['src/resources/extensions/gsd/types.ts','action: \"proceed\" | \"skip\" | \"replace\" | \"advise\"'],['src/resources/extensions/gsd/auto-dispatch.ts','honour-phase-discipline-advice'],['src/resources/extensions/gsd/preferences-validation.ts','must be modify, skip, or replace']]; for (const [file,needle] of checks){const exists=fs.existsSync(file); const content=exists?fs.readFileSync(file,'utf8'):''; console.log(file, exists && content.includes(needle)?'FOUND':'MISSING', needle)}"
```

Expected:

- `src/cli-web-branch.ts` prints `FOUND resolveCreateAgentSessionToolOptions`
- `src/resources/extensions/gsd/shared-harness/index.ts` exists and prints `FOUND`
- `src/resources/extensions/gsd/types.ts` prints `FOUND action: "proceed" | "skip" | "replace" | "advise"`
- `src/resources/extensions/gsd/auto-dispatch.ts` prints `FOUND honour-phase-discipline-advice`
- `src/resources/extensions/gsd/preferences-validation.ts` may print either `FOUND must be modify, skip, or replace` (residue still open; close it in this PR) or `MISSING must be modify, skip, or replace` (validator already synced)
- If either CLI-chain or `shared-harness/*` prints `MISSING`, stop. If only the validator string is still `FOUND`, proceed and treat that as the first implementation task.

- [ ] **Step 2: Detect whether PR-3b has already partially landed in the workspace**

Run:

```bash
node -e "const fs=require('node:fs'); const paths=['src/resources/extensions/gsd/phase-discipline','src/tests/phase-discipline-integration.test.ts']; for (const p of paths) console.log(p, fs.existsSync(p)?'EXISTS':'MISSING')"
```

Expected:

- `src/resources/extensions/gsd/phase-discipline` may print either `EXISTS` or `MISSING`
- `src/tests/phase-discipline-integration.test.ts` may print either `EXISTS` or `MISSING`
- If any path already exists, treat this PR as a **gap-closing pass over partial implementation**: verify current behaviour, edit in place, and do **not** delete the directory just to make the original greenfield steps literally true.

- [ ] **Step 3: Re-confirm the current hook-runtime reality correction**

Run:

```bash
node -e "const fs=require('node:fs'); const registry=fs.readFileSync('src/resources/extensions/gsd/rule-registry.ts','utf8'); const auto=fs.readFileSync('src/resources/extensions/gsd/auto.ts','utf8'); const runUnit=fs.readFileSync('src/resources/extensions/gsd/auto/run-unit.ts','utf8'); console.log('registry returns hook prompt only:', registry.includes('prompt,') && registry.includes('unitType: `hook/${config.name}`')); console.log('auto hook path dispatches hook units:', auto.includes('const hookUnitType = `hook/${hookName}`')); console.log('run-unit remains last pre-send choke-point:', runUnit.includes('maybeRunPhaseDisciplineBuiltInHook') || runUnit.includes('pi.sendMessage('));"
```

Expected:

- All probes print `true`
- This confirms the minimal phase-discipline-specific hook bridge is still required, and that the fast-path fix belongs in `auto/run-unit.ts`

## Task 1: Add failing tests for the real PR-3b surface

**Files:**

- Modify: `src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts`
- Create: `src/tests/phase-discipline-integration.test.ts`
- Modify: `src/resources/extensions/gsd/tests/preferences.test.ts`
- Modify: `src/resources/extensions/gsd/tests/post-unit-hooks.test.ts`
- Modify: `src/resources/extensions/gsd/tests/rule-registry.test.ts`

- [ ] **Step 1: Extend `preferences.test.ts` with failing preference-surface cases**

Add these cases to the existing hook section:

```ts
test("milestone_profile accepts auto and phase-discipline-8step", () => {
  const a = validatePreferences({ milestone_profile: "auto" } as any);
  const b = validatePreferences({ milestone_profile: "phase-discipline-8step" } as any);
  assert.equal(a.errors.length, 0);
  assert.equal(a.preferences.milestone_profile, "auto");
  assert.equal(b.errors.length, 0);
  assert.equal(b.preferences.milestone_profile, "phase-discipline-8step");
});

test("post-unit hook review fields validate and clamp", () => {
  const result = validatePreferences({
    post_unit_hooks: [{
      name: "phase-discipline-code-review",
      after: ["execute-task"],
      prompt: "review",
      provider: "openai",
      cross_review: 7,
      cross_review_models: ["claude-code/claude-opus-4-6", "openai/gpt-5.4"],
    }],
  } as any);
  assert.equal(result.errors.length, 0);
  assert.equal(result.preferences.post_unit_hooks?.[0].provider, "openai");
  assert.equal(result.preferences.post_unit_hooks?.[0].cross_review, 5);
});

test("pre-dispatch advise action validates in the real preferences pipeline", () => {
  const result = validatePreferences({
    pre_dispatch_hooks: [{
      name: "phase-discipline-profile-dispatch",
      before: ["execute-task"],
      action: "advise",
      unit_type: "plan-slice",
    }],
  } as any);
  assert.equal(result.errors.length, 0);
  assert.equal(result.preferences.pre_dispatch_hooks?.[0].action, "advise");
});

test("cross_review_models count cannot exceed cross_review minus one", () => {
  const invalid = validatePreferences({
    post_unit_hooks: [{
      name: "phase-discipline-code-review",
      after: ["execute-task"],
      prompt: "review",
      cross_review: 2,
      cross_review_models: ["a", "b", "c"],
    }],
  } as any);
  assert.ok(invalid.errors.some((msg) => msg.includes("cross_review_models")));

  const valid = validatePreferences({
    post_unit_hooks: [{
      name: "phase-discipline-code-review",
      after: ["execute-task"],
      prompt: "review",
      cross_review: 3,
      cross_review_models: ["a", "b"],
    }],
  } as any);
  assert.equal(valid.errors.length, 0);
});

test("builtin markers survive the effective preference resolver when milestone_profile is enabled", () => {
  // Use the real preference fixture isolation pattern from this repo.
  // Assert that resolvePostUnitHooks()/resolvePreDispatchHooks() still return
  // preset-owned builtin markers after merge + revalidation.
});

```

- [ ] **Step 2: Create failing `merge.test.ts` for preset injection and shadow semantics**

Create `src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts` with these targets:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mergePhaseDisciplinePreset } from "../merge.ts";

test("profile off returns user hooks unchanged", () => {
  const userPost = [{ name: "user-review", after: ["execute-task"], prompt: "review" }];
  const merged = mergePhaseDisciplinePreset({ milestone_profile: "auto", post_unit_hooks: userPost } as any);
  assert.deepEqual(merged.postUnitHooks, userPost);
  assert.deepEqual(merged.preDispatchHooks, []);
});

test("profile on injects three post hooks and one pre-dispatch hook", () => {
  const merged = mergePhaseDisciplinePreset({ milestone_profile: "phase-discipline-8step" } as any);
  assert.deepEqual(merged.postUnitHooks.map(h => h.name), [
    "phase-discipline-code-review",
    "phase-discipline-design-review",
    "phase-discipline-findings-to-memories",
  ]);
  assert.deepEqual(merged.preDispatchHooks.map(h => h.name), [
    "phase-discipline-profile-dispatch",
  ]);
});

test("shadowing user hook replaces preset and defaults missing cross_review to 1", () => {
  const warnings: string[] = [];
  const merged = mergePhaseDisciplinePreset({
    milestone_profile: "phase-discipline-8step",
    post_unit_hooks: [{
      name: "phase-discipline-code-review",
      after: ["execute-task"],
      prompt: "custom reviewer",
    }],
  } as any, (msg) => warnings.push(msg));
  const hook = merged.postUnitHooks.find(h => h.name === "phase-discipline-code-review");
  assert.equal(hook?.prompt, "custom reviewer");
  assert.equal(hook?.cross_review, 1);
  assert.ok(warnings.some(w => w.includes("shadowed by user hook")));
  assert.ok(warnings.some(w => w.includes("lacks cross_review")));
});

```

- [ ] **Step 3: Create failing `profile-dispatch.test.ts` with real state-file fixtures**

Create a temp `.gsd` milestone fixture and assert the dynamic advisory path, not static config only. Use the repo's real `STATE.md` convention here; do **not** invent a `STATE.json` sidecar for PR-3b tests.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluatePhaseDisciplineProfileDispatch } from "../profile-dispatch.ts";

function makeBase(): string {
  const base = mkdtempSync(join(tmpdir(), "phase-discipline-profile-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  writeFileSync(join(base, ".gsd", "STATE.md"), [
    "**Active Milestone:** M001",
    "**Active Slice:** S01",
  ].join("\n"), "utf8");
  return base;
}

test("out-of-sequence execute-task advises plan-slice first", () => {
  const base = makeBase();
  try {
    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "implement",
      basePath: base,
    });
    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "plan-slice");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("P4 to P5 strict gate blocks verification advice when task summary evidence is missing", () => {
  const base = makeBase();
  try {
    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "validate-milestone",
      unitId: "M001",
      prompt: "validate",
      basePath: base,
    });
    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "execute-task");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

```

- [ ] **Step 4: Create failing `reviewer-hook.test.ts` for shared-harness fan-out**

Create a test that mocks `runReview(...)` and `pickReviewerModels(...)` and asserts the real contract:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runPhaseDisciplineReviewerHook } from "../reviewer-hook.ts";

test("cross_review=2 runs primary reviewer plus one picked reviewer and union-merges findings", async () => {
  const calls: Array<{ model: string; provider: string }> = [];
  const result = await runPhaseDisciplineReviewerHook({
    hookName: "phase-discipline-code-review",
    triggerUnitType: "execute-task",
    triggerUnitId: "M001/S01/T01",
    basePath: "/tmp/project",
    hookConfig: {
      name: "phase-discipline-code-review",
      after: ["execute-task"],
      prompt: "review",
      model: "gpt-5.4",
      provider: "openai",
      cross_review: 2,
    } as any,
    pickReviewers: () => [{ model: "claude-opus-4-6", provider: "claude-code" }],
    runReview: async ({ reviewerModel, reviewerProvider }) => {
      calls.push({ model: reviewerModel, provider: reviewerProvider });
      return reviewerModel === "gpt-5.4"
        ? { overall_assessment: "issues", critical: [], important: [{ target: "a", rationale: "x" }], minor: [], summary: "primary" }
        : { overall_assessment: "pass", critical: [], important: [{ target: "a", rationale: "x" }], minor: [{ target: "b", rationale: "y" }], summary: "secondary" };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.merge.overall_assessment, "issues");
  assert.equal(result.merge.important.length, 1);
  assert.equal(result.merge.minor.length, 1);
});

test("all reviewers failing writes reviewer_unavailable result", async () => {
  const result = await runPhaseDisciplineReviewerHook({
    hookName: "phase-discipline-code-review",
    triggerUnitType: "execute-task",
    triggerUnitId: "M001/S01/T01",
    basePath: "/tmp/project",
    hookConfig: { name: "phase-discipline-code-review", after: ["execute-task"], prompt: "review", cross_review: 2 } as any,
    pickReviewers: () => [{ model: "claude-opus-4-6", provider: "claude-code" }],
    runReview: async () => { throw new Error("401"); },
  });
  assert.equal(result.artifact.overall, "reviewer_unavailable");
});

```

- [ ] **Step 5: Create failing `phase-discipline-integration.test.ts` for the real call chain**

This test must touch the real resolver chain instead of only isolated helpers. Use the same `process.chdir(...)` + `GSD_HOME` isolation pattern already used in `src/resources/extensions/gsd/tests/preferences.test.ts`; do **not** assume `validatePreferences(...)` alone can drive `resolvePostUnitHooks()` / `resolvePreDispatchHooks()`.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePostUnitHooks, resolvePreDispatchHooks } from "../resources/extensions/gsd/preferences.ts";
import { initRegistry, getOrCreateRegistry, convertDispatchRules } from "../resources/extensions/gsd/rule-registry.ts";
import { DISPATCH_RULES } from "../resources/extensions/gsd/auto-dispatch.ts";

test("milestone_profile injects preset hooks into real resolver chain", () => {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const tempProject = mkdtempSync(join(tmpdir(), "phase-discipline-integration-project-"));
  const tempGsdHome = mkdtempSync(join(tmpdir(), "phase-discipline-integration-home-"));
  try {
    mkdirSync(join(tempProject, ".gsd"), { recursive: true });
    writeFileSync(join(tempProject, ".gsd", "PREFERENCES.md"), "---\nmilestone_profile: phase-discipline-8step\n---\n", "utf8");
    process.env.GSD_HOME = tempGsdHome;
    process.chdir(tempProject);

    const post = resolvePostUnitHooks();
    const pre = resolvePreDispatchHooks();
    assert.ok(post.some(h => h.name === "phase-discipline-code-review"));
    assert.ok(pre.some(h => h.name === "phase-discipline-profile-dispatch"));
  } finally {
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempGsdHome, { recursive: true, force: true });
  }
});

test("profile-dispatch returns advise through rule-registry when phase order mismatches", () => {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const tempProject = mkdtempSync(join(tmpdir(), "phase-discipline-integration-project-"));
  const tempGsdHome = mkdtempSync(join(tmpdir(), "phase-discipline-integration-home-"));
  try {
    mkdirSync(join(tempProject, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
    writeFileSync(join(tempProject, ".gsd", "PREFERENCES.md"), "---\nmilestone_profile: phase-discipline-8step\n---\n", "utf8");
    writeFileSync(join(tempProject, ".gsd", "STATE.md"), [
      "**Active Milestone:** M001",
      "**Active Slice:** S01",
    ].join("\n"), "utf8");
    process.env.GSD_HOME = tempGsdHome;
    process.chdir(tempProject);

    initRegistry(convertDispatchRules(DISPATCH_RULES));
    const registry = getOrCreateRegistry();
    const result = registry.evaluatePreDispatch("execute-task", "M001/S01/T01", "prompt", tempProject);
    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "plan-slice");
    assert.ok(result.firedHooks.includes("phase-discipline-profile-dispatch"));
  } finally {
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempGsdHome, { recursive: true, force: true });
  }
});

```

Use the real preference fixture technique already used elsewhere in this repo instead of global mutable stubs.

- [ ] **Step 5a: Extend `rule-registry.test.ts` with a named-hook precedence regression**

Add a focused regression proving `phase-discipline-profile-dispatch` is evaluated **before** the generic `hook.action === "advise"` branch. The assertion must verify that `advisedUnitType` comes from dynamic phase evaluation, not from a static `hook.unit_type` field.

- [ ] **Step 6: Run the new and modified tests and confirm they fail before implementation**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/preferences.test.ts src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts src/tests/phase-discipline-integration.test.ts
```

Expected:

- Exit code is non-zero
- At least one failure mentions missing `milestone_profile`, missing `cross_review` / `provider` fields, or missing `phase-discipline/*` modules
- It is acceptable if some legacy hook tests still pass unchanged

- [ ] **Step 7: Commit the failing coverage**

```bash
git add src/resources/extensions/gsd/tests/preferences.test.ts src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts src/tests/phase-discipline-integration.test.ts
git commit -m "test: add failing coverage for phase-discipline preset"
```

## Task 2: Land the preference surface, preset, and merge/revalidation pipeline

**Files:**

- Modify: `src/resources/extensions/gsd/types.ts`
- Modify: `src/resources/extensions/gsd/preferences-types.ts`
- Modify: `src/resources/extensions/gsd/preferences-validation.ts`
- Modify: `src/resources/extensions/gsd/preferences.ts`
- Create: `src/resources/extensions/gsd/phase-discipline/preset.ts`
- Create: `src/resources/extensions/gsd/phase-discipline/merge.ts`
- Create: `src/resources/extensions/gsd/phase-discipline/findings-carry.ts`
- Modify: `src/resources/extensions/gsd/phase-discipline/README.md`

- [ ] **Step 1: Extend the real hook config types in `types.ts`**

Add these fields to the existing interfaces:

```ts
export interface PostUnitHookConfig {
  // existing fields unchanged
  provider?: string;
  cross_review?: number;
  cross_review_models?: string[];
  builtin?: string;
}

export interface PreDispatchHookConfig {
  // existing fields unchanged
  provider?: string;
  builtin?: string;
}
```

Rules:

- Do **not** move these interfaces out of `types.ts`
- Do **not** add a generic executor/plugin abstraction here
- `phase-discipline`-specific execution stays outside the type surface unless a real compile need appears

- [ ] **Step 2: Add `milestone_profile` and update top-level known keys in `preferences-types.ts`**

Add the enum field to `GSDPreferences` and `KNOWN_PREFERENCE_KEYS`:

```ts
milestone_profile?: "auto" | "phase-discipline-8step";
```

Expected invariant after this step:

- `validatePreferences({ milestone_profile: "phase-discipline-8step" })` no longer emits `unknown preference key`

- [ ] **Step 3: Factor reusable hook-list validators out of `preferences-validation.ts`**

Extract the existing inline validation loops into reusable helpers so `preferences.ts` can validate both the raw user config and the merged preset config.

Required helpers:

```ts
export function validatePostUnitHookList(...): { hooks: PostUnitHookConfig[]; errors: string[]; warnings: string[] }
export function validatePreDispatchHookList(...): { hooks: PreDispatchHookConfig[]; errors: string[]; warnings: string[] }
```

And extend validation semantics:

```ts
const validActions = new Set(["modify", "skip", "replace", "advise"]);
```

Additional rules:

- `cross_review` clamps to `1..5`
- `cross_review_models.length` must be `<= cross_review - 1` when `cross_review >= 2`
- `milestone_profile` accepts only `"auto" | "phase-discipline-8step"`
- `provider` is a trimmed string when present
- `advise` does **not** require `prompt`
- preset-owned `builtin` markers must survive merged revalidation so runtime routing does not fall back to hook-name string checks
- implementation may either preserve `builtin` directly in validation or restore it immediately after revalidation, but Task 1 must lock the behaviour with a real resolver-path regression

- [ ] **Step 4: Add the preset and merge helpers under `phase-discipline/`**

Create `preset.ts` with one authoritative export:

```ts
export const phaseDiscipline8StepPreset = {
  postUnitHooks: [
    {
      name: "phase-discipline-code-review",
      after: ["execute-task"],
      prompt: "[phase-discipline reviewer hook]",
      builtin: "phase-discipline-code-review",
      artifact: "code-review-{taskId}.md",
      retry_on: "code-review-{taskId}-retry.md",
      max_cycles: 2,
      cross_review: 2,
    },
    {
      name: "phase-discipline-design-review",
      after: ["plan-slice", "refine-slice"],
      prompt: "[phase-discipline reviewer hook]",
      builtin: "phase-discipline-design-review",
      artifact: "design-review-{sliceId}.md",
      retry_on: "design-review-{sliceId}-retry.md",
      max_cycles: 2,
      cross_review: 2,
    },
    {
      name: "phase-discipline-findings-to-memories",
      after: ["complete-slice"],
      prompt: buildFindingsCarryPrompt(),
      max_cycles: 1,
    },
  ],
  preDispatchHooks: [
    {
      name: "phase-discipline-profile-dispatch",
      builtin: "phase-discipline-profile-dispatch",
      before: [
        "discuss-milestone",
        "research-milestone",
        "research-slice",
        "plan-slice",
        "refine-slice",
        "execute-task",
        "validate-milestone",
        "complete-slice",
        "complete-milestone",
      ],
      action: "advise",
    },
  ],
} as const;
```

Create `merge.ts` with a single public function that returns both merged hook arrays and takes an optional warning sink:

```ts
export function mergePhaseDisciplinePreset(
  prefs: GSDPreferences,
  warn: (message: string) => void = (message) => logWarning("preferences", message),
): { postUnitHooks: PostUnitHookConfig[]; preDispatchHooks: PreDispatchHookConfig[] }
```

 Ordering rule:
 
 - when the preset is enabled, `phase-discipline-profile-dispatch` must be placed first in `preDispatchHooks` so advisory gating runs before user-authored `modify` / `replace` hooks
 - user hooks shadow preset hooks by name only at the merge layer; runtime built-in routing must key off explicit `builtin` markers, not the hook `name` string alone

- [ ] **Step 5: Wire the two-stage validation + merge path in `preferences.ts`**

The real resolver order must be:

```ts
const validated = validatePreferences(rawPrefs);
const profile = resolveMilestoneProfile(validated.preferences);
if (profile !== "phase-discipline-8step") return validated.preferences.post_unit_hooks ?? [];
const merged = mergePhaseDisciplinePreset(validated.preferences);
const post = validatePostUnitHookList(merged.postUnitHooks);
const pre = validatePreDispatchHookList(merged.preDispatchHooks);
```

Concrete requirements:

- `resolvePostUnitHooks()` and `resolvePreDispatchHooks()` are still the only consumers seen by `rule-registry.listRules()`
- keep global/project merge in `mergePreferences(...)`; preset injection is a post-load extension, not a third persisted preference file layer
- merged preset bugs fail at load time, not at hook-fire time
- unknown `milestone_profile` logs a warning and falls back to `"auto"`
- user shadow semantics match the spec: full replacement, no field inheritance, missing `cross_review` defaults to `1`
- `provider` is only a fallback qualifier for reviewer model strings that do **not** already include a provider prefix
- if `model` or any item in `cross_review_models` is already provider-qualified, that explicit qualifier wins over `provider`
- `phase-discipline-findings-to-memories` ignores `provider` entirely because it remains on the prompt path
- the focused regression surface for this step includes proving that effective resolved hooks still expose `builtin` markers after merge + revalidation

- [ ] **Step 6: Run the preference-focused test slice**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/preferences.test.ts src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts
```

Expected:

- Exit code `0`
- `preferences.test.ts` passes for `milestone_profile`, `provider`, `cross_review`, and `advise`
- `merge.test.ts` passes for preset injection and shadow semantics

- [ ] **Step 7: Commit the preference/preset surface**

```bash
git add src/resources/extensions/gsd/types.ts src/resources/extensions/gsd/preferences-types.ts src/resources/extensions/gsd/preferences-validation.ts src/resources/extensions/gsd/preferences.ts src/resources/extensions/gsd/phase-discipline/preset.ts src/resources/extensions/gsd/phase-discipline/merge.ts src/resources/extensions/gsd/phase-discipline/findings-carry.ts src/resources/extensions/gsd/phase-discipline/README.md
git commit -m "feat: add phase-discipline preset preference surface"
```

## Task 3: Implement the B-min sequence and the minimal phase-discipline hook bridge

**Files:**

- Create: `src/resources/extensions/gsd/phase-discipline/profile-map.ts`
- Create: `src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts`
- Create: `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
- Modify: `src/resources/extensions/gsd/rule-registry.ts`
- Modify: `src/resources/extensions/gsd/auto/run-unit.ts`
- Modify: `src/resources/extensions/gsd/tests/post-unit-hooks.test.ts`
- Modify: `src/resources/extensions/gsd/tests/rule-registry.test.ts`
- Test: `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts`
- Test: `src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts`

- [ ] **Step 1: Add the authoritative B-min phase map in `profile-map.ts`**

Export the sequence as data, not inline conditionals:

```ts
export const PHASE_DISCIPLINE_8STEP_SEQUENCE = [
  { phase: "P0", units: ["discuss-milestone"], gating: "soft" },
  { phase: "P1", units: ["research-milestone", "research-slice"], gating: "soft" },
  { phase: "P2", units: ["plan-slice", "refine-slice"], gating: "soft" },
  { phase: "P3", units: ["plan-slice"], gating: "soft" },
  { phase: "P4", units: ["execute-task"], gating: "strict", completionArtifact: ".gsd/milestones/{mid}/slices/{sid}/tasks/*-SUMMARY.md" },
  { phase: "P5", units: ["validate-milestone"], gating: "soft" },
  { phase: "P6", units: ["complete-slice", "complete-milestone"], gating: "soft" },
] as const;
```

Document in the file header that P3 intentionally reuses `plan-slice` after the broader P2 planning/refinement window; the evaluator must disambiguate P2 vs P3 from current state / artifact readiness rather than inventing a new unit type.

Additional invariant: do **not** alternate advisory output between two identical effective dispatch targets just to advance the phase label. If the current fixture cannot distinguish P2 vs P3 with a stable artifact/state signal, prefer one stable advisory target over oscillation.

Keep P7 out-of-band exactly as the spec requires. Document this explicitly in the file header: the preset is still named `8step`, but this exported sequence intentionally covers only dispatch-relevant P0-P6; the final learnings/extraction step is represented by `phase-discipline-findings-to-memories`, not by an extra dispatch row.

- [ ] **Step 2: Implement `profile-dispatch.ts` as a synchronous evaluator**

Export one function:

```ts
export function evaluatePhaseDisciplineProfileDispatch(input: {
  unitType: string;
  unitId: string;
  prompt: string;
  basePath: string;
}): PreDispatchResult
```

Required behaviour:

- read current milestone/slice state through the repo's existing state helpers and/or the real `.gsd/STATE.md` projection; do **not** introduce a new `STATE.json` runtime dependency in PR-3b
- it is acceptable for PR-3b to keep a narrow `.gsd/STATE.md` projection parser if no canonical helper cleanly exposes the required fields on this branch tip; treat that as a documented implementation debt, not as scope for a new state runtime in this PR
- if the scheduler pick already matches the expected next phase, return `{ action: "proceed", prompt }`
- if P4→P5 strict gate is not satisfied because the current slice has no stable `execute-task` completion summary artifact yet, return `{ action: "advise", advisedUnitType: "execute-task", prompt }`
- if the pick is out of sequence for a soft gate, return `{ action: "advise", advisedUnitType: expectedUnit, prompt }`
- after 3 consecutive disagreements for the same milestone+phase, stop advising for the remainder of that process and emit `logWarning`

Use a small module-local map for disagreement backoff. Do **not** invent a persisted sidecar file for this. Backoff is process-local and resets after restart.

- [ ] **Step 3: Teach `rule-registry.ts` to execute the preset-owned phase-discipline pre-dispatch handler**

Keep the legacy declarative path intact. Add one narrow branch inside `evaluatePreDispatch()`:

```ts
if (hook.builtin === "phase-discipline-profile-dispatch") {
  firedHooks.push(hook.name);
  return evaluatePhaseDisciplineProfileDispatch({ unitType, unitId, prompt: currentPrompt, basePath });
}
```

Rules:

- only special-case the single preset-owned built-in hook
- evaluate this named branch **before** the generic `hook.action === "advise"` branch so dynamic phase-discipline advice is not swallowed by declarative `advise` handling
- when `milestone_profile` is enabled, ensure the merged `phase-discipline-profile-dispatch` hook is evaluated first in the pre-dispatch list so any `advise` decision short-circuits before user `modify` / `replace` hooks compose
- do **not** create a general hook-plugin registry
- all legacy `modify` / `skip` / `replace` / user-authored `advise` hooks remain untouched
- lock this order with a focused regression in `src/resources/extensions/gsd/tests/rule-registry.test.ts`

- [ ] **Step 4: Implement `reviewer-hook.ts` against PR-2 shared-harness contracts**

Export a narrow runner for the two reviewer hooks:

```ts
export async function runPhaseDisciplineReviewerHook(input: {
  hookName: "phase-discipline-code-review" | "phase-discipline-design-review";
  triggerUnitType: string;
  triggerUnitId: string;
  basePath: string;
  hookConfig: PostUnitHookConfig;
  pickReviewers?: typeof pickCrossReviewers;
  runReview?: typeof runReview;
}): Promise<{
  merge: ReviewMergeResult;
  artifact: { path: string; overall: string };
  observabilityLogPath: string;
}>
```

Required semantics:

- primary reviewer comes from `hookConfig.model` / `hookConfig.provider`, falling back to the current runtime model/provider when unset
- extra reviewers come from `cross_review_models` or the picker
- if `hookConfig.model` or any entry in `cross_review_models` is already provider-qualified, use it as-is and infer the effective provider from the qualified value for logging / picker context; otherwise apply `hookConfig.provider` only as a fallback qualifier
- production defaults import `pickCrossReviewers` / `runReview` from `shared-harness/*`; dependency injection exists only for tests
- clamp `cross_review` at 5
- run reviewers in parallel
- apply an absolute hard timeout per reviewer invocation using the auto supervisor hard-timeout budget
- union/dedupe findings, choose worst overall assessment
- partial failures continue with successes
- all-fail writes `reviewer_unavailable` artifact shape
- write normal hook artifact and retry signal files through `resolveHookArtifactPath(...)`; the bridge may bypass `pi.sendMessage(...)`, but artifact detection and `retry_on` handling must remain owned by the existing registry cycle flow
- do **not** mutate `cycleCounts`, `retryPending`, or `_handleHookCompletion()` directly in `reviewer-hook.ts`; integration with cycle/retry happens only by writing the standard artifact and optional retry signal files where the existing registry scan already looks
- write an observability file as a sibling to the resolved artifact directory at `<artifactDir>/.phase-discipline/<hookName>-<triggerUnitId-sanitized>.json`
- observability JSON must include at least `hookName`, `triggerUnitType`, `triggerUnitId`, `artifactPath`, `reviewers`, `succeeded`, `failed`, `overall`, `startedAt`, and `completedAt`
- preserve artifact naming / retry file naming from the spec

- [ ] **Step 5: Add the minimal post-unit bridge in `auto/run-unit.ts` instead of a general hook runtime**

Inside the existing hook-unit path, intercept only the preset-owned phase-discipline reviewer hooks before `newSession()` / `pi.sendMessage(...)`:

```ts
if (hookConfig?.builtin === "phase-discipline-code-review" || hookConfig?.builtin === "phase-discipline-design-review") {
  await runPhaseDisciplineReviewerHook({
    hookName,
    triggerUnitType,
    triggerUnitId,
    basePath: targetBasePath,
    hookConfig: resolvePostUnitHooks().find(h => h.name === hookName)!,
  });
  return true;
}
```

Important constraints:

- leave legacy hook-unit prompt execution byte-identical for all other hooks
- keep `phase-discipline-findings-to-memories` on the prompt path
- built-in hook detection must happen **before** `newSession()` so reviewer hooks do not burn a session only to short-circuit immediately
- the bridge replaces only the hook body; `RuleRegistry` keeps owning `activeHook`, `cycleCounts`, and `_handleHookCompletion()` semantics, and `return true` is valid only after the reviewer hook has written the artifact / retry / observability files where the normal completion / retry scan expects them
- do **not** widen `SidecarItem` or `HookDispatchResult` unless a compile error proves it necessary

- [ ] **Step 6: Run the phase-discipline-focused test slice**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts src/tests/phase-discipline-integration.test.ts
```

Expected:

- Exit code `0`
- `profile-dispatch.test.ts` proves real advisory decisions from state fixtures
- `reviewer-hook.test.ts` proves fan-out, clamp, merge, and all-fail artifact behaviour
- `phase-discipline-integration.test.ts` proves the preset reaches the real resolver chain and that preset-owned `builtin` markers survive merge + revalidation on the real preference loader path

- [ ] **Step 7: Commit the B-min skeleton and hook bridge**

```bash
git add src/resources/extensions/gsd/rule-registry.ts src/resources/extensions/gsd/auto/run-unit.ts src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline/profile-map.ts src/resources/extensions/gsd/phase-discipline/profile-dispatch.ts src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts src/tests/phase-discipline-integration.test.ts
git commit -m "feat: add phase-discipline b-min skeleton"
```

## Task 4: Final verification and scope guard

**Files:**

- Verify only: all files listed in the locked scope above

- [ ] **Step 1: Run the focused final verification set**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/preferences.test.ts src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline/tests/merge.test.ts src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts src/tests/phase-discipline-integration.test.ts && npm run typecheck:extensions
```

Expected:

- all focused tests pass
- `tsc --noEmit --project tsconfig.extensions.json` exits `0`

- [ ] **Step 2: Diff only the PR-3b surface**

Run:

```bash
git diff --stat -- src/resources/extensions/gsd/types.ts src/resources/extensions/gsd/preferences-types.ts src/resources/extensions/gsd/preferences-validation.ts src/resources/extensions/gsd/preferences.ts src/resources/extensions/gsd/rule-registry.ts src/resources/extensions/gsd/auto/run-unit.ts src/resources/extensions/gsd/tests/preferences.test.ts src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline src/tests/phase-discipline-integration.test.ts
```

Expected:

- diff stays within the listed PR-3b files
- no re-opened PR-1 / PR-2 / PR-3a / PR-4 files appear
- no generic hook framework files appear outside the locked scope

- [ ] **Step 3: Enforce the no-go condition if the bridge wants to generalize**

If implementation pressure pushes you toward a generic hook plugin framework, stop with this exact summary:

```text
PR-3b exceeded its consumer-only boundary. The current branch needs a generalized hook runtime, not the planned narrow phase-discipline bridge. Stop here, save a handoff, and write a follow-up design micro-plan before editing more files.
```

- [ ] **Step 4: Create the final implementation commit**

```bash
git add src/resources/extensions/gsd/types.ts src/resources/extensions/gsd/preferences-types.ts src/resources/extensions/gsd/preferences-validation.ts src/resources/extensions/gsd/preferences.ts src/resources/extensions/gsd/rule-registry.ts src/resources/extensions/gsd/auto/run-unit.ts src/resources/extensions/gsd/tests/preferences.test.ts src/resources/extensions/gsd/tests/post-unit-hooks.test.ts src/resources/extensions/gsd/tests/rule-registry.test.ts src/resources/extensions/gsd/phase-discipline src/tests/phase-discipline-integration.test.ts
git commit -m "feat: add phase-discipline preset and b-min skeleton"
```

## Self-review against the spec and real code

### Spec coverage

- `milestone_profile: "phase-discipline-8step"` is implemented through the real preferences load path, not a dead field
- PR-3b consumes PR-3a's `advise` contract via `profile-dispatch.ts`
- PR-3b consumes PR-2's `shared-harness/*` via `reviewer-hook.ts`
- reviewer subagent restriction assumes PR-1 is already merged and therefore does not re-implement CLI restriction logic here
- the three post-unit hooks plus the single profile pre-dispatch hook land as the actual preset surface
- observability `.phase-discipline/*.json` is covered by the reviewer hook runner

### Reality-correction coverage

- `types.ts` is included because that is where hook config fields really live
- `preferences-validation.ts` is included because the real loader still rejects `advise` otherwise
- `rule-registry.ts` and `auto/run-unit.ts` are included only for the smallest possible phase-discipline-specific execution bridge
- only `hook/phase-discipline-code-review` and `hook/phase-discipline-design-review` branch off the prompt path; all other `hook/*` units remain on the legacy `pi.sendMessage(...)` route
- runtime built-in routing keys off explicit preset-owned `builtin` markers, not raw hook names, so user shadow hooks are not silently hijacked
- `phase-discipline/README.md` already exists in the workspace; this pass updates and re-verifies it instead of treating README creation as missing work
- the current branch still has no `src/tests/phase-discipline-integration.test.ts`; integration coverage remains a real gap until that file lands
- no attempt is made to build a generic second hook platform

### Placeholder scan

- No `TBD`
- No `TODO`
- No “just wire it up somehow” steps
- No hidden dependency on PR-4
- No assumption that `phase-discipline/*.ts` executes magically without bridge code

### Type consistency

This plan uses one vocabulary end-to-end:

- `milestone_profile`
- `phase-discipline-8step`
- `phase-discipline-profile-dispatch`
- `phase-discipline-code-review`
- `phase-discipline-design-review`
- `phase-discipline-findings-to-memories`
- `cross_review`
- `cross_review_models`
- `provider`
- `action: "advise"`

Plan complete and saved to `docs/superpowers/plans/2026-04-23-pr-3b-phase-discipline-preset-b-min-skeleton.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

- 问题：Task 3 Step 5 的桥接写的是：
  ```ts
  if (hookName === "phase-discipline-code-review" || ...) {
    await runPhaseDisciplineReviewerHook({...});
    return true;
  }
  ```
  `return true` 绕开了 `pi.sendMessage`。但原有 hook-unit 路径在 `rule-registry.ts` 里同时维护 `cycleCounts` / `retryPending` / `_handleHookCompletion`（参考 `rule-registry.ts:155-260`）。计划没说桥接返回后：
  1. 是否要写 `artifact` 文件触发 `_handleHookCompletion` 的 `retry_on` 检测？
  2. 是否要递增 `cycleCounts`，让 `max_cycles: 2` 生效？
  3. `reviewer_unavailable` 情况下是否算一次失败（触发 retry）还是直接放行？
- 修复建议：在 Task 3 Step 4 `reviewer-hook.ts` 的 spec 里把产物写入明确成"必须写入 `.gsd/<mid>/<sid>/tasks/<tid>/<artifact>` 并可被现有 `resolveHookArtifactPath` 解析"，以便 `_handleHookCompletion` 的 `retry_on` 检测正常工作；并显式声明"桥接调用返回后，仍走 registry 现有的 cycle 计数 / retry 触发路径，不走 `pi.sendMessage` 只是替换了 hook body 的执行方式"。

#### 3.5 【Semi-blocking】P2/P3 在 `profile-map` 数据表里语义重复

- 计划 Task 3 Step 1 的序列：
  ```ts
  { phase: "P2", units: ["plan-slice", "refine-slice"], gating: "soft" },
  { phase: "P3", units: ["plan-slice"],                gating: "soft" },
  ```
  - P3 units 是 P2 units 的真子集，会让"期望下一步"的匹配产生歧义。
- 背景：spec v7.1 把 P2 = design-shotgun/design-review、P3 = impl-plan 描述为两个独立阶段，但 auto-mode 里没有 `impl-plan` 这种 unit，B-min 把它并回 `plan-slice`。因此 P3 的存在只是为了"数"八步，实际没有新单元。
- 修复建议：在 `profile-map.ts` 里合并 P2+P3 或者加注释明确"P3 重用 P2 单元，profile-dispatch 内部靠 `designReviewArtifactExists()` 等信号而非独立 unitType 区分"；否则 `evaluatePhaseDisciplineProfileDispatch` 的实现会在判断"当前到底在 P2 还是 P3"时出现分叉逻辑。更干净的方案是把 P3 从数据表删掉，把判定逻辑写在 `profile-dispatch.ts` 里并在注释里解释"名为 8-step，但 B-min 骨架只 map 到 7 个 unit 档位，第 8 档由 `findings-to-memories` post-unit hook 承担"。

#### 3.6 【Non-blocking】一致性术语：P7 / "8-step"

- 计划自相矛盾：`phase-discipline-8step` 的序列数据表里只有 P0–P6（7 条），P7（extract-learnings）被 Task 3 Step 1 备注为 "Keep P7 out-of-band"。spec 也同样处理。
- 影响：新读者会困惑为何叫 8-step。
- 修复建议：在 `profile-map.ts` 顶部加一段说明："8 阶段中 P7 由 `phase-discipline-findings-to-memories` post-unit hook 实现，不在 `PHASE_DISCIPLINE_8STEP_SEQUENCE` 数据表里"；同时 `README.md` 加一条 FAQ。

#### 3.7 【Non-blocking】整合测试断言过松

- Task 1 Step 5 的断言：
  ```ts
  assert.ok(["proceed", "advise"].includes(result.action));
  ```
  如果 preset 根本没触发，`proceed` 也会通过，等于没断言。
- 修复建议：改成：
  ```ts
  assert.equal(result.action, "advise");
  assert.ok(result.firedHooks.includes("phase-discipline-profile-dispatch"));
  ```
  并为"用户关闭 `milestone_profile`"的负例加独立断言。

#### 3.8 【Non-blocking】disagreement 背压只存内存

- Task 3 Step 2 用"module-local map"记录连续三次分歧，重启 auto-mode 后清零。MVP 可以接受，但 spec 的"error handling" 章节宣称"after 3 consecutive disagreements ... stop advising for the remainder of that process"；"that process" 这个锚点应该在 README / spec 中明说是"node 进程生命周期内"，以免有人把 `.phase-discipline/state.json` 当预期产物。
- 修复建议：在 `profile-dispatch.ts` 头部 JSDoc 以及 spec Error handling 表注明"back-off 仅在当前 auto-mode 进程内生效；crash/restart 后重新从 0 计数"。

#### 3.9 【Non-blocking】`cross_review_models.length <= cross_review - 1` 的约束缺乏负例测试

- 计划 Task 2 Step 3 引入了这条新校验规则，但 Task 1 Step 1 的 preference 用例只测了"`cross_review: 7` 被 clamp 到 5"，没测"给了 4 个 models 但 `cross_review: 2` 时应该报错"。
- 修复建议：`preferences.test.ts` 新增两个用例：
  1. `cross_review: 2, cross_review_models: ["a","b","c"]` → `errors.length > 0`，且错误信息含 "cross_review_models"
  2. `cross_review: 3, cross_review_models: ["a","b"]` → 通过

#### 3.10 【Non-blocking】`findings-carry.ts` 的边界没写死

- 计划把 `buildFindingsCarryPrompt()` 放进 `phase-discipline/findings-carry.ts`，preset.ts 里直接内联调用。但 findings → memories 的"规范写入路径"是 PR-4 docs-map 的职责。计划没有明文禁止 `findings-carry.ts` 写磁盘。
- 修复建议：在 `findings-carry.ts` 顶部 JSDoc 写明"本模块仅产出提示词字符串，不执行任何文件写入；memories 的持久化由 post-unit hook 的 prompt 驱动 subagent 完成"。这样把"findings 入 memories"的落地责任留给未来 PR-4，不会把 PR-3b 逼成 docs-map MVP。

### 4. 次要/风格类建议（非阻塞）

- Task 1 Step 2 的 `merge.test.ts` 里 `warn` 回调签名是 `(msg) => warnings.push(msg)`，但 Task 2 Step 4 的 `mergePhaseDisciplinePreset` 签名默认值是 `logWarning("preferences", msg)`。统一成"单参数 `warn(message: string)`，内部调用处决定是否拼 scope"，避免 logWarning 的两参风格泄漏到测试 mock。
- Task 4 Step 2 的 `git diff --stat` 校验没给出"期望的最大文件数"阈值，只有文字描述。建议加一条脚本式 guard，把白名单之外的变更直接 `exit 1`。
- "Reality-correction coverage" 章节建议再加一条："`auto.ts` 的 hook-unit 路径仅在 `hook/phase-discipline-code-review` / `hook/phase-discipline-design-review` 两个具名单元上分叉；其它 `hook/*` 仍走 `pi.sendMessage`"，和 Task 3 Step 5 的实现约束一一对应，便于 reviewer 快速核对"没有被扩写成通用插件路径"。
- Task 3 Step 4 的 `reviewer-hook.ts` 签名里 `pickReviewers` / `runReview` 是可注入的，这非常好（便于测试）；但 spec/README 没写"生产默认实现来自 `shared-harness/`"。建议在 `reviewer-hook.ts` JSDoc 明示 `import { pickCrossReviewers, runReview } from "../shared-harness"`，让 PR-2 的消费锚点明确。

### 5. 风险清单（开工前请确认）

| # | 风险 | 触发条件 | 缓解 |
| --- | --- | --- | --- |
| R1 | 读错 state 文件（`STATE.json` vs `STATE.md`/`state.ts`） | Task 1/3 直接按字面实现 | 3.1 的修复方案二选一 |
| R2 | PR-3a 的 `DISPATCH_RULES` 接线缺席 | 仅合并了类型扩展就放行 | 3.2 增加 grep 门禁 + 集成测试 |
| R3 | hook 合成顺序未定 | 用户自带 `modify` pre-dispatch hook | 3.3 preset 的 pre hook 强制排首位 |
| R4 | 桥接绕过 cycle/retry | 桥接返回 `true` 后漏写 artifact | 3.4 在 reviewer-hook 中写回标准 artifact 路径 |
| R5 | P3 重复 unit 导致 advisory 震荡 | `profile-dispatch` 反复在 P2 / P3 间切换 | 3.5 合并或注释清楚 |
| R6 | 静默失效 | 集成测试断言过松 | 3.7 收紧到 `equal("advise")` + `firedHooks` 核查 |

### 6. 总体判定

- **设计思路合理性**：✅ 合理。核心判断（依赖门、最小桥接、两阶段校验、反通用化）都与 spec v7.1 的 Δ-K1 契约吻合。
- **正确性**：⚠ 可用但需修补。3.1 / 3.2 属于"不修就会静默失效"，必须在开工前加门禁或调整测试夹具；3.3 / 3.4 / 3.5 属于"实现阶段会被逼着重写"，最好在 plan 层面先写死语义。
- **完整性**：⚠ 覆盖了主干，但 3.6–3.10 几个 non-blocking 项会让未来 reviewer 反复来回澄清；建议在下一版 plan 里吸收 3.1 / 3.2 / 3.3 / 3.4 作为硬修改，3.5–3.10 作为 spec/README 文档层补丁。

> 推荐落地顺序：先把 3.1 / 3.2 的门禁和 3.3 的排序约束合入本 plan（大约追加 20 行）；3.4 顺带在 Task 3 Step 4 的 semantic list 里加一条"写 artifact 后由现有 `_handleHookCompletion` 接管 retry/cycle"；其余建议直接在 spec / README 的后续修订里吸收。

评审人：Cursor Opus 4.7 (本次会话)  
参照基线：`specs/phase-discipline-preset.md` v7.1、`specs/README.md`、`main` 当前 `src/resources/extensions/gsd/*`。

---

## 二轮评审（Claude Opus 4.7, 2026-04-23 复核）

> 评审范围：在首轮评审基础上，独立复核 plan 与 workspace 当前实际状态，识别一轮后出现的新事实、一轮遗漏的问题、以及 plan 目前是否已"就绪可开工"。
> 核验方法：`git diff` / `grep` 真实源码，对照 plan 每一条"现实声明"逐项打分。

> Status note: the plan body above is the current source of truth. Parts of B.1 / B.2 / B.3 / B.4 / B.7 / B.8 have since been integrated into the plan body; keep this section as audit trail and re-check only the items that remain explicitly unresolved.

### A. 首轮评审结论复核

| 首轮结论 | 复核结果 | 备注 |
| --- | --- | --- |
| 3.1 `STATE.md` vs `STATE.json` | ✅ 已在 plan Task 1 Step 3 正文中吸收（"use the repo's real STATE.md convention here; do **not** invent a STATE.json sidecar"） | 但 Task 3 Step 2 仍只说"`.gsd/STATE.md` convention and/or existing state helpers"，二选一未明确；建议进一步收敛为"必须经 `state.ts` 的 `computeState()`/`loadState()`"以免两次实现偏移 |
| 3.2 `DISPATCH_RULES` 接线校验 | ✅ Pre-flight Step 1 已加 `honour-phase-discipline-advice` grep | 但整合测试的 E2E 断言（见首轮修复建议"下一次 pick 是 `advisedUnitType`"）尚未写入 Task 1 Step 5；目前仅断言 `result.action === "advise"`，没覆盖 dispatch 真的改道 |
| 3.3 多 hook 合成顺序 | ✅ Task 3 Step 3 补了"ensure … evaluated first"措辞 | 但没要求在 `merge.ts` 单测里断言顺序；详见下方 B.2 |
| 3.4 桥接绕过 cycle/retry | ⚠ Task 3 Step 4 / Step 5 措辞仍偏软（"write normal hook artifact and retry signal files through `resolveHookArtifactPath(...)` so existing registry cycle / retry handling remains authoritative"），没有明确"桥接返回 `true` 后 registry 的 `_handleHookCompletion` 仍会被下一轮 scan 触发" | 需要 plan 显式写入"桥接不进入 `pi.sendMessage` 但依然通过产物检测与 retry_on 融入既有 cycle" |
| 3.5 P2/P3 重复 | ❌ 未解决 | `profile-map.ts` 的数据表仍原样含 P2/P3 重叠；Task 3 Step 1 只加了 P7 out-of-band 的注释，没加 P2/P3 去重或注释解释 |
| 3.6–3.10 Non-blocking | 部分吸收 | 3.9 的负例在 Task 1 Step 1 已补 "cross_review_models count cannot exceed cross_review minus one"；3.7 的严格断言未下沉到 Task 1 Step 5 的 integration test；3.10 的 `findings-carry.ts` 禁写磁盘约束仍无体现 |

一句话：首轮 6 个阻塞/半阻塞点中，**3.1 / 3.2 / 3.3 被部分吸收，3.4 / 3.5 仍未消解**。二轮评审继续下挖。

### B. 二轮新发现（Plan 当前版本仍未解决）

#### B.1【Blocking 事实错误】Pre-flight 快照与真实 workspace 状态不一致

**证据**：
- Plan 第 27 行："PR-1 anchor appears present: `resolveCreateAgentSessionToolOptions` exists"。
- `rg resolveCreateAgentSessionToolOptions src/` 在当前 `src/` 下**一条都搜不到**；该符号**仅存在于文档**（`docs/superpowers/plans/2026-04-23-pr-1-cli-tool-restriction-chain.md` 等）。
- Plan 第 29 行："PR-3a anchor is still absent: `src/resources/extensions/gsd/types.ts` does not yet contain `action: "proceed" | "skip" | "replace" | "advise"`"。
- `git diff src/resources/extensions/gsd/types.ts` 显示这段联合类型**已在本 workspace 被加进去**（`action: "proceed" | "skip" | "replace" | "advise"`, 另含 `advisedUnitType` / `advisedUnitId`）；且 `auto-dispatch.ts` 已加入 `honour-phase-discipline-advice` 规则与 `DispatchContext.advisedUnit`；`auto/phases.ts` 已在 `runDispatch` 中插入 `runPreDispatchHooks` 调用并对 `advise` 结果二次 `resolveDispatch`；`auto/loop-deps.ts` 已扩展 `runPreDispatchHooks` 返回 `advisedUnitType` / `advisedUnitId` / `unitId`；新测试 `tests/pre-dispatch-advise.test.ts` 也存在。

**结论**：
- PR-3a 已经在这台机器上"实现中（未 commit）"，plan 的快照描述**反了**（声明缺失却已实现）。
- PR-1 的 `resolveCreateAgentSessionToolOptions` 则**真的缺失**，plan 却声明它"存在"。

**影响**：
- Worker 按 plan Pre-flight Step 1 跑一遍 `node -e …`，会得到：`src/cli-web-branch.ts` 为 MISSING、shared-harness 为 MISSING，但 `types.ts` 和 `auto-dispatch.ts` FOUND。这与 plan 给的"expected"直接矛盾，worker 不知道以哪个为准就会阻塞。

**修复**：
- 删除或更新 plan 第 25–31 行的"Current read-only verification snapshot"，改为"以 Pre-flight Step 1 的实际结果为准；忽略本文写作时的瞬时快照"。
- 或者在 plan 头部追加一句"本快照可能已过时，唯一真源是 Pre-flight Step 1 的命令输出"。

#### B.2【Blocking】新加的 `phase-discipline-profile-dispatch` 分支必须排在 `action === "advise"` 通用分支之前

**证据**：
- 当前 `rule-registry.ts` 的 PR-3a 实现（已在 workspace）加了一段：
  ```ts
  if (hook.action === "advise") {
    firedHooks.push(hook.name);
    return {
      action: "advise",
      prompt: currentPrompt,
      advisedUnitType: hook.unit_type,  // 声明式：来自静态 preset 配置
      model: hook.model,
      firedHooks,
    };
  }
  ```
- Plan Task 3 Step 3 在 `evaluatePreDispatch()` 里插入动态分支：
  ```ts
  if (hook.name === "phase-discipline-profile-dispatch") {
    firedHooks.push(hook.name);
    return evaluatePhaseDisciplineProfileDispatch(...);
  }
  ```
- 但 `phase-discipline-profile-dispatch` 在 preset 里就是 `action: "advise"`。如果上面的通用 `action === "advise"` 分支**先**于按名分支评估（常规 compose 语义里"先出现的先返回"），那么这个 hook 会被通用分支截获：因为 preset 没给 `unit_type`，`advisedUnitType` 会变成 `undefined`，导致 `auto-dispatch.ts` 的 `honour-phase-discipline-advice` 规则拿不到有效 advice 而 fallback 回正常 dispatch；整个 B-min 静默失效。

**修复**：
- 在 Task 3 Step 3 显式写"new named branch must be evaluated **before** the generic `hook.action === "advise"` branch in `evaluatePreDispatch`"。
- 在 `rule-registry.test.ts` 新增一条用例：给一个 `name: "phase-discipline-profile-dispatch"` + `action: "advise"` 的 hook，断言返回的 `advisedUnitType` 来自**动态状态计算**（非 `hook.unit_type` 的静态值 `undefined`），例如通过构造一个 out-of-sequence 的 fixture 验证 `advisedUnitType === "plan-slice"`。

#### B.3【Blocking 预算】`~260-380 lines` 的 `phase-discipline/` 预算过紧

**证据**：按 plan 清单，`phase-discipline/` 下要创建 6 个 `.ts` 文件：
- `preset.ts`（含 4 个 hook 的完整配置 + `buildFindingsCarryPrompt()` 接入）：估 ~50 行
- `merge.ts`（含 profile 开关 / shadow 语义 / 默认 `cross_review=1` / 警告 / 顺序保证）：估 ~80–100 行
- `profile-map.ts`（数据表 + 文档头 + P7 注解）：估 ~30 行
- `profile-dispatch.ts`（读 state / 对照 map / P4→P5 strict gate / 背压 / 日志）：估 ~120–180 行
- `reviewer-hook.ts`（primary + picker 拉起 + parallel / union merge / clamp=5 / 部分失败 / `reviewer_unavailable` / artifact 写入 / observability JSON）：估 ~180–260 行
- `findings-carry.ts`（提示词拼装；per 3.10 禁写磁盘）：估 ~30 行
- `README.md`：不计

**合计最低估算 ~490 行**，上界 ~600 行，都远超 plan 宣称的 `260-380`。这不是"多 20%"的误差，而是"低估近 1 倍"。

**影响**：按 plan 现在的预算，worker 写到一半会撞线。Task 4 Step 3 的"no-go"机制不是为了应付 20% 超标，而是"是否长出通用框架"—— 单纯按功能写完就超标，会引发假报警。

**修复**：把 `phase-discipline/` 预算调为 `~380-560 lines`；或在 plan 显式列出"单文件上限"（如 `reviewer-hook.ts ≤ 260`）后再给总预算。

#### B.4【Semi-blocking】`provider` 字段语义缺失

**证据**：
- PR-3a workspace diff 已经把 `provider?: string` 加进 `PostUnitHookConfig` / `PreDispatchHookConfig`（按 plan Task 2 Step 1 的指令）。
- 但 plan / spec 没有任何一句话定义 `provider` 的语义：
  - 是 `reviewer-hook.ts` 内部 `runReview({ reviewerProvider: hookConfig.provider })` 的透传？
  - 当 `model` 已含 provider 前缀（例如 `claude-code/claude-opus-4-6`）时，`provider` 字段是否与之冲突？
  - `provider` + `cross_review_models` 同时给时，`cross_review_models` 的每一项是独立解析还是沿用 `provider`？
  - `provider` 在 `phase-discipline-findings-to-memories`（走 prompt 路径、无 fan-out）语义是什么？

**影响**：`reviewer-hook.ts` 和 `shared-harness/runReview` 接口无法精确实现，生产行为不可预测。

**修复**：在 plan Task 2 Step 1 尾部追加约 3 行定义：
1. `provider` 仅在 `cross_review_models` 中某一项**不含 provider 前缀**时作为该项的 fallback；
2. `model` 若已含 provider 前缀，则忽略 `provider` 字段；
3. `phase-discipline-findings-to-memories` 不使用 `provider`，继续走 prompt 路径。
并在 `preferences.test.ts` 加一条 fallback 解析用例。

#### B.5【Semi-blocking】Spec Δ-K1 未描述 `auto/phases.ts` + `auto/loop-deps.ts` 的配套改动

**证据**：workspace 的 PR-3a 实现明显**不止** spec v7.1 Δ-K1 里点到的 `auto-dispatch.ts` —— 还必须改 `auto/phases.ts::runDispatch`（新增 `runPreDispatchHooks` 调用 + `advise` 结果分支 + 二次 `resolveDispatch` 传入 `advisedUnit`）和 `auto/loop-deps.ts::LoopDeps.runPreDispatchHooks` 返回类型扩展。这两个是**让 `action: "advise"` 真的端到端生效**的"消费者胶水"。

**影响**：
- Spec v7.1 的 Δ-K1 表格不完整，读者以为 PR-3a 只改 3 个文件（`types.ts` + `auto-dispatch.ts` + `rule-registry.ts`），实际还有两个 `auto/*.ts`。
- Plan 第 73 行 "Do **not** re-open PR-3a files for new kernel semantics (`auto-dispatch.ts`, `auto/phases.ts`, `auto/loop-deps.ts`) unless a compile break proves a missed consumer glue edge" —— 已经把这两个文件纳入 scope 了，好；但 spec 没更新就会和 plan 不同步，未来 PR-3a 的 reviewer 可能漏审 `auto/phases.ts` 的 advise 流程。

**修复**：更新 `specs/phase-discipline-preset.md` v7.1 的 Δ-K1 节，把 `auto/phases.ts::runDispatch` 和 `auto/loop-deps.ts::LoopDeps.runPreDispatchHooks` 加入 "Required kernel changes" 表格。

#### B.6【Semi-blocking】Integration test 的 `initRegistry([] as any)` 过于取巧

**证据**：plan Task 1 Step 5 的 `phase-discipline-integration.test.ts` 直接 `initRegistry([] as any)` 再 `getOrCreateRegistry().evaluatePreDispatch(...)`。但：
- `initRegistry` 在真实源码里有特定签名（经我 grep，`rule-registry.ts` 中 `initRegistry(rules, postUnitHooks?, preDispatchHooks?)` 的多参形式）；
- `evaluatePreDispatch(unitType, unitId, prompt, basePath)` 调用时，如果 `postUnitHooks` / `preDispatchHooks` 为空，测试根本跑不到 `phase-discipline-profile-dispatch` 分支。
- 如果 plan 意图是"让 preferences resolver 自动注入 preset hooks"，那就必须先 `resolvePreDispatchHooks()` 的结果传进 `initRegistry`。

**影响**：测试会误报（要么编译过不去，要么空 hook 列表下从未触发 B-min）。

**修复**：plan 必须写出 `initRegistry(rules, resolvePostUnitHooks(), resolvePreDispatchHooks())` 的完整 wiring；或者提前在 test setup 里显式 `registry.addPreDispatchHook(presetHook)`。

#### B.7【Non-blocking】Observability log 路径 schema 未定义

**证据**：plan Task 3 Step 4 说 reviewer hook 要写 `.phase-discipline/*.json` observability file，但没定：
- 文件名模板（`code-review-{mid}-{sid}-{tid}-{ts}.json`？）
- 字段 schema（primary model / secondary models / latencies / assessment / fallback flag）
- 是否写入 `.gsd/{mid}/{sid}/.phase-discipline/`（plan 引用）还是 `.gsd/.phase-discipline/`（spec 另一处引用）

**修复**：在 `reviewer-hook.ts` 的 JSDoc 或 plan Task 3 Step 4 末尾，列出 observability JSON 的 5–7 个字段及其路径模板。

#### B.8【Non-blocking】`phase-discipline-findings-to-memories` 的写磁盘责任归属

**证据**：首轮评审 3.10 要求 `findings-carry.ts` 禁写磁盘。plan 没吸收。但 P7 的功能是"把 findings promote 到 memories"，真要让 subagent 用 prompt + 工具自行写磁盘，plan 必须：
- 显式说 subagent 将在这一步使用 `edit_file` 写 `.gsd/MEMORIES.md`（或 PR-4 文档地图的目标路径），并说明它能 access 该路径；
- 或者把"写磁盘"推迟到 PR-4 docs-map 落地，PR-3b 只产 prompt，subagent 输出 Markdown 到会话记录而非写盘。

plan 当前默认走第一条但没声明 subagent 权限范围。

**修复**：在 `findings-carry.ts` 的 JSDoc 和 plan Task 2 Step 4 里写死一句"`findings-carry.ts` 本身不写磁盘；写入由 subagent 通过已有工具完成；PR-4 docs-map 落地前，目标路径是 `.gsd/MEMORIES.md`（临时约定）"。

### C. Plan 里值得表扬的二轮发现

- **Pre-flight Step 1 已加 `honour-phase-discipline-advice` 的 grep 门禁**（吸收首轮 3.2），这是最硬的一道门，非常到位。
- **Task 1 Step 1 已加 `cross_review_models.length` 的负例用例**（吸收首轮 3.9）。
- **Task 1 Step 3 已明确禁用 `STATE.json`**（吸收首轮 3.1 的第二选项）。
- **Task 4 Step 3 的 no-go 文案**用来阻止"通用 hook plugin 框架"的绕道，是一条好机制，保留。
- **两阶段 validation（raw → merge → re-validate merged）**的设计能让 preset 注入的异常在 preferences 加载期就被发现，避免 hook-fire 期的随机失败；这条仍是 plan 的核心亮点。

### D. 二轮总体判定

| 维度 | 首轮 | 二轮 | 变化 |
| --- | --- | --- | --- |
| 设计思路合理性 | ✅ | ✅ | 保持 |
| 正确性 | ⚠ | ✅ | B.1 / B.2 / 3.4 / 3.5 已并入 plan 正文；Δ-K1 的真实消费链也已同步到 spec |
| 完整性 | ⚠ | ✅ | B.4 / B.5 / B.7 / B.8 已吸收；B.6 经当前源码复核后不再构成 blocker |
| 可直接开工？ | ❌ | ✅ | 当前可按更新后的 plan 进入实现 |

**本轮已并入正文 / spec 的关键修订**：

1. plan 头部快照已改为“仅供参考；以 Pre-flight Step 1 实际输出为准”。
2. Task 3 Step 3 已明确命名 `phase-discipline-profile-dispatch` 分支必须先于通用 `hook.action === "advise"` 分支执行。
3. Task 3 Step 4 / Step 5 已锁定 bridge → artifact/retry/cycle 的责任边界，不允许绕开现有 registry 生命周期。
4. `profile-map.ts` 已要求在文件头说明 P3 复用 P2 的 `plan-slice`，靠 state / artifact readiness 判别而非新 unit type。
5. `phase-discipline/` 预算已上调至 `~380-560`。
6. spec v7.1 的 Δ-K1 已补齐 `auto/phases.ts` 与 `auto/loop-deps.ts` 的真实消费链说明。

**已吸收的非阻塞澄清**：

7. `provider` 语义已在 Task 2 中定义为未带前缀 reviewer model 的 fallback qualifier。
8. integration test 断言已加强到 `advisedUnitType`，用于证明 advice 不是空转。
9. observability JSON 的最小路径 / 字段要求已在 Task 3 Step 4 写明。
10. `findings-carry.ts` 已明确为 prompt-only，不直接写盘。

### E. 推荐落地顺序

1. 已完成：plan 头部快照、Task 3 分支顺序、bridge / cycle 责任边界、P2/P3 说明、预算上调。
2. 已完成：spec v7.1 Δ-K1 已同步 `auto/phases.ts` / `auto/loop-deps.ts` 的真实消费链。
3. 后续如再收口，仅需在实现前按 Pre-flight / Task 1 复跑一次自检，确认 branch tip 与文档假设一致。
4. 当前状态为 **"Ready to implement on the updated plan"**。

评审人：Claude Opus 4.7 (本次会话)  
参照基线：`specs/phase-discipline-preset.md` v7.1、`specs/README.md`、本 workspace 的真实 `git diff`（含尚未 commit 的 PR-3a 改动）。

