# Reviewer In-Session Format Correction — Revision + Implementation Handoff

**Date**: 2026-04-26
**Status**: Implementation complete; awaiting independent review in a fresh session
**Branch**: `feat/phase-discipline-preset-v1`

**Source documents**:
- Revised plan: `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction.md`
- Codex review that drove the revision: `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction-review.md`

---

## 1. Reviewer (codex) verdict assessment

**Codex review accepted in full.** Its P1 findings each target a real defect in the original plan; P2 findings are all non-trivial. Concrete mapping:

| Codex finding | P# | Disposition | Why it is right |
|---|---|---|---|
| Do **not** downgrade `parse_exhausted` into a synthetic `issues` verdict | P1 | Accepted | Unparseable output does not carry a verdict; synthesizing `issues` silently weakens the review gate and can hide both pass and fail outcomes. |
| Do **not** implement real same-process `continueSession` in this PR | P1 | Accepted | `spawnGsdSubagent()` uses `--mode json -p --no-session` with no stdin continuation protocol; true continuation would spread into CLI/RPC/headless scope and belongs in a separate PR. |
| Replace with a reviewer-local format repair loop | P1 | Accepted | Re-spawn with previous output + parse error is small, local, and achieves "do not consume flow-level retry budget" without touching the CLI protocol. |
| Keep `terminalError` fail-fast semantics; never format-repair on infra failure | P1 | Accepted | Provider 401/timeout must not be laundered into `parse_exhausted`. Enforced in both the initial spawn and the repair spawn. |
| Add distinct `reviewer_format_invalid` blocked reason | P1 | Accepted | Separates "provider is down" from "reviewer model can't hold the schema" — operators get the right runbook. |
| Parser strictness for malformed finding items is a real behavior change | P2 | Accepted | Existing test locked the silent-drop behavior. New behavior raises `malformed_finding_item` instead; the test was updated and a code comment explains why silent drop is unsafe. |
| Missing files in plan's modification list | P2 | Accepted | Added `rule-registry.ts`, `auto-post-unit.ts`, `reviewer-blocking.test.ts` to the modification list and implementation. |
| Timeout cancellation risk with added repair spawns | P2 | Accepted | Introduced `AbortSignal` on `runReview`; `runPhaseDisciplineReviewerHook` wires an `AbortController` so hard-timeout stops further spawns instead of leaving background children. |
| Observability fields for format repair | P2 | Accepted | `correctionRounds`, `formatRepairSucceeded`, `parseErrorKind`, `parseErrorMessage`, `failureKind` recorded per-reviewer. |

**Self-added decisions not in codex review**:
- Mixed failure modes (any `subprocess_failure` + remaining `parse_exhausted`) are conservatively classified as `reviewer_unavailable`, because infrastructure problems are more severe and should not be hidden under a format label.
- BLOCKED sentinel with unrecognized/missing `Block Reason:` line defaults to `reviewer_unavailable` (conservative) rather than the more specific format-invalid reason.
- Phase 3 "real same-process continuation" is explicitly deferred; the revised plan names its prerequisites (CLI `-p --session` protocol, turn framing, headless cancel semantics).

---

## 2. Revised design (what actually shipped)

### 2.1 Core principle

- Format problems stay **inside `runReview()`** and are resolved by re-spawning a follow-up child with the previous output + parse error + required schema.
- Infrastructure problems still propagate as `subprocess_failure → reviewer_unavailable → BLOCKED → pause auto`.
- Unrecoverable format problems surface as `reviewer_format_invalid` — a new, distinct blocked reason — rather than being collapsed into `reviewer_unavailable` or synthesized into a verdict.

### 2.2 Loop shape (pseudocode)

```
for fresh in 0..maxRetries:
  if aborted: throw aborted
  initial = spawn(task=review+target)
  if initial.terminalError: throw subprocess_failure
  { parsed, error } = parseReviewerOutput(initial.outputText)
  if parsed: return success(formatRepairSucceeded=false)

  for round in 1..maxCorrectionRounds:
    if aborted: throw aborted
    repair = spawn(task=buildRepairTask(prev, error))
    if repair.terminalError: throw subprocess_failure   # still infra, not parse
    { parsed, error } = parseReviewerOutput(repair.outputText)
    if parsed: return success(formatRepairSucceeded=true)
    prev = repair.outputText

throw parse_exhausted with all attempts recorded
```

