# Reviewer In-Session Format Correction — Cascade Review

**Date**: 2026-04-27
**Reviewer**: Cascade
**Status**: DONE_WITH_CONCERNS
**Reviewed inputs**:
- `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction.md`
- `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction-review.md`
- `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction-handoff.md`

---

## Summary

The revised design is directionally correct and the core implementation is mostly sound.

The important product/runtime decision is right: reviewer output format failures and reviewer infrastructure failures are different failure classes and should not both surface as `reviewer_unavailable`.

The chosen implementation, a reviewer-local format repair loop, is a good first step. It avoids the much larger CLI/RPC/headless protocol work required for true same-process `continueSession`, while preserving the main safety invariant: unparseable reviewer output must not be synthesized into a fake verdict.

However, this should not be merged as-is. A few consistency and safety issues remain.

---

## Verification performed

Reviewed source files:

- `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
- `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
- `src/resources/extensions/gsd/rule-registry.ts`
- `src/resources/extensions/gsd/post-unit-hooks.ts`
- `src/resources/extensions/gsd/auto-post-unit.ts`
- `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
- `src/resources/extensions/gsd/shared-harness/index.ts`

Reviewed tests:

- `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts`
- `src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.ts`

Commands run:

```bash
npx tsc --noEmit --project tsconfig.json --pretty false
```

Result: passed.

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.ts
```

Result: 33/33 passed.

---

## What is correct

- The diagnosis is correct: `parse_exhausted` and `subprocess_failure` were previously conflated at the reviewer hook boundary.
- The safety decision is correct: exhausted parse failures must not be downgraded into a synthetic `issues` verdict.
- The scope decision is correct: true same-process `continueSession` should remain out of scope for this PR.
- `runReview()` now has structured parse diagnostics and a format repair path before throwing `parse_exhausted`.
- `runPhaseDisciplineReviewerHook()` now distinguishes all-parse failures from infrastructure failures when no reviewer produced a parseable verdict.
- `rule-registry.ts` surfaces `reviewer_format_invalid` from the `*-BLOCKED.md` sentinel.
- `auto-post-unit.ts` now gives distinct pause messages for `reviewer_unavailable`, `reviewer_format_invalid`, and `max_cycles_reached`.
- Targeted tests cover parser diagnostics, repair success, terminalError behavior, parse exhaustion, mixed failure classification, registry blocked state, and auto-loop-facing blocked reasons.

---

## Findings

### [P1] Timeout abort does not actually kill the in-flight reviewer child

**Files**:
- `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`
- `src/resources/extensions/gsd/shared-harness/reviewer-core.ts`
- `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`

The revised plan says timeout abort must truly stop subprocesses and avoid late work. Current implementation only aborts the controller and prevents future spawns. It does not cancel the child process that is already running.

Current shape:

- `runReviewWithTimeout()` calls `controller.abort()` on hard timeout.
- `runReview()` checks `signal.aborted` before starting the next initial or repair spawn.
- The active child is created through the promise-only `spawnGsdSubagent()` path, not the cancellable `spawnGsdSubagentHandle()` path.

This means one in-flight reviewer process can keep running until its own subagent timeout or natural completion. The handoff notes this as possibly acceptable, but it conflicts with the revised plan invariant.

**Impact**: token/process/resource leakage. It is probably not a late artifact write risk, because artifact writes happen after `runPhaseDisciplineReviewerHook()` receives a result, but the orphan work is still real.

**Recommendation**: implement a cancellable spawn helper in `reviewer-core.ts` using `spawnGsdSubagentHandle()`. Attach an abort listener that calls `handle.cancel("SIGTERM")`, await `handle.promise`, and remove the listener in `finally`. Add a unit test proving abort calls cancel and prevents repair/fresh retry spawns.

---

### [P2] `post-unit-hooks.ts` facade type is stale

**File**: `src/resources/extensions/gsd/post-unit-hooks.ts`

`rule-registry.ts` now has:

