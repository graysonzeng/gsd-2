# PR-2 Shared-Harness Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the reusable reviewer/subagent plumbing from `composed-lite/` into a new `shared-harness/` module, then rewrite `composed-lite` to consume that shared surface without changing observable runtime behaviour.

**Architecture:** This PR lands from `feat/shared-harness-extraction`, which must branch from `feat/composed-lite-runtime-owned` because the source files do not exist on `main`. `review-harness.ts` becomes a thin `composed-lite` adapter around a state-agnostic `runReview(...)` core, `review-model-picker.ts` / `subagent-spawn.ts` / `subagent-terminal.ts` become `shared-harness`-owned source files, and `composed-lite` keeps compatibility shims that re-export the new shared surface. `shared-harness/` may add a non-exported internal `resolve-bin.ts` helper, but its exported surface remains the 5 files named in the spec. A structural boundary test enforces that `shared-harness/`* never imports `composed-lite/` or `phase-discipline/`.

**Tech Stack:** TypeScript, `src/resources/extensions/gsd/composed-lite/`*, new `src/resources/extensions/gsd/shared-harness/`*, Node test runner, branch-local forward-port from `feat/composed-lite-runtime-owned`.

## Current Status (2026-04-23)

- On the current branch `feat/phase-discipline-preset-v1`, only the provider-side Stage B subset is executable and safe to land.
- The current workspace already contains `shared-harness/*` plus its 4 direct tests, but it still does **not** contain `src/resources/extensions/gsd/composed-lite/` or the composed-lite consumer regressions required for canonical PR-2.
- Therefore the only accurate current-branch claim is “validated `shared-harness` Stage B subset landed/ready”, **not** “canonical PR-2 completed”.
- Canonical PR-2 remains the full extraction + composed-lite adapter/shim proof on `feat/shared-harness-extraction` from `feat/composed-lite-runtime-owned`.

### Accepted but deferred follow-ups for the current branch

These review items are technically reasonable, but they are **not** required to safely land the current Stage B subset on `feat/phase-discipline-preset-v1`:

- `GSD_COMPOSED_LITE_*` naming debt inside `shared-harness/*` stays unchanged in this round so extracted provider behaviour remains compatible with the source runtime.
- Boundary-test widening from “forbid composed-lite/phase-discipline imports” to a broader sibling-module allowlist model is deferred until a later cleanup PR.
- stdout/stderr buffer aggregation optimization is deferred; current string accumulation is acceptable for the present Stage B scope and verified test surface.
- Canonical PR-2 follow-up on `feat/shared-harness-extraction` should still include composed-lite adapter/shim proof plus any further reviewer-core/runtime regression coverage needed there.

---
## Locked scope

### Branch requirement

This plan is valid **only** on `feat/shared-harness-extraction`, created from `feat/composed-lite-runtime-owned`.

Verified on 2026-04-23 against the current workspace:

- Current branch `feat/phase-discipline-preset-v1` contains **no** `src/resources/extensions/gsd/composed-lite/` tree
- The source files named by this plan exist on `feat/composed-lite-runtime-owned`, not on the current branch
- Therefore this PR is a **no-go in the current workspace branch** even if the plan itself is sound
- Execute PR-2 only in an isolated branch/worktree rooted at `feat/shared-harness-extraction` so the phase-discipline work-in-progress on the current branch is not polluted by composed-lite runtime files

Run first:

```bash
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/shared-harness-extraction" \
  || { echo "must be on feat/shared-harness-extraction"; exit 1; }
git merge-base --is-ancestor feat/composed-lite-runtime-owned HEAD && echo OK
```

Expected:

- First command exits `0`
- Prints `OK`
- Second command exits `0`

If the branch-name check fails, create the branch first:

```bash
git checkout -b feat/shared-harness-extraction feat/composed-lite-runtime-owned
```

If the ancestry check fails, stop. Do **not** attempt PR-2 from `main` or from an unrelated feature branch.

### Files that must change

- Create: `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
- Create: `src/resources/extensions/gsd/shared-harness/review-model-picker.ts`
- Create: `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
- Create: `src/resources/extensions/gsd/shared-harness/subagent-terminal.ts`
- Create: `src/resources/extensions/gsd/shared-harness/resolve-bin.ts` *(internal helper, not barrel-exported)*
- Create: `src/resources/extensions/gsd/shared-harness/index.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/review-model-picker.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/subagent-terminal.ts`
- Modify: `src/resources/extensions/gsd/tests/review-model-picker.test.ts`
- Modify: `src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`
- Modify: `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`
- Create: `src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts`
- Create: `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`
- Create: `src/resources/extensions/gsd/tests/shared-harness-review-model-picker.test.ts`
- Create: `src/resources/extensions/gsd/tests/shared-harness-subagent-spawn.test.ts`

### Files that must stay unchanged

- Do **not** touch `phase-discipline/`
- Do **not** touch `main`-only kernel files (`types.ts`, `rule-registry.ts`, `auto-dispatch.ts`)
- Do **not** change composed-lite phase logic outside import rewiring / adapter usage

### Reality correction versus the spec

The spec text says “ESLint `no-restricted-paths` enforces the boundary”. Current repo state on both `main` and `feat/composed-lite-runtime-owned` has **no root ESLint config or lint script** to land that rule into. Therefore this plan uses a **structural source test** as the landing guard:

- `shared-harness/`* may import only siblings / neutral shared helpers
- `shared-harness/`* may not import `../composed-lite/` or `../phase-discipline/`

This keeps the architectural guarantee without inventing missing lint infrastructure.

## Recommended delivery strategy for the current workspace

This section is **prescriptive** when the consumer work continues on `feat/phase-discipline-preset-v1`. It does **not** replace Task 1–Task 4 below; it defines **where** those tasks run and **which validated outputs** may be promoted back to the current branch afterward.

### Stage A — implement canonical PR-2 in isolation

Authoritative execution branch:

- `feat/shared-harness-extraction`
- Base: `feat/composed-lite-runtime-owned`
- Scope: run the full Task 1–Task 4 plan below without modification

Recommended workspace setup:

```bash
git worktree add ../gsd-2-shared-harness feat/composed-lite-runtime-owned
git -C ../gsd-2-shared-harness checkout -b feat/shared-harness-extraction
git -C ../gsd-2-shared-harness branch --show-current
```

Expected:

- Last command prints `feat/shared-harness-extraction`
- The isolated worktree contains `src/resources/extensions/gsd/composed-lite/`*
- The current workspace remains on `feat/phase-discipline-preset-v1`

### Stage B — promote only validated shared-harness outputs back to the current branch

After Stage A passes all verification, the current branch may import **only** the shared surface that PR-3b will later consume.

Files allowed to carry forward into `feat/phase-discipline-preset-v1`:

