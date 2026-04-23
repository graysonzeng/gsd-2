# Phase 2 Reviewer Guard Validation Design Document

## Overview
This document defines a validation-only run for the requirement:

> Validation run after Phase 2 reviewer guard tightening. Do not edit source files. Verify whether the Phase 2 reviewer still stalls before first visible output or now emits progress/output under the same `180000ms` reviewer timeout.

The task is not to fix the reviewer. It is to produce a clean validation design that can answer one narrow question with repository-grounded evidence:

- under the same `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000` budget,
- does the Phase 2 reviewer still time out before any visible output,
- or does it now emit observable progress/output before timing out or completing?

This is a runtime-behavior validation scoped to the composed-lite review path. It is explicitly read-only with respect to source files.

## Approach
The validation should be treated as an evidence-first observation pass, not an implementation task.

### 1. Validate the exact path that owns the behavior
The critical execution path is:

- `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
- `src/headless.ts`
- `src/headless-ui.ts`

Those files define the question’s observable surface:

- `review-harness.ts` is the Phase 2 reviewer call site.
- `subagent-spawn.ts` owns the reviewer timeout and the timeout diagnostics.
- `headless.ts` tracks visible progress state.
- `headless-ui.ts` formats human-visible progress output.

The design should assume those files are read-only anchors, not edit targets.

### 2. Hold the timeout constant
The validation must use the same reviewer timeout named in the requirement:

- `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000`

This matters because `subagent-spawn.ts` defaults to a much larger value:

- `DEFAULT_SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000`

So the design must explicitly require the 180000ms override. Otherwise the result is not comparable to the requirement.

### 3. Use both internal and external evidence of progress
The phrase “first visible output” has two plausible meanings in this repo:

1. **Internal reviewer activity** captured in timeout diagnostics:
   - `assistant_started=yes|no`
   - `message_updates=<count>`
   - `tool_uses=<count>`
   - `output_chars=<count>`

2. **User-visible progress** surfaced by headless progress formatting:
   - composed-lite status keys such as `cl:review`
   - headless lines like `review: ...`
   - heartbeat lines such as `[alive] ... no new activity for Ns`

The validation should check both. The original failure mode was “stalls before first visible output,” so the outcome cannot be judged from final success/failure alone.

### 4. Treat timeout with progress differently from timeout with silence
A timeout is no longer enough to classify the behavior as unchanged.

There are two materially different failure shapes:

- **Silent timeout:** no visible output and no meaningful reviewer activity before the 180000ms limit.
- **Active timeout:** the reviewer still times out, but emits progress or output before the timeout.

The requirement is satisfied by distinguishing these cases clearly.

### 5. Prefer fresh-run evidence, but reuse the most recent handoff for framing
The strongest prior-art framing is already documented in:

- `docs/superpowers/plans/2026-04-22-composed-lite-timeout-validation-handoff.md`

That handoff already established:

- Phase 1 scout timeout is no longer the main blocker under realistic budgets.
- Phase 2 reviewer timeout is the next true blocker.
- The next high-value question is whether the reviewer is silent vs making forward progress.

This new design should stand on its own, but it should reuse that framing rather than reopening the Phase 1 hypothesis.

## Key Decisions

### Decision 1: This is a validation run, not a repair task
No source edits are allowed.

**Reasoning:**
The requirement explicitly forbids source-file edits. The only acceptable outputs are documentation, analysis, and validation evidence.

### Decision 2: The canonical success criterion is observability, not completion
The primary question is not “does Phase 2 pass?” but:

- does the reviewer emit any visible progress/output before timeout under the same 180000ms budget?

**Reasoning:**
The research and prior handoff both point to a change in failure shape as the thing to measure. A run can still fail overall while proving that the guard tightening improved observability.

### Decision 3: Timeout diagnostics in `subagent-spawn.ts` are first-class evidence
The timeout wrapper appends these fields when a subagent times out:

- `assistant_started=yes|no`
- `message_updates=...`
- `tool_uses=...`
- `output_chars=...`

These should be treated as the cleanest low-level evidence for whether the reviewer stalled before first output.

**Reasoning:**
Those metrics are emitted specifically on the timeout path and directly answer whether there was any reviewer-side activity.

### Decision 4: Headless progress output is the user-visible evidence channel
The validation should separately examine whether headless mode exposed progress through:

- `cl:review`
- `cl:phase`
- `cl:unit:*`
- heartbeat/alive lines

**Reasoning:**
A reviewer can be internally active without producing visible progress. The requirement asks about “first visible output,” so internal counters alone are not enough.

### Decision 5: The reviewer harness constraints are part of the hypothesis
The Phase 2 reviewer is intentionally constrained in `review-harness.ts`:

- `--append-system-prompt <temp prompt>`
- `--tools read`
- system prompt language telling it not to do generic startup discovery or skill scanning

**Reasoning:**
The “guard tightening” is precisely about reducing startup drift. The design must interpret any behavior change in light of those reviewer-specific constraints.

## File Changes Needed
This task should be documentation-only.

### File to create
- `docs/superpowers/specs/2026-04-22-phase2-reviewer-guard-validation-design.md`

### Read-only evidence anchors
These files should be read for validation context but not modified:

- `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
- `src/headless.ts`
- `src/headless-ui.ts`
- `docs/superpowers/plans/2026-04-22-composed-lite-timeout-validation-handoff.md`
- optionally, the most relevant raw reviewer log from the prior run:
  - `./.gsd/composed-lite/logs/raw/cl-20260422-11-2-1-reviewer-0.jsonl`

