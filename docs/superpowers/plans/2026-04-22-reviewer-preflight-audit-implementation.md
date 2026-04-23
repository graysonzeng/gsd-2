# Reviewer Preflight Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audit-only reviewer preflight snapshot before Phase 2 reviewer spawn so the next real composed-lite validation records startup readiness and invocation assembly without changing reviewer runtime behavior.

**Architecture:** Keep the new logic inside `src/resources/extensions/gsd/composed-lite/review-harness.ts`, because that file already owns reviewer-specific prompt creation, model selection handoff, spawn invocation, retry behavior, and audit emission. Emit one new `reviewer_preflight` audit event before the first spawn attempt, sourcing provider readiness from `req.ctx.modelRegistry.isProviderRequestReady` only when that signal is actually available.

**Tech Stack:** TypeScript, Node.js built-ins, composed-lite audit log JSONL, Node test runner (`node:test`), project TypeScript compile check

---

## File Structure

### Files to modify

- `src/resources/extensions/gsd/composed-lite/review-harness.ts`
  - Add a tiny local helper that resolves optional provider readiness from `req.ctx`.
  - Refactor reviewer spawn wiring so `modelArg` is computed once and reused by both preflight audit and the actual spawn call.
  - Emit a new `reviewer_preflight` audit event before the retry loop.

- `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`
  - Add structural assertions for the new preflight event and fields.
  - Lock in that the harness still has only one real runtime reviewer spawn call site.

### Files to read but not modify

- `src/resources/extensions/gsd/composed-lite/phases/p2-design.ts:65-87`
  - Reuse the existing `isProviderRequestReady` access pattern conceptually, but do not move the preflight there.