Defaults: `maxRetries=2`, `maxCorrectionRounds=1`. So a worst-case path is `2 * (initial + 1 repair) = 4` spawns before giving up.

### 2.3 Classification decision in `runPhaseDisciplineReviewerHook`

When `results.length === 0` (no reviewer produced a parseable verdict):

```
failureKinds collected from ReviewerCoreError.kind per-reviewer, and from fallback catches
  any subprocess_failure / other / aborted → reviewer_unavailable
  all parse_exhausted                     → reviewer_format_invalid
```

BLOCKED artifact content is rendered differently per reason, and operator guidance steers away from "check provider credentials" when the failure is format-side.

### 2.4 Invariants preserved

1. `subprocess_failure → reviewer_unavailable → BLOCKED → pause auto` path unchanged.
2. Unparseable output is never converted into a verdict.
3. Format repair does not consume post-unit hook `max_cycles` and does not write `retry_on`.
4. A single parseable verdict (out of N reviewers) still wins — the merged path is untouched.
5. `terminalError` during the repair spawn still bubbles as `subprocess_failure`, not `parse_exhausted`.
6. Abort via `AbortSignal` stops spawning immediately and surfaces `ReviewerCoreError.kind === "aborted"`.

---

## 3. Files modified

```
 src/resources/extensions/gsd/auto-post-unit.ts                                      |   9 +-
 src/resources/extensions/gsd/doctor-config.ts                                       |  17 +-  # pre-existing dirty state, not part of this PR
 src/resources/extensions/gsd/phase-discipline/reviewer-hook.ts                      | 139 ++++++-
 src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.ts       |  80 +++++
 src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.ts           | 274 ++++++++++++---
 src/resources/extensions/gsd/rule-registry.ts                                       |  38 +-
 src/resources/extensions/gsd/shared-harness/index.ts                                |  10 +-
 src/resources/extensions/gsd/shared-harness/reviewer-core.ts                        | 299 ++++++++++++++--
 src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.ts             | 388 ++++++++++++++-------
```

### 3.1 `shared-harness/reviewer-core.ts`

- New types: `ParseErrorKind`, `ParseError`, `ParseResult`.
- `parseReviewerOutput(raw)` now returns `ParseResult { parsed, error }` instead of `ReviewResult | null`. Error kinds: `empty_output`, `yaml_syntax_error`, `not_object`, `missing_assessment`, `invalid_assessment_value`, `invalid_finding_list`, `malformed_finding_item`. `invalid_assessment_value` carries `offendingValue` (e.g. `"approved"`).
- **Behavior change**: malformed finding items are no longer silently dropped. The code comment calls this out as a deliberate reversal of the prior silent-drop behavior; the prior test (`parseReviewerOutput drops malformed finding items`) has been replaced with a strict-mode assertion.
- `runReview` gains `maxCorrectionRounds` (default 1), `signal?: AbortSignal`, and a fresh-spawn outer loop wrapping a repair inner loop per the pseudocode above.
- `RunReviewResult` gains `formatRepairSucceeded: boolean` and `correctionRounds: number`.
- `ReviewAttempt` gains `freshSpawnIndex`, `phase: "initial" | "repair"`, `correctionRound`, `parseError`.
- `ReviewerCoreError.kind` extended to `"subprocess_failure" | "parse_exhausted" | "aborted"`.
- Repair prompt truncates previous output at 6000 chars to bound token usage.

### 3.2 `phase-discipline/reviewer-hook.ts`

