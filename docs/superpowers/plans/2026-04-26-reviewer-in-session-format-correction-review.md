# Reviewer In-Session Format Correction — Review Notes

**Date**: 2026-04-26  
**Source Plan**: `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction.md`  
**Status**: Review Complete, Plan Needs Revision  
**Scope Reviewed**: phase-discipline auto-mode loop, reviewer hook, shared reviewer harness, subagent spawn/parsing, blocked hook semantics

---

## Executive Summary

The plan's core diagnosis is correct: phase-discipline reviewer format failures and reviewer infrastructure failures are currently conflated. A reviewer output parse failure can become `reviewer_unavailable`, write a `*-BLOCKED.md` sentinel, and pause auto-mode.

However, the proposed implementation needs revision before coding.

Key decisions from review:

1. Do **not** treat exhausted parse failures as a synthetic `issues` verdict.
2. Do **not** make true same-process `continueSession` the first implementation target.
3. Prefer a smaller reviewer-local format repair loop.
4. If repair still fails, surface a distinct `reviewer_format_invalid` blocked state rather than `reviewer_unavailable`.
5. Preserve the existing `subprocess_failure -> reviewer_unavailable -> BLOCKED -> pause auto` path.

---

## Code Reality Checked

### Actual loop path

```text
auto/phases.ts
  -> runUnit()
    -> maybeRunPhaseDisciplineBuiltInHook()
      -> runPhaseDisciplineReviewerHook()
        -> runReview()
          -> spawnGsdSubagent()
            -> CLI --mode json -p --no-session
```

### Relevant evidence

- Built-in reviewer hooks short-circuit before regular `newSession()`:
  - `src/resources/extensions/gsd/auto/run-unit.ts`
  - `maybeRunPhaseDisciplineBuiltInHook()` returns completed without creating an auto unit session.

- Reviewer subagents are currently one-shot CLI processes:
  - `src/resources/extensions/gsd/shared-harness/subagent-spawn.ts`
  - Spawn args include `--mode json`, `-p`, `--no-session`, and a single `Task: ...` payload.

- `parse_exhausted` is currently converted into blocked reviewer failure in practice:
  - `src/resources/extensions/gsd/shared-harness/reviewer-core.ts` throws `ReviewerCoreError("parse_exhausted")` after parse retries are exhausted.
  - `src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts` collects all rejected reviewers and, if `results.length === 0`, writes `Overall Assessment: reviewer_unavailable` plus a `*-BLOCKED.md` sentinel.
  - `src/resources/extensions/gsd/rule-registry.ts` sees that sentinel and sets `blockedHook.reason = "reviewer_unavailable"`.
  - `src/resources/extensions/gsd/auto-post-unit.ts` consumes blocked hook state and calls `pauseAuto()`.

---

## Findings

### [P1] Correct diagnosis: format failures and infrastructure failures are conflated

The plan is right that two different failure classes currently collapse at the hook boundary:

| Failure type | Current symptom | Correct handling |
|---|---|---|
| Provider/session/timeout failure | `subprocess_failure` -> `reviewer_unavailable` | Pause auto for operator action |
| Invalid reviewer YAML/schema | `parse_exhausted` -> currently can become `reviewer_unavailable` | Attempt reviewer-local repair first, then report format-specific blocked state |

This is worth fixing because re-running the trigger unit cannot fix reviewer output format.

### [P1] Do not downgrade `parse_exhausted` into an `issues` verdict

The source plan suggests that if all reviewers fail only with `parse_exhausted`, the hook could avoid `BLOCKED` and treat the result as warning-level or `issues`.

That is unsafe.

A non-parseable reviewer output is not a verdict. The system cannot know whether the reviewer intended `pass`, `issues`, or `fail`, nor whether any findings were preserved. Synthesizing `issues` may either consume the wrong flow-level retry path or silently weaken the review gate.

Recommended replacement:

```text
parse failure should be corrected inside reviewer-core.
If correction still cannot produce a parseable verdict, do not pretend a verdict exists.
Surface a distinct reviewer_format_invalid failure.
```

### [P1] True same-process `continueSession` is too large for this fix

The proposed `SubagentSession.continue()` API would require new process/session semantics that do not currently exist.

Current reality:

- `spawnGsdSubagent()` starts a child process for one CLI invocation.
- The invocation uses `--no-session`.
- There is no stdin continuation protocol.
- There is no turn delimiter or continuation contract in `subagent-terminal.ts`.
- Timeout/cancel semantics are already non-trivial.

Adding real same-process continuation would spread into CLI/RPC/headless/subagent protocol. That should not be bundled into a reviewer format fix.

### [P1] Recommended first implementation: reviewer-local format repair loop

Instead of true `continueSession`, implement reviewer-local format repair inside `runReview()`.

Shape:

```text
initial reviewer spawn returns outputText
  -> parseReviewerOutput(outputText)
  -> if parse fails and terminalError is absent:
       spawn a cheap repair reviewer with:
         - previous output
         - parse error diagnostic
         - required YAML schema
       parse repaired output
  -> if repair succeeds: return parsed verdict
  -> if repair fails: optionally do existing fresh full retry
  -> if all exhausted: throw parse_exhausted
```

This achieves the important goals:

- Does not consume post-unit hook `max_cycles`.
- Does not write `retry_on`.
- Does not rerun the trigger unit.
- Avoids a broad CLI protocol rewrite.
- Keeps raw reviewer output available for observability.