- `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
  - Read-only context; this plan does not change timeout or spawn semantics.

- `docs/superpowers/specs/2026-04-22-reviewer-preflight-audit-design.md`
  - Source-of-truth design doc for scope and out-of-scope boundaries.

---

### Task 1: Add the failing structural regression first

**Files:**
- Modify: `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts:265-349`
- Read: `src/resources/extensions/gsd/composed-lite/review-harness.ts:119-242`

- [ ] **Step 1: Add a new structural regression test for the preflight audit event**

```ts
test("review harness records an audit-only reviewer preflight snapshot before spawn", () => {
  assert.match(REVIEW_HARNESS_SOURCE, /event: "reviewer_preflight"/);
  assert.match(REVIEW_HARNESS_SOURCE, /reviewer_model: reviewerModel/);
  assert.match(REVIEW_HARNESS_SOURCE, /reviewer_provider: reviewerProvider/);
  assert.match(REVIEW_HARNESS_SOURCE, /model_arg: modelArg/);
  assert.match(REVIEW_HARNESS_SOURCE, /max_retries: maxRetries/);
  assert.match(REVIEW_HARNESS_SOURCE, /provider_ready_check_available:/);
  assert.match(REVIEW_HARNESS_SOURCE, /provider_ready:/);
  assert.match(REVIEW_HARNESS_SOURCE, /system_prompt_path: tmp\.filePath/);
  assert.match(REVIEW_HARNESS_SOURCE, /system_prompt_file_exists: existsSync\(tmp\.filePath\)/);
  assert.match(REVIEW_HARNESS_SOURCE, /review_prompt_chars: reviewPromptChars/);
  assert.match(REVIEW_HARNESS_SOURCE, /target_content_chars: targetContentChars/);
  assert.match(REVIEW_HARNESS_SOURCE, /task_chars: taskChars/);
  assert.match(REVIEW_HARNESS_SOURCE, /system_prompt_chars: systemPromptChars/);
  assert.match(REVIEW_HARNESS_SOURCE, /tool_restriction: "read"/);
});
```

- [ ] **Step 2: Add a regression that proves no extra reviewer probe path was introduced**

```ts
test("review harness still has exactly one runtime reviewer spawn call site", () => {
  const spawnReviewerMentions = REVIEW_HARNESS_SOURCE.match(/spawnReviewer\(/g) ?? [];
  assert.equal(spawnReviewerMentions.length, 2);
});
```

- [ ] **Step 3: Run the focused structural test file and verify it fails**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts
```

Expected:

- FAIL
- the new `reviewer_preflight` assertions should fail because the source does not contain that event yet

- [ ] **Step 4: Commit the failing-test checkpoint**

```bash
git add src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts
git commit -m "test: lock reviewer preflight audit surface"
```

---

### Task 2: Implement the audit-only reviewer preflight in `review-harness.ts`

**Files:**
- Modify: `src/resources/extensions/gsd/composed-lite/review-harness.ts:50-76`
- Modify: `src/resources/extensions/gsd/composed-lite/review-harness.ts:119-188`
- Read: `src/resources/extensions/gsd/composed-lite/phases/p2-design.ts:65-87`

- [ ] **Step 1: Add a helper that resolves optional provider readiness from `req.ctx`**

```ts
function resolveReviewerProviderReady(
  req: ComposedLiteRunRequest,
  provider: string,
): { providerReadyCheckAvailable: boolean; providerReady: boolean | null } {
  const registry = (req.ctx as unknown as {
    modelRegistry?: { isProviderRequestReady?: (provider: string) => boolean };
  }).modelRegistry;

  if (typeof registry?.isProviderRequestReady !== "function") {
    return { providerReadyCheckAvailable: false, providerReady: null };
  }

  try {
    return {
      providerReadyCheckAvailable: true,
      providerReady: registry.isProviderRequestReady(provider),
    };
  } catch {
    return {
      providerReadyCheckAvailable: true,
      providerReady: false,
    };
  }
}
```

- [ ] **Step 2: Refactor reviewer spawn wiring so `modelArg` is computed once and reused**

Replace the current helper with this shape:

```ts
async function spawnReviewer(
  projectRoot: string,
  modelArg: string,
  task: string,
  systemPromptPath: string,
): Promise<Awaited<ReturnType<typeof spawnGsdSubagent>>> {
  return spawnGsdSubagent({
    projectRoot,
    task,
    modelArg,
    extraArgs: ["--append-system-prompt", systemPromptPath, "--tools", "read"],
  });
}
```

Then inside `runReview()` compute once:

```ts
const modelArg = buildModelArg(reviewerModel, reviewerProvider);
```

- [ ] **Step 3: Emit the new `reviewer_preflight` audit event before the retry loop**

Move `const maxRetries = 2;` above the first reviewer-side audit emission, then add:

```ts
const { providerReadyCheckAvailable, providerReady } = resolveReviewerProviderReady(
  req,
  reviewerProvider,
);

appendAudit(projectRoot, state.run_id, {
  event: "reviewer_preflight",
  payload: {
    phase,
    agent: "composed-lite-reviewer",
    reviewer_model: reviewerModel,
    reviewer_provider: reviewerProvider,
    model_arg: modelArg,
    max_retries: maxRetries,
    provider_ready_check_available: providerReadyCheckAvailable,
    provider_ready: providerReady,
    system_prompt_path: tmp.filePath,
    system_prompt_file_exists: existsSync(tmp.filePath),
    review_prompt_chars: reviewPromptChars,
    target_content_chars: targetContentChars,
    task_chars: taskChars,
    system_prompt_chars: systemPromptChars,
    appended_system_prompt: true,
    tool_restriction: "read",
  },
});
```

- [ ] **Step 4: Update the actual reviewer spawn call to use the shared `modelArg`**

Use:

```ts
const spawnResult = await spawnReviewer(
  projectRoot,
  modelArg,
  task,
  tmp.filePath,
);
```

- [ ] **Step 5: Verify the implementation keeps current runtime semantics**

Check that the file still has all of the following:

```ts
if (terminalFailure) {
  throw new ComposedLiteFuseError("review_unavailable", terminalFailure);
}

if (!result) {
  throw new ComposedLiteFuseError(
    "review_parse_exhausted",
    "Failed to parse reviewer output after retries",
  );
}
```

This step is complete only if:

- there is no extra `spawnGsdSubagent` probe path
- there is no new early `throw new ComposedLiteFuseError(...)` based on readiness

- [ ] **Step 6: Commit the implementation**

```bash
git add src/resources/extensions/gsd/composed-lite/review-harness.ts
git commit -m "feat: add reviewer preflight audit snapshot"
```

---

### Task 3: Lock the final regression surface and run verification

**Files:**
- Modify: `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts:265-349`
- Verify: `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- Verify: `src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`

- [ ] **Step 1: Add a regression that ensures readiness is optional rather than assumed**

```ts
test("review harness treats provider readiness as optional startup evidence", () => {
  assert.match(REVIEW_HARNESS_SOURCE, /provider_ready_check_available: providerReadyCheckAvailable/);
  assert.match(REVIEW_HARNESS_SOURCE, /provider_ready: providerReady/);
  assert.match(REVIEW_HARNESS_SOURCE, /return \{ providerReadyCheckAvailable: false, providerReady: null \ }/);
});
```

- [ ] **Step 2: Run the focused regression suite**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts
```

Expected:

- PASS
- all composed-lite runtime regression tests pass
- all subagent-spawn tests pass

- [ ] **Step 3: Run TypeScript compile verification**

Run:

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected:

- exit code `0`
- no TypeScript errors

- [ ] **Step 4: Commit the final verified state**

```bash
git add src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts src/resources/extensions/gsd/composed-lite/review-harness.ts
git commit -m "test: verify reviewer preflight audit wiring"
```

---

## Self-Review

### Spec coverage
- **Overview / recommended approach:** covered by Task 2 preflight-only audit emission
- **Preflight data capture:** covered by Task 2 Step 3 and Task 3 Step 1
- **No new probe path:** covered by Task 1 Step 2 and Task 2 Step 5
- **No runtime behavior change:** covered by Task 2 Step 5 and final verification in Task 3
- **Verification commands:** covered by Task 3 Steps 2-3

### Placeholder scan
No `TODO`, `TBD`, “implement later”, or unnamed helper references remain in the plan.

### Type consistency
- `resolveReviewerProviderReady`
- `providerReadyCheckAvailable`
- `providerReady`
- `modelArg`
- `reviewer_preflight`

These names are used consistently across all tasks.