- `PhaseDisciplineReviewerBlockReason` union extended to `"reviewer_unavailable" | "reviewer_format_invalid"`.
- `runReviewWithTimeout` now instantiates an `AbortController` and aborts on hard-timeout; the abort signal is threaded into `runReview`.
- After `Promise.allSettled`, per-reviewer `failureKind` is captured (`subprocess_failure | parse_exhausted | aborted | other`). Fallback catches also record `failureKind`.
- `results.length === 0` branch selects `blockReason` based on whether any infra failure is present; writes `reviewer_format_invalid` BLOCKED sentinel and fallback artifact when all failures are parse-side.
- `renderBlockedArtifact` takes a new `reason: "target_missing" | "reviewers_exhausted" | "reviewers_format_invalid"` and emits:
  - `Block Reason: reviewer_unavailable` or `Block Reason: reviewer_format_invalid`
  - Format-specific Operator Action text that avoids telling the operator to check provider credentials when the failure is reviewer-side.
- `ReviewerAttemptMetrics` extended: `failureKind`, `correctionRounds`, `formatRepairSucceeded`, `parseErrorKind`, `parseErrorMessage`.

### 3.3 `rule-registry.ts`

- `blockedHook.reason` union extended to include `"reviewer_format_invalid"` with doc comments distinguishing all three reasons.
- `_handleHookCompletion` reads the BLOCKED sentinel body and parses the `Block Reason:` line:
  - `reviewer_format_invalid` → sets the new reason.
  - Anything else or missing → defaults to `reviewer_unavailable` (conservative).

### 3.4 `auto-post-unit.ts`

- Pause message now has three branches:
  - `reviewer subsystem unavailable (provider/network/timeout)`
  - `reviewer produced unparseable output even after format repair`
  - `retry budget exhausted (cycle X/Y)`

### 3.5 Tests

**`tests/shared-harness-reviewer-core.test.ts`** — rewritten:
- 15 tests (was 7). New coverage:
  - Each `ParseErrorKind` diagnostic (empty / syntax / object / assessment / invalid list / malformed item).
  - `runReview` happy path, in-fresh-spawn repair success, `terminalError` short-circuits on initial and on repair, repair exhausted → `parse_exhausted` with full attempts list, `AbortSignal` stops further spawns.
  - `invalid_assessment_value` carries `offendingValue`.
  - Strict mode replaces the prior silent-drop test.

**`phase-discipline/tests/reviewer-hook.test.ts`** — extended:
- Existing tests updated to match the new `RunReviewResult` / `ReviewAttempt` shape via `stubRunReviewResult` / `stubAttempt` helpers.
- 3 new tests:
  - All reviewers fail with `parse_exhausted` → `reviewer_format_invalid` BLOCKED sentinel + observability tagging.
  - Mixed `subprocess_failure` + `parse_exhausted` → `reviewer_unavailable` (infra preempts format).
  - One reviewer parseable + another `parse_exhausted` → merged verdict, no BLOCKED.

**`phase-discipline/tests/reviewer-blocking.test.ts`** — extended:
- 2 new registry-level tests:
  - `reviewer_format_invalid` BLOCKED sentinel surfaces with the correct distinct reason.
  - Unrecognized `Block Reason:` defaults conservatively to `reviewer_unavailable`.

---

## 4. Verification

### 4.1 TypeScript

```
npx tsc --noEmit   → clean
```

### 4.2 Targeted test run

```
reviewer-core.test.ts + reviewer-hook.test.ts + reviewer-blocking.test.ts
  → 33/33 pass
```

### 4.3 Wider regression (rule-registry / post-unit-hooks / hook-*)

3 pre-existing failures remain:

```
✖ Hook status: no hooks
✖ listRules returns only dispatch rules when no hooks are configured
✖ phase-discipline builtin pre-dispatch runs before generic advise handling
```

Plus two pre-existing failures in `phase-discipline/tests/merge.test.ts`:

```
✖ applyPhaseDisciplinePreset injects preset hooks when milestone_profile is enabled
✖ applyPhaseDisciplinePreset keeps preset pre-dispatch hook before user hooks
```

**Verified pre-existing** via `git stash && npm run test:compile && <same tests>` — the same 5 failures reproduce against the clean tree. They are rooted in preset hook injection / registry side effects and are unrelated to this PR.