- `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
- `src/resources/extensions/gsd/shared-harness/review-model-picker.ts`
- `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
- `src/resources/extensions/gsd/shared-harness/subagent-terminal.ts`
- `src/resources/extensions/gsd/shared-harness/resolve-bin.ts`
- `src/resources/extensions/gsd/shared-harness/index.ts`
- `src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts`
- `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`
- `src/resources/extensions/gsd/tests/shared-harness-review-model-picker.test.ts`
- `src/resources/extensions/gsd/tests/shared-harness-subagent-spawn.test.ts`

Files explicitly forbidden from carry-forward into the current branch:

- `src/resources/extensions/gsd/composed-lite/`*
- `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`
- `src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`
- Any adapter/shim commit whose only purpose is keeping composed-lite runtime behaviour byte-identical

Recommended promotion command set from the current workspace:

```bash
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/phase-discipline-preset-v1"
git checkout feat/shared-harness-extraction -- \
  src/resources/extensions/gsd/shared-harness/reviewer-core.ts \
  src/resources/extensions/gsd/shared-harness/review-model-picker.ts \
  src/resources/extensions/gsd/shared-harness/subagent-spawn.ts \
  src/resources/extensions/gsd/shared-harness/subagent-terminal.ts \
  src/resources/extensions/gsd/shared-harness/resolve-bin.ts \
  src/resources/extensions/gsd/shared-harness/index.ts \
  src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts \
  src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts \
  src/resources/extensions/gsd/tests/shared-harness-review-model-picker.test.ts \
  src/resources/extensions/gsd/tests/shared-harness-subagent-spawn.test.ts
```

Expected:

- First command exits `0`
- No file under `src/resources/extensions/gsd/composed-lite/` is introduced into the current branch
- `git status --short` shows only the shared-harness files above as added or modified

### Stage C — verify the promoted package on the current branch

Run only the checks that should remain valid without composed-lite runtime sources:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts \
  src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts \
  src/resources/extensions/gsd/tests/shared-harness-review-model-picker.test.ts \
  src/resources/extensions/gsd/tests/shared-harness-subagent-spawn.test.ts
