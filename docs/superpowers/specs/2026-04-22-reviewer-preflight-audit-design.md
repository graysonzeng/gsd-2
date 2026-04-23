# Reviewer Preflight Audit Design Document

## Overview
This document defines a minimal design for the next step in the composed-lite reviewer zero-progress stall investigation.

The current blocker is narrow and already well-supported by runtime evidence:

- Phase 1 is no longer the active blocker in the latest real validation.
- The Phase 2 reviewer still reaches assistant `message_start` and then stalls with:
  - `assistant_started=yes`
  - `message_updates=0`
  - `tool_uses=0`
  - `output_chars=0`
- Recent audit enhancements already record prompt sizing, tool restriction, raw log path, stderr size, and exit code.

The next change should not try to fix the reviewer yet. It should improve the evidence available before reviewer spawn so the next real run can answer a sharper question:

- did the reviewer have the expected startup inputs and readiness state,
- or was the system already in a degraded state before the 180000ms stall window even began?

This design therefore adds a **reviewer preflight audit-only layer** in `review-harness.ts`.

It does **not** introduce a new provider probe, does **not** change retry behavior, and does **not** alter the success/failure semantics of the current reviewer path.

## Approaches Considered

### Approach 1: Audit-only preflight before reviewer spawn
Before calling `spawnReviewer()`, collect and persist a structured preflight snapshot describing the reviewer invocation setup.

Pros:

- lowest risk
- preserves current runtime behavior
- gives the next real run materially better evidence
- avoids inventing a second execution path

Cons:

- does not directly repair the stall
- still requires at least one future real validation to observe the improved evidence

### Approach 2: Fail-fast preflight when provider is not ready
Perform preflight and immediately throw `review_unavailable` if provider readiness is known and false.

Pros:

- avoids wasting the full timeout budget in clearly invalid configurations
- improves operator feedback for obvious readiness failures

Cons:

- only helps when readiness is explicitly false
- does not help the current dominant case where assistant start is observed and the stall happens after launch
- changes runtime behavior, which is undesirable before diagnostic coverage is complete

### Approach 3: Add a separate micro-probe reviewer request
Run a tiny reviewer-specific probe before the real reviewer invocation.

Pros:

- might expose provider-side issues earlier
- could isolate startup failures from task-size effects

Cons:

- adds a second runtime path that can drift from the real reviewer path
- risks consuming extra budget and adding new failure modes
- is too invasive for the current diagnostic stage

## Recommended Approach
Use **Approach 1: audit-only preflight**.

This is the smallest change that improves the next real validation without distorting the behavior under investigation.

## Architecture

### Existing path
The current Phase 2 review path is:

- `src/resources/extensions/gsd/composed-lite/phases/p2-design.ts`
- `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
- `src/resources/extensions/gsd/composed-lite/subagent-terminal.ts`

Today `review-harness.ts` already records:

- prompt sizing fields on reviewer `subagent_call`
- result-side fields on reviewer `subagent_result`

But it still lacks an explicit reviewer-startup snapshot that answers whether the invocation was assembled exactly as intended before the spawn begins.

### Proposed change
Add a small preflight helper inside `review-harness.ts` that prepares a structured payload before the first reviewer attempt.

The payload is written to audit as a dedicated event or an explicitly named reviewer preflight payload adjacent to the reviewer call.

The preflight helper must remain:

- synchronous
- local-only
- side-effect free except for audit emission
- independent of actual provider requests

## Preflight Data To Capture

### Identity and invocation assembly
Record:

- `reviewer_model`
- `reviewer_provider`
- `model_arg`
- `max_retries`
- `tool_restriction`
- `appended_system_prompt`

### Readiness metadata
If readiness can be determined from available context, record:

- `provider_ready_check_available`
- `provider_ready`

If the check is unavailable in the current context, record that explicitly instead of guessing.

### Prompt-file readiness
Record:

- `system_prompt_path`
- `system_prompt_file_exists`
- `system_prompt_chars`

### Task sizing context
Retain and align with the fields already added on reviewer `subagent_call`:

- `review_prompt_chars`
- `target_content_chars`
- `task_chars`

The preflight design does not duplicate these unnecessarily if the same event already carries them, but the final audit surface must make the startup state legible in one place.

## Key Decisions

### Decision 1: Preflight is audit-only
The preflight layer does not make network calls, spawn extra processes, or run a mini-reviewer probe.

Reasoning:

The current goal is to sharpen evidence, not create a second runtime path.

### Decision 2: No new fuse or fail-fast behavior in this iteration
Even if readiness is known and false, this iteration records the state but does not change the review harness outcome rules.

Reasoning:

Changing behavior too early would make it harder to compare the next run against the already-observed zero-progress stall.

### Decision 3: Review-harness owns the new evidence
The preflight belongs in `review-harness.ts`, not `p2-design.ts`.

Reasoning:

The harness is the true reviewer invocation boundary and already owns reviewer-specific system prompt creation, spawn, parsing, retry, and audit identity.

### Decision 4: ModelRegistry readiness is optional, not assumed
If `ctx.modelRegistry.isProviderRequestReady` is available through the phase/request context, it may be threaded into the review harness and used.

If not available, the preflight should record the absence of that signal rather than fabricating a readiness result.

Reasoning:

This keeps headless/test contexts valid while still taking advantage of richer runtime state when available.

## File Changes Needed

### Files to modify
- `src/resources/extensions/gsd/composed-lite/review-harness.ts`
- `src/resources/extensions/gsd/composed-lite/phases/p2-design.ts` only if needed to pass readiness context into the harness
- `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts`

### Files likely not to change
- `src/resources/extensions/gsd/composed-lite/subagent-spawn.ts`
- `src/resources/extensions/gsd/composed-lite/subagent-terminal.ts`

Those files already surface timeout/result-side evidence. This iteration targets startup/pre-spawn evidence only.

## Edge Cases

### Readiness check unavailable in headless or tests
Handling:

Record:

- `provider_ready_check_available=false`
- `provider_ready=null` or equivalent explicit absence

Do not downgrade the reviewer path solely because the richer check is unavailable.

### System prompt file creation succeeds but later spawn still stalls
Handling:

This remains a valid failure outcome. The value of preflight is that it proves the reviewer invocation was assembled correctly before stall.

### System prompt file creation fails
Handling:

This should still surface through the existing execution path as an error, but preflight should capture whether the expected file path existed before spawn.

### Readiness is false but assistant-start stall still occurs in other environments
Handling:

Do not overgeneralize a single readiness signal. Treat it as one diagnostic input, not a final root-cause verdict.

## Testing Strategy

### Structural regression coverage
Update `src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts` to assert that reviewer preflight records:

- reviewer identity and `model_arg`
- prompt/system-prompt assembly fields
- provider readiness availability fields
- audit-only behavior without provider probe logic

### Verification after implementation
Run:

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/composed-lite-runtime-regression.test.ts src/resources/extensions/gsd/tests/composed-lite-subagent-spawn.test.ts`
- `npx tsc --noEmit --project tsconfig.json`

## Success Criteria
A successful implementation of this design provides all of the following:

- the next reviewer run exposes a clear pre-spawn startup snapshot in audit
- the reviewer path behavior is otherwise unchanged
- no new runtime probe path is introduced
- regression tests lock the new evidence surface in place

## Out Of Scope
This design does not include:

- increasing reviewer timeout
- adding a separate reviewer probe request
- changing retry counts
- changing fuse semantics
- changing `subagent-spawn.ts` timeout behavior
- claiming root cause has been found