```ts
reason: "reviewer_unavailable" | "reviewer_format_invalid" | "max_cycles_reached";
```

But `post-unit-hooks.ts` still declares:

```ts
reason: "reviewer_unavailable" | "max_cycles_reached";
```

TypeScript still passes because of casts and control-flow behavior, but the public facade type is now wrong.

**Impact**: future code using `BlockedHookRecord` will not see `reviewer_format_invalid` as a valid reason. This is an interface drift bug.

**Recommendation**: update `BlockedHookRecord.reason` in `post-unit-hooks.ts` to include `reviewer_format_invalid`. Add or adjust a test that consumes `reviewer_format_invalid` through the facade.

---

### [P2] Raw logs do not preserve each initial/repair attempt separately

**File**: `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`

The plan requires raw stdout/stderr for repair attempts to be preserved with attempt-aware names, such as:

- `reviewer0-initial-stdout.log`
- `reviewer0-repair1-stdout.log`

The implementation writes only the last attempt for a reviewer:

- success path writes `lastAttempt`
- failure path writes `lastFailedAttempt`
- fallback success path writes `lastAttempt`

**Impact**: if initial output contained the important diagnostic and repair output made things worse, the operator loses the evidence needed to understand why format repair failed.

**Recommendation**: write raw logs for every `ReviewAttempt`, with filenames including reviewer index, fresh spawn index, phase, and correction round. Add a test where initial and repair outputs differ and both logs are asserted on disk.

---

### [P2] `reviewer_unavailable` Operator Action text is misleading

**File**: `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`

Current text says repeated failures will eventually exhaust `max_cycles` and let auto continue with the recorded `reviewer_unavailable` verdict.

That is not how the BLOCKED sentinel path behaves. BLOCKED takes precedence over `retry_on` and pauses auto. It does not eventually pass through via `max_cycles`.

**Impact**: operator runbook confusion. Someone may repeatedly resume expecting the system to continue by itself.

**Recommendation**: replace the sentence with language like:

```text
Repeated reviewer_unavailable failures will continue to block auto until the reviewer subsystem is fixed or the BLOCKED artifact is intentionally cleared after operator review.
```

---

### [P3] Observability field semantics should be clarified

**Files**:
- `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction.md`
- `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts`

The plan says `attempts` remains fresh-spawn count. The implementation uses `entry.value.attempts.length`, which counts initial and repair attempts together.

Also, primary reviewer success records `correctionRounds` and `formatRepairSucceeded`, but fallback success currently only records `attempts` and `outputChars`.

**Impact**: dashboards or future debugging can misread retry behavior.

**Recommendation**: either update docs to define `attempts` as total spawn attempts including repair, or split fields into `freshSpawnCount`, `attempts`, and `correctionRounds`. Also include `correctionRounds` / `formatRepairSucceeded` for fallback success metrics.

---

### [P3] `doctor-config.ts` is unrelated dirty state and should not be included in this PR

**File**: `src/resources/extensions/gsd/doctor-config.ts`

The handoff marks this as pre-existing dirty state. The diff confirms it is unrelated to reviewer format repair.

**Impact**: scope drift. It makes the PR harder to review and could hide unrelated behavior changes.

**Recommendation**: split it into a separate change or stash/revert it before shipping this reviewer-format correction.

---

## Recommended merge gate

Do not merge until these are addressed:

1. [P1] Real cancellation for in-flight reviewer child, or explicitly downgrade the design invariant. Prefer real cancellation.
2. [P2] Update `post-unit-hooks.ts` facade type to include `reviewer_format_invalid`.
3. [P2] Fix misleading `reviewer_unavailable` Operator Action text.

Strongly recommended before merge:

4. Preserve raw logs for every initial/repair attempt.
5. Clarify observability semantics and fallback metrics.
6. Remove or split unrelated `doctor-config.ts` changes.

---

## Final verdict

The core idea is valid.

The implementation is close, but it has one real safety mismatch around cancellation and a few interface/observability/documentation inconsistencies. Treat this as **approved direction, needs focused fixes before ship**.