npm run typecheck:extensions
```

Expected:

- Shared-harness boundary test passes
- Shared reviewer-core contract test passes
- Shared review-model-picker test passes
- Shared subagent-spawn test passes
- Extension typecheck exits `0`

### Stage D — handoff from PR-2 to PR-3b on the current branch

Once Stage C passes, the current branch may treat `shared-harness/*` as a stable dependency surface for later `phase-discipline/` consumer work.

The current branch still must **not** claim that full PR-2 has landed there. The accurate statement is:

- Canonical PR-2 was implemented and verified on `feat/shared-harness-extraction`
- The current branch imports only the validated `shared-harness` public surface needed by PR-3b
- `composed-lite` adapter/shim work remains isolated to the PR-2 branch history

## Pre-flight checks

- **Step 1: Verify the source files exist on the feat branch**

Run:

```bash
git ls-tree -r --name-only HEAD src/resources/extensions/gsd/composed-lite | sed -n '1,120p'
```

Then verify the local test harness:

```bash
test -f src/resources/extensions/gsd/tests/resolve-ts.mjs
node --version
```

Expected:

- Output includes `review-harness.ts`
- Output includes `review-model-picker.ts`
- Output includes `subagent-spawn.ts`
- Output includes `subagent-terminal.ts`
- Output includes `resolve-bin.ts`
- `src/resources/extensions/gsd/tests/resolve-ts.mjs` exists
- Node major version is `>= 20`
- **Step 2: Run the existing composed-lite regression anchors**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/review-model-picker.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts
```

Expected:

- Exit code `0`
- This establishes the pre-extraction behaviour baseline
- **Step 3: Run extension typecheck as a baseline**

Run:

```bash
npm run typecheck:extensions
```

Expected:

- Exit code `0`
- This establishes the pre-extraction type baseline before files move across module boundaries
- `tsconfig.extensions.json` already includes the full `src/resources/extensions` tree, so a new `shared-harness/` directory is covered without a tsconfig edit

### Task 1: Add failing boundary and shared-core tests

**Files:**

- Create: `src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts`
- Create: `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`
- Read for patterns: `src/resources/extensions/gsd/tests/review-model-picker.test.ts`
- Read for patterns: `src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`
- **Step 1: Write the boundary guard test**

Create `src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "shared-harness");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts"));

test("shared-harness files do not import composed-lite or phase-discipline", () => {
  for (const name of FILES) {
    const source = readFileSync(join(DIR, name), "utf-8");
    assert.doesNotMatch(source, /from\s+["']\.\.\/composed-lite\//, `${name} must not import composed-lite`);
    assert.doesNotMatch(source, /from\s+["']\.\.\/phase-discipline\//, `${name} must not import phase-discipline`);
    assert.doesNotMatch(source, /import\(\s*["']\.\.\/composed-lite\//, `${name} must not dynamically import composed-lite`);
    assert.doesNotMatch(source, /import\(\s*["']\.\.\/phase-discipline\//, `${name} must not dynamically import phase-discipline`);
  }
});
```

- **Step 2: Write the reviewer-core contract test**

Create `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts` as a source-anchored contract test:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReviewerOutput } from "../shared-harness/reviewer-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "shared-harness", "reviewer-core.ts"), "utf-8");

 test("reviewer-core exports ReviewResult, parseReviewerOutput, and runReview", () => {
   assert.match(source, /export interface ReviewResult/);
   assert.match(source, /export function parseReviewerOutput\(/);
   assert.match(source, /export async function runReview\(/);
 });
 
 test("parseReviewerOutput accepts fenced YAML verdicts", () => {
  const parsed = parseReviewerOutput([
    "```yaml",
    "overall_assessment: issues",
    "critical:",
    "  - id: C1",
    "    target: src/foo.ts",
    "    rationale: Needs a fix",
    "important: []",
    "minor: []",
    "rationale: reviewer summary",
    "```",
  ].join("\n"));
  assert.ok(parsed);
  assert.equal(parsed?.overall_assessment, "issues");
  assert.equal(parsed?.critical.length, 1);
 });

 test("reviewer-core keeps reviewer subprocess restricted to --tools read", () => {
   assert.match(source, /"--tools",\s*"read"/);
 });
```

- **Step 3: Run the new tests and confirm they fail**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts
```

Expected:

- Exit code non-zero
- Failures mention missing `shared-harness/` files
- **Step 4: Commit the failing tests**

```bash
git add src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts
git commit -m "test: add failing shared-harness extraction coverage"
```

### Task 2: Create the new `shared-harness/` module

**Files:**

- Create: `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
- Create: `src/resources/extensions/gsd/shared-harness/review-model-picker.ts`
- Create: `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
- Create: `src/resources/extensions/gsd/shared-harness/subagent-terminal.ts`
- Create: `src/resources/extensions/gsd/shared-harness/resolve-bin.ts` *(internal helper, not barrel-exported)*
- Create: `src/resources/extensions/gsd/shared-harness/index.ts`
- Source references (read-only):
  - `feat/composed-lite-runtime-owned:src/resources/extensions/gsd/composed-lite/review-harness.ts`
  - `feat/composed-lite-runtime-owned:src/resources/extensions/gsd/composed-lite/review-model-picker.ts`
  - `feat/composed-lite-runtime-owned:src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
  - `feat/composed-lite-runtime-owned:src/resources/extensions/gsd/composed-lite/subagent-terminal.ts`
  - `feat/composed-lite-runtime-owned:src/resources/extensions/gsd/composed-lite/resolve-bin.ts`
- **Step 1: Extract `review-model-picker.ts` verbatim**

Copy the current feat-branch file into:

`src/resources/extensions/gsd/shared-harness/review-model-picker.ts`

Keep these exports unchanged:

```ts
export class ReviewerUnavailableError extends Error {}
export interface PickReviewerInput { /* unchanged */ }
export function pickReviewerModel(input: PickReviewerInput): PickerResult
export { inferProvider, defaultReviewerModel }
```

Non-goal for PR-2:

- Preserve the current single-reviewer `pickReviewerModel(...)` API exactly as extracted from `composed-lite`
- Do **not** introduce a new `pickCrossReviewers(...)` / multi-reviewer selection API in this PR
- If PR-3b needs reviewer fan-out, it should compose the extracted picker at the caller layer or add a later additive helper without changing PR-2's pure-refactor scope
- **Step 2: Move `subagent-terminal.ts`, `resolve-bin.ts`, and `subagent-spawn.ts` into shared-harness-owned sources**

Create `shared-harness/subagent-terminal.ts` and `shared-harness/subagent-spawn.ts` from the current feat-branch implementations, and add `shared-harness/resolve-bin.ts` as an internal helper used only by `subagent-spawn.ts`.

Requirements:

- `shared-harness/subagent-terminal.ts` keeps the progress metadata fields (`assistantStarted`, `messageUpdateCount`, `toolExecutionCount`)
- `shared-harness/subagent-spawn.ts` keeps timeout-progress annotation and process cleanup behaviour
- `shared-harness/subagent-spawn.ts` imports `./resolve-bin.js` and `./subagent-terminal.js`, not `../composed-lite/*`
- **Do not rename** `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` in PR-2; environment-variable compatibility stays byte-identical in this PR
- **Step 3: Extract `reviewer-core.ts` from `composed-lite/review-harness.ts`**

Create a new file that keeps:

- `ReviewResult`
- strict YAML parse / retry logic
- subprocess restriction to `--tools read`
- temp prompt-file lifecycle + task assembly logic

but removes all direct dependence on `ComposedLiteState`, `ArtifactEnvelope`, `ComposedLiteFuseError`, raw-log naming, and artifact/state mutation.

Use a plain input/output surface shaped like:

```ts
export interface RunReviewInput {
  projectRoot: string;
  modelArg: string;
  systemPrompt: string;
  reviewPrompt: string;
  targetContent: string;
  maxRetries?: number;
}

export interface ReviewAttempt {
  attempt: number;
  rawOutput: string;
  stderrOutput: string;
  exitCode: number;
  terminalResult: SubagentTerminalResult;
  parsed: ReviewResult | null;
}

export interface RunReviewResult {
  review: ReviewResult;
  inputHash: string;
  task: string;
  attempts: ReviewAttempt[];
}

export class ReviewerCoreError extends Error {
  constructor(
    public kind: "subprocess_failure" | "parse_exhausted",
    message: string,
    public attempts: ReviewAttempt[],
  ) {
    super(message);
  }
}
```

Also export `parseReviewerOutput(raw: string): ReviewResult | null` for direct parser regression tests.

Design note for PR-2:

- `reviewer-core` deliberately accepts provider-qualified `modelArg` instead of separate `model` / `provider`
- `reviewer-core` deliberately returns `RunReviewResult` instead of only `ReviewResult` so the caller can own raw-log persistence, audit emission, and failure mapping without leaking composed-lite state semantics across the shared boundary
- Provider / model remain caller-owned metadata for audit and orchestration; if PR-3b later needs a more ergonomic reviewer orchestration surface, add it above `reviewer-core` rather than re-coupling the core to composed-lite-specific policy
- `reviewer-core` computes `inputHash` inline via `createHash("sha256")`; do **not** import `sha256` from `../composed-lite/artifacts.js`
- `buildModelArg(...)` remains composed-lite adapter-owned in PR-2; `runReview(...)` receives an already-formatted `modelArg`
- Temp prompt files stay under `os.tmpdir()` using a per-invocation unique temp dir; do **not** couple prompt-file lifecycle to `.gsd/`
- On failure, `reviewer-core` throws `ReviewerCoreError` carrying every accumulated `attempt`; the caller owns raw-log persistence and semantic remapping to `ComposedLiteFuseError`
- **Step 4: Add the barrel export**

Create `src/resources/extensions/gsd/shared-harness/index.ts`:

```ts
export { runReview, parseReviewerOutput, ReviewerCoreError } from "./reviewer-core.js";
export type { RunReviewInput, RunReviewResult, ReviewAttempt, ReviewResult } from "./reviewer-core.js";
export { pickReviewerModel, ReviewerUnavailableError, inferProvider, defaultReviewerModel } from "./review-model-picker.js";
export type { PickReviewerInput } from "./review-model-picker.js";
export {
  spawnGsdSubagent,
  resolveSubagentTerminalResult,
  trackLiveSubagentProcess,
  cleanupTrackedSubagentProcesses,
} from "./subagent-spawn.js";
export type { SpawnGsdSubagentOptions, SpawnGsdSubagentResult } from "./subagent-spawn.js";
export { parseSubagentTerminalResult } from "./subagent-terminal.js";
export type { SubagentTerminalResult } from "./subagent-terminal.js";
```

Use explicit named exports here instead of `export *` so future shared-harness growth cannot silently shadow or drop a type/value export.

- **Step 5: Run the new shared-harness tests**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts src/resources/extensions/gsd/tests/review-model-picker.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts
```

Expected:

- Exit code `0`
- Boundary guard passes
- Existing picker / subagent tests still pass
- **Step 6: Commit the shared module extraction**

```bash
git add src/resources/extensions/gsd/shared-harness src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts
git commit -m "refactor: extract shared harness primitives"
```

### Task 3: Rewrite `composed-lite` as a consumer

**Files:**

- Modify: `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/review-model-picker.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
- Modify: `src/resources/extensions/gsd/composed-lite/subagent-terminal.ts`
- Modify: `src/resources/extensions/gsd/tests/review-model-picker.test.ts`
- Modify: `src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`
- Modify: `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`
- **Step 1: Convert legacy composed-lite modules into compatibility shims**

Replace implementation bodies with re-exports:

```ts
export * from "../shared-harness/review-model-picker.js";
```

and likewise for:

```ts
export * from "../shared-harness/subagent-spawn.js";
export * from "../shared-harness/subagent-terminal.js";
```

Keep the legacy file paths alive so branch-local callers do not break.

- **Step 2: Make `composed-lite/review-harness.ts` a thin adapter**

Refactor it to:

- gather `state`, `req`, `phase`, `artifactKind`, `reviewPrompt`, `targetContent`
- derive `providerReadyCheckAvailable` / `providerReady`
- build `modelArg` with the existing `buildModelArg(...)` helper
- call `runReview(...)` from `../shared-harness/reviewer-core.js`
- on success, persist returned `attempts` using the existing `buildRunScopedRawLogFileName(...)` naming scheme before writing the review artifact
- on `ReviewerCoreError`, persist `err.attempts`, map `subprocess_failure` to `ComposedLiteFuseError("review_unavailable", ...)`, map `parse_exhausted` to `ComposedLiteFuseError("review_parse_exhausted", ...)`, then rethrow
- write the review artifact and update `state.phases[phase].artifact_envelope`
- keep artifact naming / audit payload schema byte-identical

The only composed-lite-specific logic that should remain in this file is the adapter glue from composed-lite state into the new generic `runReview(...)` contract plus the existing composed-lite-owned audit/state/artifact side effects.

For implementation discipline, treat the pre-extraction `review-harness.ts` body as the source-of-truth checklist rather than relying on the short bullet list above. The adapter rewrite is acceptable only if it preserves all existing side effects in the same semantic order:

- `reviewer_preflight` audit emission
- `subagent_call` audit emission
- raw-log persistence via `buildRunScopedRawLogFileName(...)`
- `subagent_result` audit emission for every attempt
- success-path `reviewer_verdict` audit emission
- `writeArtifact(...)` + `state.phases[phase].artifact_envelope = envelope`
- temp prompt directory cleanup in both success and failure paths

- **Step 3: Update the composed-lite runtime regression tests**

 In `src/resources/extensions/gsd/tests/review-model-picker.test.ts`, switch the primary import surface to `../shared-harness/review-model-picker.js` and keep one smoke assertion that the legacy `../composed-lite/review-model-picker.js` shim still exposes the same named API.

In `src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`, keep every existing behaviour test intact, add a top-level import from `../shared-harness/subagent-spawn.js`, and add one explicit smoke assertion `assert.equal(sharedSpawnGsdSubagent, spawnGsdSubagent)` so PR-2 proves both the new source-of-truth and the legacy shim path without weakening the behavioural checks.

 In `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`, keep the structural assertions that matter after extraction:

- reviewer subprocess still uses `--tools read`
- reviewer system prompt still contains the anti-drift instructions
- audit event names still include `reviewer_preflight`, `subagent_call`, `subagent_result`, and `reviewer_verdict`
- audit payload keys still include `reviewer_model`, `reviewer_provider`, `model_arg`, `max_retries`, `provider_ready_check_available`, `provider_ready`, `appended_system_prompt`, `tool_restriction`, `raw_log_hash`, `raw_log_path`, `parsed_ok`, `assistant_started`, `message_updates`, `tool_uses`, `output_chars`, and `stderr_chars`
- implement the payload-key assertion through a single `REQUIRED_AUDIT_KEYS = [...]` constant so extraction does not silently drop one field
- raw-log naming still uses `buildRunScopedRawLogFileName(...)`
- failure mapping still distinguishes `review_unavailable` from `review_parse_exhausted`

Do **not** keep source-path assertions that hard-code the old internal placement of shared logic inside `composed-lite/review-harness.ts`.

- **Step 4: Run the existing composed-lite regression set**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/review-model-picker.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts
```

Expected:

- Exit code `0`
- No behavioural regressions after the adapter rewrite
- **Step 5: Commit the consumer rewrite**

```bash
git add src/resources/extensions/gsd/composed-lite/review-harness.ts src/resources/extensions/gsd/composed-lite/review-model-picker.ts src/resources/extensions/gsd/composed-lite/subagent-spawn.ts src/resources/extensions/gsd/composed-lite/subagent-terminal.ts src/resources/extensions/gsd/tests/review-model-picker.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts
git commit -m "refactor: make composed-lite consume shared harness"
```

### Task 4: Final verification and branch-safety gate

**Files:**

- Verify only: `src/resources/extensions/gsd/shared-harness/`*
- Verify only: `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- Verify only: `src/resources/extensions/gsd/composed-lite/review-model-picker.ts`
- Verify only: selected test files above
- **Step 1: Run the full focused validation set**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts src/resources/extensions/gsd/tests/review-model-picker.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts && npm run typecheck:extensions && npm run test:unit
```

Expected:

- All tests pass
- Typecheck exits `0`
- `npm run test:unit` passes, giving a wider regression net than the focused suite alone
- **Step 2: Verify shared-harness stays dependency-clean**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/shared-harness-boundary.test.ts
```

Expected:

- Exit code `0`
- No `../composed-lite/` or `../phase-discipline/` import is present in `shared-harness/*`
- **Step 3: Confirm the implementation commits already capture the full change set**

```bash
git diff --exit-code
git diff --cached --exit-code
```

Expected:

 - Exit code `0`
 - No extra implementation diff remains after the Task 1 / Task 2 / Task 3 commits

 ## Review focus

 Reviewers should explicitly verify the following before approving execution:

 - **Branch discipline** — the canonical implementation branch is `feat/shared-harness-extraction` from `feat/composed-lite-runtime-owned`; the current branch is a consumer-only carry-forward target
- **Carry-forward boundary** — only `shared-harness/*` and its direct tests may be promoted back to `feat/phase-discipline-preset-v1`; no `composed-lite/` runtime file may be imported there
- **Shared boundary purity** — `shared-harness/*` must not import `../composed-lite/` or `../phase-discipline/`, and must keep `modelArg` / artifact / audit ownership outside the shared core
- **Adapter ownership** — canonical PR-2 keeps composed-lite-specific audit, raw-log naming, artifact writing, and fuse-error mapping inside `composed-lite/review-harness.ts`
- **Current-branch claim** — after carry-forward, the correct claim is “validated shared-harness surface imported”, not “full PR-2 completed on the current branch”
 
 ## Self-review
 
 ### Spec coverage

- Extracts the 5-file `shared-harness/` surface named in `phase-discipline-preset.md` §3.4 / §9 PR-2
- Uses a private `shared-harness/resolve-bin.ts` helper without expanding the exported surface beyond the spec's 5 files
- Keeps composed-lite behaviour byte-identical by converting it into a consumer + compatibility-shim layer
- Preserves the verified reviewer restriction `--tools read` already present on `feat/composed-lite-runtime-owned`
- Keeps composed-lite-owned audit/state/artifact semantics in the adapter so `shared-harness` stays phase-discipline-safe
- Replaces unavailable ESLint infra with an equivalent structural boundary test

### Placeholder scan

- No `TBD`
- No `TODO`
- No ambiguous “move the file somehow” steps
- No hidden dependency on `main`

### Type consistency

- `runReview(...)`
- `ReviewResult`
- `RunReviewResult`
- `ReviewAttempt`
- `pickReviewerModel(...)`
- `spawnGsdSubagent(...)`
- `parseSubagentTerminalResult(...)`

Plan complete and saved to `docs/superpowers/plans/2026-04-23-pr-2-shared-harness-extraction.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

**Note:** The plan above already incorporates the accepted blocker / high-priority corrections from the review sections below. Treat those sections as audit trail, not as the current task list.

## Code Review (2026-04-23, against `feat/composed-lite-runtime-owned`) — Resolved

> Status: Blockers B1–B5 and high-priority gaps H1–H3 have been integrated into the plan body above. This section is retained for audit trail.

Reviewer context: 对照 `phase-discipline-preset.md` v7.1 §3.4/§9、`specs/README.md` PR 依赖图、以及 `feat/composed-lite-runtime-owned` 分支上 `review-harness.ts`(369 行)、`review-model-picker.ts`(231 行)、`subagent-spawn.ts`(211 行)、`subagent-terminal.ts`(113 行) 的实际源码 + 现有回归测试（`composed-lite-runtime-regression.test.ts`、`composed-lite-subagent-spawn.test.ts`、`review-model-picker.test.ts`）逐条核对。

总体评价：**方向正确，但在"可直接执行"这一标准上仍有 5 处 blocker 与 3 处高优先级缺口需要修订**。整体架构思路（抽 5 文件成 `shared-harness/`、composed-lite 降级为 adapter/shim、用结构测代替缺失的 ESLint）与 spec §3.4 一致；但多数缺陷出现在"抽出细节"层面：被跨模块依赖的副产物没有被枚举、`RunReviewInput` 接口欠规格，以及测试自身存在自相矛盾。

### 🔴 Blockers（执行前必须修）

1. **边界测试与 re-export shim 直接矛盾（Task 1 Step 1 vs Task 2 Step 2）**
  Task 1 Step 1 对 5 个文件（含 `subagent-spawn.ts`、`subagent-terminal.ts`）统一断言：
   但 Task 2 Step 2 要求 `shared-harness/subagent-spawn.ts` 的内容就是：
   两者直接冲突，测试必然失败。修复方向二选一（推荐前者，方向与 spec §3.4 "shared-harness 是来源" 一致）：
  - **(a) 实际迁移** `subagent-spawn.ts` + `subagent-terminal.ts` 至 `shared-harness/`，`composed-lite/` 侧改为 `export * from "../shared-harness/…"`（与 Task 3 Step 1 对 picker 的处理一致）。
  - **(b) 放宽边界测试**，对这两个桥接文件白名单化；但这样与 spec §3.4 "never from `../composed-lite/`" 不一致。
2. `**subagent-spawn.ts` 隐含依赖 `./resolve-bin.js`，计划未提及**
  `feat` 分支上 `subagent-spawn.ts` 第 4 行：
   `resolve-bin.ts` 目前仅存在于 `composed-lite/`。如果采用 Blocker 1 的方案 (a)，`resolve-bin.ts` 也必须迁入 `shared-harness/`（它本身是无状态、通用的 CLI 解析工具），**"必须变更的文件"清单要从 5+5 增加到至少 6 个 shared-harness 文件**。计划目前的 `ls-tree` 预检步骤也未列出该文件。
3. `**RunReviewInput` 接口严重欠规格**
  比对现有 `runReview` 真实消费（review-harness.ts L140–L363）：

  | 现有依赖                                            | 计划 `RunReviewInput` 是否覆盖                                                                                     |
  | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `state.run_id`                                  | ❌ 未列                                                                                                         |
  | `state.phases[phase].attempt`                   | ❌ 未列（参与 raw-log 文件名、envelope）                                                                                |
  | `state.phases[phase].revision_round`            | ❌ 未列（envelope 必填）                                                                                            |
  | `state.admission.admission_hash`                | ❌ 未列（envelope 必填）                                                                                            |
  | `phase: PhaseNumber`                            | ❌ 未列（审计事件/raw-log 名/envelope 均用）                                                                             |
  | `req.ctx.modelRegistry.isProviderRequestReady`  | 🟡 只把结果 (`providerReady`) 传入，却让 adapter 自己做 resolve，重复了 `resolveReviewerProviderReady` 的逻辑分支，可接受             |
  | `buildModelArg(model, provider)`                | ❌ 未说明该函数归属何方（composed-lite 侧还是迁入 shared-harness）                                                             |
  | `ComposedLiteFuseError` 抛出                      | ❌ 未说明替代方案（shared-harness 不能引用 composed-lite 类型）                                                              |
  | `RAW_LOGS_DIR` + `buildRunScopedRawLogFileName` | ❌ 计划签名写成 `(args) => string`，实际返回对象且其 `output_hash`/`producer_id` 被回写 `state.phases[phase].artifact_envelope` |
  | `writeArtifact` 返回 `ArtifactEnvelope` 对象        | ❌ 计划签名写成 `(args) => string`，实际返回对象且其 `output_hash`/`producer_id` 被回写 `state.phases[phase].artifact_envelope` |
  | `sha256(task)` → `inputHash`                    | ❌ 未说明（目前来自 composed-lite/artifacts.ts）                                                                       |

   **修复**：把 `RunReviewInput` 扩展为枚举式契约（列出 `runId`/`phase`/`attempt`/`revisionRound`/`admissionHash`/`prevPhaseOutputHash`/`buildModelArg` 回调/`throwReviewUnavailable` 回调/`sha256` 回调/`writeRawLog` 回调/`writeArtifact` 返回 envelope 等），或把 `sha256`/`RAW_LOGS_DIR`/`buildRunScopedRawLogFileName`/`buildModelArg` 也迁入 shared-harness（通用 util）。
4. `**Artifact envelope 返回流失配**
  计划签名：
   真实用法（review-harness.ts L336–L358）：
   **修复**：要么 reviewer-core 返回 `{ review: ReviewResult; envelope: { output_hash, producer_id, … } }`，要么在输入里增加 `onArtifactWritten(envelope)` 回调，让 adapter 做 state 回写。当前签名直接丢掉了 envelope 字段，状态机无法更新。
5. `**边界测试定位路径使用 `process.cwd()` 而非 `import.meta.url`**
  ```ts
   const DIR = join(process.cwd(), "src/resources/extensions/gsd/shared-harness");
  ```
   与仓库现有测试约定（`composed-lite-runtime-regression.test.ts` L10 采用 `dirname(fileURLToPath(import.meta.url))`）不一致。一旦从 `dist-test/` 或 `packages/` 子目录触发，将读到错误路径或 ENOENT。**修复**：改用 `__dirname` 方案，与其余扩展测试对齐。

### 🟠 高优先级缺口

1. `**reviewer-core` 内部的通用工具归属尚未锁定**
  现有实现依赖 `composed-lite/artifacts.ts` 的 `sha256(task)` 来产出 `inputHash`，依赖 `composed-lite/model-arg.ts` 的 `buildModelArg`。plan Task 2 Step 3 把 `modelArg: string` 设为**调用方传入**（留在 composed-lite adapter），但 `RunReviewResult.inputHash` 的计算方归属没有显式说明。
  - 若 reviewer-core 从 `composed-lite/artifacts.ts` 导入 `sha256`，会直接违反 `shared-harness-boundary.test.ts` 的静态约束。
  - 若 reviewer-core 内联 `crypto.createHash('sha256')`，则需要在 Task 2 Step 3 的 Design note 里写清楚。
  - 若计划让 adapter 预先计算 `inputHash` 传进来，`RunReviewInput` 必须新增该字段。
  **修复建议**：在 Task 2 Step 3 末尾追加一条 bullet：
    > - `reviewer-core` 内联 `crypto.createHash('sha256')` 计算 `inputHash`，**不**从 `composed-lite/artifacts.ts` 导入 `sha256`；`buildModelArg` 留在 composed-lite adapter 侧，PR-3b 如需复用应在 shared-harness 新增独立 `model-arg.ts`（PR-2 不做）。
2. `**runReview` 的错误处理契约未在对外接口层声明**
  原 `review-harness.ts` 在两类失败分支抛 `ComposedLiteFuseError`：终局子进程失败 → `review_unavailable`；`maxRetries` 内 parse 全失败 → `review_parse_exhausted`。plan L364 说 adapter 负责 "map failures to `ComposedLiteFuseError`"，但没定义 reviewer-core 对外抛什么。实现者可能：
  - 抛 plain `Error`，adapter 用 message 子串匹配（脆弱、回归不稳）。
  - 每类都单独定义一个 class，adapter 三重 `instanceof`（冗余）。
  - 也可能不抛、返回 `{ review: null }` —— 但 `RunReviewResult.review: ReviewResult` 不是 optional，会逼出另一种 discriminated union 改签名。
  **修复建议**：在 Task 2 Step 3 显式约定：
    > - `reviewer-core` 对外导出 `export class ReviewerCoreError extends Error { constructor(public kind: "subprocess_failure" \| "parse_exhausted", message: string, public attempts: ReviewAttempt[]) }`；adapter 通过 `err.kind` 与 `err.attempts` 做精确映射，无需字符串匹配。
    > 附带把上一条 attempts 随错一起抛出，顺便解决下面中等风险 3。
3. `**shared-harness-reviewer-core.test.ts` 缺正向 parse 测试**
  当前三条测试全部是源码 regex（`assert.match(source, …)`），任何人可在 comment 里写 `overall_assessment` 就能使其通过。建议 Task 1 Step 2 补充"parseReviewerOutput accepts fenced YAML verdicts"端到端用例：
   ```ts
   test("parseReviewerOutput accepts fenced YAML verdicts", () => {
     const parsed = parseReviewerOutput([
       "```yaml",
       "overall_assessment: issues",
       "critical:",
       "  - id: C1",
       "    target: src/foo.ts",
       "    rationale: Needs a fix",
       "important: []",
       "minor: []",
       "rationale: reviewer summary",
       "```",
     ].join("\n"));
     assert.ok(parsed);
     assert.equal(parsed?.overall_assessment, "issues");
     assert.equal(parsed?.critical.length, 1);
   });
   ```
   这样才能真正捕获 YAML/fence 解析回归。

### 🟡 中等风险 / 建议

1. `**subagent-spawn.ts` 隐含依赖 `./resolve-bin.js`，计划未提及**
  `feat` 分支上 `subagent-spawn.ts` 第 4 行：
   `resolve-bin.ts` 目前仅存在于 `composed-lite/`。如果采用 Blocker 1 的方案 (a)，`resolve-bin.ts` 也必须迁入 `shared-harness/`（它本身是无状态、通用的 CLI 解析工具），**"必须变更的文件"清单要从 5+5 增加到至少 6 个 shared-harness 文件**。计划目前的 `ls-tree` 预检步骤也未列出该文件。
2. `**composed-lite-subagent-spawn.test.ts` 的修改意图未说明**
  计划把它列入 "Files that must change"，但后续三个 Task 步骤都没描述要改什么。若只是因为 import 路径搬移需要同步（例如增加一条 `shared-harness/subagent-spawn.js` 的导入断言），应直接写明；否则应从改动清单里移除，避免 Task 4 commit 时漏/错 add。
3. `**边界测试定位路径使用 `process.cwd()` 而非 `import.meta.url`**
  ```ts
   const DIR = join(process.cwd(), "src/resources/extensions/gsd/shared-harness");
  ```
   与仓库现有测试约定（`composed-lite-runtime-regression.test.ts` L10 采用 `dirname(fileURLToPath(import.meta.url))`）不一致。一旦从 `dist-test/` 或 `packages/` 子目录触发，将读到错误路径或 ENOENT。**修复**：改用 `__dirname` 方案，与其余扩展测试对齐。

### 🟢 Nits / 观察

1. **环境变量 `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` 的"byte-identical"承诺需要澄清**
  `subagent-spawn.ts` 当前以 `GSD_COMPOSED_LITE_*` 前缀读取超时；一旦文件迁入 `shared-harness/`，是否保留旧前缀、是否新增 `GSD_SHARED_HARNESS_*` 别名、优先级如何，计划未交代。为保证 byte-identical，建议 PR-2 阶段**不改**前缀，仅在计划里显式声明这是 OQ，留给后续 PR 处理。
2. `**providerReadyCheckAvailable` / `providerReady` 语义在迁出后应重新命名**
  目前这两个字段透露 composed-lite 的 `ComposedLiteRunRequest.ctx.modelRegistry.isProviderRequestReady` 细节。shared-harness 应只接收抽象后的 `{ providerReadyCheckAvailable: boolean; providerReady: boolean | null }`，禁止在 core 内部再访问 `req.ctx.*`。计划目前确实这样做了（只传 boolean），这点正确，保留表扬。
3. `**temp prompt-file lifecycle` 的语义未约束**
  原实现写到 `os.tmpdir()`，与 phase-discipline 未来计划的 `.gsd/{mid}/{sid}/.phase-discipline/` 观测目录无关。Task 2 Step 3 Design note 现已补上这一点。

### 结论与建议

- **方案核心思路正确**：抽 reviewer/subagent 通用件 → shared-harness，composed-lite 退为 adapter，用结构测代替缺失的 ESLint，这条路径与 spec 一致、与 PR-3b 解耦合理。
- **本轮 follow-up 修订**：✅ 已把 `inputHash` 归属、`ReviewerCoreError` 契约、adapter raw-log 落盘责任、分支守卫、工具链探针、历史 review 状态标注并入 plan 正文。
- **开工就绪度**：🟢 可以进入 subagent-driven 实施。当前剩余项以实现期注意事项为主，不再构成开工前 blocker。
- **已并入的最小修订清单**（按优先级）：
  1. Task 2 Step 3 Design note 锁定 `inputHash` 与 `buildModelArg` 的边界归属。
  2. Task 2 Step 3 + Task 3 Step 2 锁定 `ReviewerCoreError { kind, attempts }` 与 adapter 落 raw-log / remap 责任。
  3. Branch requirement + Pre-flight 显式覆盖目标分支与 `resolve-ts.mjs` / Node runtime 探针。
  4. Task 3 Step 3 用 `REQUIRED_AUDIT_KEYS = [...]` 常量清单约束 17 个 payload 键。
  5. 历史 review 章节显式标记 resolved，降低读者误判成本。

完成以上修订后，此计划已可直接投入 subagent-driven 实施。

---

## Pre-Implementation Re-Review (2026-04-23, Cursor Claude Opus 4.7)

> **Scope**：复核 plan 正文在整合上一轮 "Code Review (2026-04-23)" 之后是否仍存在阻塞/高优先级缺口，并决定是否可以进入 subagent-driven 开发阶段。
>
> **Ground truth 核查**：
>
> - ✅ `feat/composed-lite-runtime-owned` 分支上 5 个源文件（`review-harness.ts`、`review-model-picker.ts`、`subagent-spawn.ts`、`subagent-terminal.ts`、`resolve-bin.ts`）真实存在，`review-harness.ts` 实际行数 369，与 "Locked scope" 的描述一致。
> - ✅ `src/resources/extensions/gsd/tests/resolve-ts.mjs` 测试基础设施在仓库中存在（pre-flight 命令不会因该文件缺失而失败）。
> - ✅ `review-harness.ts` 的实际依赖集为 `{./types, ./artifacts, ./audit-log, ./model-arg, ./subagent-spawn, yaml}`，与 plan 中"adapter 负责 audit/state/artifact"的切分假设吻合。
> - ✅ 上轮评审的 5 个 Blocker 与 3 个高优先级缺口在 plan 正文中均已对应修订：
>   - B1 → Task 2 Step 2 改为**完整迁移**（不再用 `export * from "../composed-lite/…"`）。
>   - B2 → `shared-harness/resolve-bin.ts` 已在 "Files that must change" L38 + Task 2 Step 2 明确纳入。
>   - B3 → `RunReviewInput` 扩展到 `{projectRoot, modelArg, systemPrompt, reviewPrompt, targetContent, maxRetries}`，并新增 `ReviewAttempt[] / RunReviewResult`。
>   - B4 → reviewer-core 不再写 artifact，adapter 自己调 `writeArtifact`，签名冲突自然消解。
>   - B5 → 边界测试改用 `dirname(fileURLToPath(import.meta.url))`（L126）。
>   - H1 → Task 3 Step 3 L375–383 显式列出 4 个 audit 事件名、17 个 payload 键、reviewer prompt 反漂移片段、raw-log 命名、`review_unavailable` / `review_parse_exhausted` 两种失败映射。
>   - H2 → Task 1 Step 2 补充"parseReviewerOutput accepts fenced YAML verdicts"端到端用例。
>   - H3 → Task 3 Step 3 L373 明确 `composed-lite-subagent-spawn.test.ts` 的修改动作。
>   - 中等风险 M1 → Task 4 Step 1 L418 已 `&& npm run test:unit`。
>   - 中等风险 M2 → L249 显式声明 `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS` 前缀 byte-identical。
>   - Follow-up H-new-1 → Task 2 Step 3 Design note 现已锁定：`inputHash` 由 `reviewer-core` 内联 `createHash("sha256")` 计算，`buildModelArg(...)` 继续留在 composed-lite adapter。
>   - Follow-up H-new-2 / M-new-1 → Task 2 Step 3 + Task 3 Step 2 现已锁定：`ReviewerCoreError { kind, attempts }` 作为 shared-harness 错误契约，adapter 负责先落 raw logs 再映射到 `ComposedLiteFuseError`。
>   - Follow-up nit → Branch requirement 现已增加 `feat/shared-harness-extraction` 显式守卫；Pre-flight 现已探针 `resolve-ts.mjs` + `node --version`；历史 review 章节现已标注 resolved。

### 总体判断

- **核心思路正确**：shared-harness = 纯 review 核心（`reviewer-core`）+ 子进程 I/O（`subagent-spawn/terminal`）+ 跨 provider 选择（`review-model-picker`），composed-lite 退化为"audit/state/artifact/raw-log"的 adapter。与 `specs/phase-discipline-preset.md` §3.4 / §9 以及 `specs/README.md` 依赖图一致，也为 PR-3b 的 reviewer-hook 预留了正确的接入面。
- **TDD + 结构性边界测试代替不存在的 ESLint** 是务实退化，符合仓库现有测试约定。
- **分支依赖正确**（从 `feat/composed-lite-runtime-owned` 派生，而非 `main`）。

### 🔴 Blockers（本轮新发现）

*无*。上轮 Blocker 1–5 已全部在 plan 正文中整合。

### 🟠 高优先级缺口（本轮新发现）

*无*。本轮 follow-up 的两处契约留白已整合进 plan 正文：

1. Task 2 Step 3 已明确 `inputHash` 由 `reviewer-core` 内联 `createHash("sha256")` 计算，`buildModelArg(...)` 保持 adapter-owned。
2. Task 2 Step 3 + Task 3 Step 2 已明确 `ReviewerCoreError { kind, attempts }` 契约，adapter 负责先落 raw logs 再映射 `ComposedLiteFuseError`。

### 🟡 中等风险 / 建议（本轮新发现）

1. **raw-log 落盘时序从"立即写"退化为"批量收尾写"**
  原实现每次 subagent 调用返回立即 `writeFileSync(rawLogPath, rawOutput)`，故障诊断下半部分 raw log 仍在盘上。新架构下 reviewer-core 把所有 `attempts` 累积返回，adapter 统一落盘。若 reviewer-core 抛错时**丢掉已累积的 attempts**（上面高优先级 2 的错误对象如果不带 attempts），诊断能力退化。
  **修复建议**：与上条合并——`ReviewerCoreError.attempts` 携带截止错误点的全部 `ReviewAttempt[]`，adapter 的 catch 分支负责把这些 attempts 一次性 `writeFileSync`，保证 raw-log 诊断面不退化。
2. `**providerReadyCheckAvailable` / `providerReady` 语义在迁出后应重新命名**
  目前这两个字段透露 composed-lite 的 `ComposedLiteRunRequest.ctx.modelRegistry.isProviderRequestReady` 细节。shared-harness 应只接收抽象后的 `{ providerReadyCheckAvailable: boolean; providerReady: boolean | null }`，禁止在 core 内部再访问 `req.ctx.*`。计划目前确实这样做了（只传 boolean），这点正确，保留表扬。
3. `**shared-harness/index.ts` 的 `export *` 会泄漏内部类型**
  `ReviewAttempt`、`RunReviewResult.inputHash` 等实现细节被无差别导出，未来 reviewer-core 重构可能造成外部消费者（phase-discipline）的 TS 级 breaking。PR-2 阶段容忍 `export `* 合理（节省时间），但应留下 debt 标记。
4. **Pre-flight 没有探针 `resolve-ts.mjs` 工具链**
  Task 1 Step 3 首次使用 `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs`，若 feat 分支 rebase 期间文件意外消失（过去在 superpowers skills 改动中发生过），Task 1 会红灯但提示不明确。
  **修复建议**：Pre-flight Step 1 追加：
  ```bash
  test -f src/resources/extensions/gsd/tests/resolve-ts.mjs && node --version
  ```
  并期望 Node ≥ 20（`--experimental-strip-types` 在 22.6 正式支持、22.18 稳定）。

### 🟢 Nits / 观察

1. **当前 workspace 不在 PR-2 目标分支**
  实际核查 `git branch --show-current` = `feat/phase-discipline-preset-v1`（PR-3a 分支）。plan 的分支闸 `git merge-base --is-ancestor feat/composed-lite-runtime-owned HEAD` 会通过（因为 feat-branch 是两者的共同祖先），但此时开工会把 PR-2 改动混入 PR-3a 分支。
  **建议**：Pre-flight 最前面加一条显式分支守卫：
  ```bash
  test "$(git rev-parse --abbrev-ref HEAD)" = "feat/shared-harness-extraction" \
    || { echo "must be on feat/shared-harness-extraction"; exit 1; }
  ```
  若未创建此分支，先 `git checkout -b feat/shared-harness-extraction feat/composed-lite-runtime-owned`。
2. `**composed-lite-runtime-regression.test.ts` 的 17 个 payload 键应做成常量清单**
  Task 3 Step 3 把 17 个 audit payload key 写在 prose 里，实施时容易漏敲一两个。建议 Task 3 Step 3 直接给出 `const REQUIRED_KEYS = [...]` 的数组样板，测试 `for (const k of REQUIRED_KEYS) assert(source.includes(\`"${k}"))`。
3. `**temp prompt-file lifecycle` 的语义未约束**
  原实现写到 `os.tmpdir()`，与 phase-discipline 未来计划的 `.gsd/{mid}/{sid}/.phase-discipline/` 观测目录无关，保留 tmpdir 即可。plan Task 2 Step 3 仅写"keeps ... temp prompt-file lifecycle"略模糊——建议补一句"tmp 路径维持 `os.tmpdir()`，不改到 `.gsd/` 子目录"，避免实现者误判为与 observability v1 耦合。
4. **旧版 "Code Review (2026-04-23)" 章节建议标注为已解决**
  当前 plan 底部保留了上轮 review 原文（L460–590）。新读者顺序阅读时可能误判"仍有 Blocker"。建议把标题改为 "Code Review (v1, 2026-04-23) — Resolved"，正文保留作审计追踪，并在章节开头加一行 `> Status: Blockers B1–B5 and high-priority gaps H1–H3 have been integrated into the plan body above. This section is retained for audit trail.`

### 与 spec 的一致性核对

- ✅ `shared-harness/` 导出面（5 文件） + 内部 `resolve-bin.ts` 与 `phase-discipline-preset.md` §3.4 "5 exported modules + internal helpers" 一致。
- ✅ `reviewer-core` 由调用方拼好 `modelArg` 与 prompt，与 §4 的 reviewer fan-out 描述"shared-harness 不感知 composed-lite/phase-discipline 特化"吻合。
- ✅ `composed-lite` 保留 shim 不删除源文件，符合 §12 "capability-parity migration" 对 PR-2 "no surface behaviour change" 的退出门槛。
- ✅ PR-2 不暴露 `pickCrossReviewers(...)`（留给 PR-3b），与 `specs/README.md` "PR-3b 在 PR-1/PR-2/PR-3a 之后开工" 的硬序一致。
- ⚠️ spec §3.4 "environment variable prefix should migrate to `GSD_SHARED_HARNESS_`*" 的长期目标，被 plan 延后到更晚 PR。此决定合理（PR-2 保 byte-identical），但 spec 应该追加一条 OQ 登记。建议在本 plan Task 2 Step 2 下方加一条 "OQ-PR-2-env-var-prefix"，指向 spec 后续修订。

### 结论

- **整体方案与核心思路**：✅ 合理、正确。与 spec 一致、与 PR-3b 解耦干净、与仓库现有测试与分支约定兼容。
- **上轮评审 Blocker 1–5 + H1–H3**：✅ 全部在 plan 正文中整合，已可验证（文件行号一一对应）。
- **本轮 follow-up 修订**：✅ 已把 `inputHash` 归属、`ReviewerCoreError` 契约、adapter raw-log 落盘责任、分支守卫、工具链探针、历史 review 状态标注并入 plan 正文。
- **开工就绪度**：� 可以进入 subagent-driven 实施。当前剩余项以实现期注意事项为主，不再构成开工前 blocker。
- **已并入的最小修订清单**（按优先级）：
  1. Task 2 Step 3 Design note 锁定 `inputHash` 与 `buildModelArg` 的边界归属。
  2. Task 2 Step 3 + Task 3 Step 2 锁定 `ReviewerCoreError { kind, attempts }` 与 adapter 落 raw-log / remap 责任。
  3. Branch requirement + Pre-flight 显式覆盖目标分支与 `resolve-ts.mjs` / Node runtime 探针。
  4. Task 3 Step 3 用 `REQUIRED_AUDIT_KEYS = [...]` 常量清单约束 17 个 payload 键。
  5. 历史 review 章节显式标记 resolved，降低读者误判成本。

完成以上修订后，此计划已可直接投入 subagent-driven 实施。