---

## 5. Out of scope / deferred

- **Phase 3 — real same-process `continueSession`**: requires CLI `-p --session` continuation protocol, turn framing, headless-mode cancel/timeout coordination, and subagent-terminal parsing updates. A dedicated plan should be written before any attempt.
- **Prompt-level schema self-check in `systemPrompt`**: a low-risk one-liner addition (“please verify the YAML schema before submitting”) would be complementary but is not required for this PR to be correct; it can be added in a follow-up to reduce repair invocations.
- **Fixing the 5 pre-existing test failures in preset merge / registry listing / post-unit-hooks**: out of scope here; flagged for a separate fix.

---

## 6. Review focus areas for the next session

Suggested checklist for the next-session reviewer:

1. **Classification correctness**
   - Walk `runPhaseDisciplineReviewerHook` with one reviewer throwing `ReviewerCoreError("subprocess_failure")` and another throwing `ReviewerCoreError("parse_exhausted")`; confirm `blockedReason === "reviewer_unavailable"`.
   - Confirm all-parse-failure path writes `reviewer_format_invalid` and that fallback artifact's Operator Action section does not instruct the operator to check provider credentials.

2. **Abort / timeout safety**
   - `runReview` checks `signal?.aborted` before every spawn (both initial and repair). Does the `AbortController.abort()` from `runReviewWithTimeout` actually propagate via `input.signal`? Trace the ownership: controller lives in `runReviewWithTimeout`, passes `controller.signal` into `runReviewImpl`. OK.
   - There is still one in-flight child process at abort time that is not killed — it will settle naturally via its own `DEFAULT_SUBAGENT_TIMEOUT_MS`. Is that acceptable, or should we also `spawnGsdSubagentHandle()` and cancel? Current choice: acceptable, since we do not read the late output (the outer race already rejected). Worth confirming.

3. **Parser strictness blast radius**
   - Search for any other caller of `parseReviewerOutput` that relied on silent-drop behavior. Grep shows the only in-tree callers are reviewer-core itself and its test. Confirm no extension/plugin consumers exist.

4. **BLOCKED sentinel body format coupling**
   - `rule-registry.ts` now parses the `Block Reason:` line from the sentinel body. `renderBlockedArtifact` emits that exact line. If these two strings drift, we silently downgrade format failures to unavailable. The conservative default is safe but the invariant deserves a test, which `reviewer-blocking.test.ts` already provides.

5. **Observability coverage**
   - `.phase-discipline/*.json` now contains `reviewerMetrics[i].{failureKind, correctionRounds, formatRepairSucceeded, parseErrorKind, parseErrorMessage}`. Check that downstream dashboards / log consumers (if any) tolerate the new fields.

6. **Behavior change announcement**
   - Parser strict mode is a real behavior change. Callers that were producing "mostly-right" findings will now trigger a repair loop. If any production reviewer was depending on the silent-drop to get past its own malformed outputs, this will surface as more repair spawns (cost) or, worst case, more `reviewer_format_invalid` BLOCKED events.

---

## 7. Pointers for the next session

- Revised plan doc: `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction.md`
- Codex review notes: `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction-review.md`
- This handoff: `docs/superpowers/plans/2026-04-26-reviewer-in-session-format-correction-handoff.md`
- Key source files: `reviewer-core.ts`, `reviewer-hook.ts`, `rule-registry.ts`, `auto-post-unit.ts` (all listed with exact paths in §3).
- Key tests: `shared-harness-reviewer-core.test.ts`, `reviewer-hook.test.ts`, `reviewer-blocking.test.ts`.
- Commands:
  - `npm run test:compile`
  - `node --import ./scripts/dist-test-resolve.mjs --test "dist-test/src/resources/extensions/gsd/tests/shared-harness-reviewer-core.test.js" "dist-test/src/resources/extensions/gsd/phase-discipline/tests/reviewer-hook.test.js" "dist-test/src/resources/extensions/gsd/phase-discipline/tests/reviewer-blocking.test.js"`
  - `npx tsc --noEmit`