### Files explicitly not to change
No edits should be made to:

- `src/**`
- `packages/**`
- `native/**`
- `docs/user-docs/**`
- `docs/zh-CN/**`
- any test files

## Edge Cases

### Reviewer times out but now emits output
This is the most important edge case.

**Handling:**
Classify it as a behavior change, not a clean failure repeat. Record that the stall before first visible output has been replaced by an active-but-insufficient reviewer run.

### Reviewer emits internal activity but no visible headless progress
Possible signs:

- `assistant_started=yes`
- non-zero `message_updates`, `tool_uses`, or `output_chars`
- but no visible `cl:review`/headless progress lines before timeout

**Handling:**
Classify this as partial improvement in subagent activity but not in user-visible observability. That is materially different from a total stall, but still leaves the “visible output” goal unmet.

### Headless emits alive/heartbeat lines but reviewer itself is still silent
Possible signs:

- `[alive] ... no new activity for Ns`
- but timeout diagnostics still show:
  - `assistant_started=no`
  - `message_updates=0`
  - `tool_uses=0`
  - `output_chars=0`

**Handling:**
Do not count heartbeat-only output as evidence that the reviewer itself is making progress. Treat this as the original silent reviewer stall unless reviewer-specific signals say otherwise.

### Run fails for a different reason before timeout
Examples:

- spawn failure
- provider/auth failure
- parse failure after reviewer output
- harness-level `review_unavailable` for reasons other than timeout

**Handling:**
Mark the run as inconclusive for this requirement unless there is still enough evidence to answer the visibility question. The design should not collapse unrelated failures into the stall bucket.

### The environment does not actually apply the 180000ms timeout
This is a real risk because the default subagent timeout is 10 minutes.

**Handling:**
Any run that does not prove `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000` was applied should be rejected as non-comparable.

### Cold-start costs may still dominate
The repo is a large Node/TypeScript monorepo with extension loading and multi-provider runtime setup. Some startup cost is expected.

**Handling:**
Do not over-interpret “slow first output” as pathological drift unless the timeout diagnostics and raw log behavior support that conclusion.

## Testing Strategy
This task is design-only, but the intended validation strategy should be explicit.

### 1. Hold the runtime shape stable
Use the same timeout budget named in the requirement:

- inner reviewer timeout: `GSD_COMPOSED_LITE_SUBAGENT_TIMEOUT_MS=180000`

Ensure the outer headless timeout is comfortably larger so the outer harness does not mask the inner reviewer result.

### 2. Run the same Phase 2 reviewer path
The validation must exercise the real Phase 2 path owned by `review-harness.ts`, not a synthetic approximation unless the synthetic run is clearly labeled as supplemental.

Preferred evidence order:

1. real composed-lite run under the target timeout
2. audit log for the run
3. raw reviewer log for the run
4. headless visible output for the run
5. supplemental local repro tooling only if needed

### 3. Record the decision criteria up front
The run outcome should be classified into one of these buckets:

#### A. Silent stall persists
Evidence shape:
- timeout at 180000ms
- `assistant_started=no` or equivalent no-activity diagnostics
- `message_updates=0`
- `tool_uses=0`
- `output_chars=0`
- no reviewer-visible headless progress before timeout

Conclusion:
- the pre-tightening stall shape still exists

#### B. Reviewer active, but still times out
Evidence shape:
- timeout at 180000ms
- non-zero reviewer diagnostics (`assistant_started=yes`, `message_updates>0`, `tool_uses>0`, or `output_chars>0`)
- and/or visible headless review progress before timeout

Conclusion:
- guard tightening changed the behavior from silent stall to active timeout

#### C. Reviewer emits visible progress and completes
Evidence shape:
- visible review progress/output appears before completion
- no timeout at 180000ms

Conclusion:
- reviewer no longer stalls before first visible output and also fits within the target budget

#### D. Inconclusive
Evidence shape:
- wrong timeout applied
- unrelated runtime failure masks the reviewer behavior
- logs missing or corrupted

Conclusion:
- rerun required; no behavioral claim should be made

### 4. Verify both low-level and user-visible evidence
For a valid conclusion, inspect both:

- timeout diagnostics from `subagent-spawn.ts`
- visible progress surfaced through headless status/output

This avoids misclassifying:

- internal activity with no visible output
- generic heartbeat output with no reviewer activity

### 5. Preserve the no-edit constraint
Verification for this task should confirm:

- no source files were modified
- no test files were changed
- only documentation or run artifacts were produced

## Bottom Line
This design treats the requirement as a narrow runtime-validation question.

The correct next validation pass should:

- hold the reviewer timeout at `180000ms`
- exercise the real Phase 2 reviewer path
- inspect both timeout diagnostics and visible headless progress
- distinguish silent timeout from active timeout
- make no source-file edits

The most important result is not merely whether the run fails, but whether the failure shape has changed from “no visible output before timeout” to “observable progress/output under the same timeout.”