The plan title can remain, but implementation language should shift from `In-Session Correction Loop` to `Reviewer-Local Format Repair Loop` unless a later PR explicitly adds real subagent continuation.

### [P1] Preserve infrastructure fail-fast semantics

Do not run format repair when the subagent had a terminal/runtime failure.

Invariant to add:

```text
If terminalResult.terminalError is present, do not attempt format correction.
Only outputText parse failures with stopReason != error are eligible for format repair.
```

Provider failures like 401/403, network failures, hard timeouts, and child process errors must still become `subprocess_failure` and ultimately `reviewer_unavailable`.

### [P2] Parser strictness is a real behavior change

Current parser behavior is permissive for malformed finding items. It drops malformed finding entries and still accepts the review if `overall_assessment` is valid.

Existing test evidence:

- `src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts`
- Test: `parseReviewerOutput drops malformed finding items`

The plan proposes `finding_item_malformed` as an error category. That is probably the right quality bar, but it must be explicit because it changes existing behavior.

Recommended decision:

- Make parser strict for malformed finding lists/items.
- Update or replace the permissive test.
- Treat silently dropped findings as unsafe.

### [P2] Missing files from the modification list

If adding a distinct `reviewer_format_invalid` blocked state, the plan must include these files:

- `src/resources/extensions/gsd/rule-registry.ts`
  - Extend `blockedHook.reason` union beyond `"reviewer_unavailable" | "max_cycles_reached"`.

- `src/resources/extensions/gsd/auto-post-unit.ts`
  - Render a format-specific pause message instead of labeling everything as reviewer subsystem unavailable.

- `src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.ts`
  - Add registry-level tests for format invalid blocking.

### [P2] Timeout cancellation needs explicit design

`runPhaseDisciplineReviewerHook()` wraps `runReview()` with a hard timeout via `Promise.race()`. That rejects the outer promise but does not necessarily cancel inner work.

If repair loops add more subprocesses, the risk grows.

The plan should specify one of:

- Add `AbortSignal` support through `RunReviewInput` and subagent spawn.
- Use `spawnGsdSubagentHandle()` internally so active child processes can be killed.
- At minimum, prove via tests that timeout does not allow late artifact writes.

### [P2] Observability should capture format repair details

Add observability fields to the `.phase-discipline/*.json` log:

- `parseErrorKind`
- `parseErrorMessage`
- `correctionRounds`
- `formatRepairSucceeded`
- `formatRepairOutputChars`
- whether final verdict came from initial output, repair output, or fresh retry

Also preserve raw stdout/stderr for repair attempts.

---

## Recommended Revised Design

### Phase 1: Low-risk reviewer format repair

1. Strengthen reviewer prompt with schema self-check.
2. Change `parseReviewerOutput()` to return structured diagnostics.
3. Implement reviewer-local format repair inside `runReview()`.
4. Keep existing fresh-spawn retry as fallback.
5. Never format-repair terminal/runtime failures.

### Phase 2: Accurate blocked reason

1. Add `reviewer_format_invalid` as a distinct blocked reason.
2. Preserve `reviewer_unavailable` for provider/session/network/timeout failures only.
3. Write format-specific blocked artifact content.
4. Update rule registry and auto pause messaging.

### Phase 3: Optional future true continuation

Only after Phase 1/2 land and are validated, consider a separate design for real same-process continuation. That design must cover CLI/RPC protocol, `--no-session` semantics, output framing, cancellation, timeout, and headless compatibility.

---

## Required Test Coverage

### Parser diagnostics

- Empty output.
- Invalid YAML syntax.
- Missing `overall_assessment`.
- Invalid `overall_assessment`, such as `approved`.
- Invalid `critical` / `important` / `minor` shape.
- Malformed finding item.

### `runReview()` repair behavior

- Initial output invalid, repair output valid, final result succeeds.
- `terminalError` does not trigger repair and remains `subprocess_failure`.
- Repair attempts exhausted, final error is `parse_exhausted`.
- Existing fresh full retry still works after repair failure, if kept.

### `reviewer-hook` behavior

- One reviewer parse-exhausted, another succeeds, use successful verdict.
- All reviewers `subprocess_failure`, write `reviewer_unavailable` blocked sentinel.
- All reviewers `parse_exhausted`, write `reviewer_format_invalid` blocked sentinel and do not write `retry_on`.

### Registry and auto loop behavior

- `reviewer_format_invalid` sentinel surfaces via `isHookBlocked()`.
- `auto-post-unit.ts` pause message distinguishes format invalid from provider unavailable.
- Existing `max_cycles_reached` semantics remain unchanged.

### Observability

- Correction rounds and parse diagnostics are persisted.
- Raw logs include initial and repair attempts.

---

## Final Recommendation

Revise the plan before implementation.

Approved core idea:

```text
Reviewer format validation should be handled inside reviewer-core and must not consume flow-level retry budget.
```

Rejected or revised ideas:

```text
Do not synthesize an issues verdict from unparseable output.
Do not implement real same-process continueSession in the first pass.
```

Best next implementation target:

```text
Reviewer-local format repair loop + strict parse diagnostics + reviewer_format_invalid blocked reason.
```

This keeps the fix small enough to ship safely while preserving the safety properties that phase-discipline auto-mode depends on.
