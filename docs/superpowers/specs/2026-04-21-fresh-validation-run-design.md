# Fresh Validation Run Design Document

## Overview
This design defines a **fresh, validation-only run** for the requirement:

- do not resume a prior run
- do not edit source files
- produce minimal plan artifacts for **research**, **design**, **review**, and **split**

The scope is intentionally narrow. This is not an implementation effort and not a repo-wide audit. The goal is to produce a standalone validation design that uses current repo evidence, stays honest about coverage limits, and leaves clear minimal artifacts for later read-only verification.

The strongest evidence from the research is that the repository already has direct prior art for this exact shape of work:

- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-research.md`
- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-design.md`
- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-review.md`
- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-split.md`

The new run should not resume or extend an old execution state, but it should reuse those artifacts as evidence that the repo already supports this validation-only pattern.

## Approach
The run should be structured as an **evidence-first validation pass**.

### 1. Fresh-run framing
“Fresh” means:

- the conclusions are restated from current repository evidence,
- the run stands on its own,
- prior artifacts are treated as reference material rather than resumed work,
- no code or test files are modified.

### 2. Minimal artifact set
Only four artifact types are in scope:

- research
- design
- review
- split

No implementation plan is needed unless a concrete validation gap is found. Even then, the next step should be a **test-addition plan**, not a source-change plan.

### 3. Use existing high-signal evidence
The research shows the intended validation surface already exists in focused tests, ADRs, and small implementation seams.

Primary evidence set:

- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `src/tests/provider-equality-allowlist.test.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/auto-start.ts`

These files cover the core validation seams:

- model/provider resolution semantics
- bootstrap precedence and snapshot timing
- interactive provider/model selection behavior
- provider failure and fallback behavior
- architectural correctness of `provider` vs `api`

### 4. Keep conclusions proportional to the evidence
This run should make **representative** claims, not exhaustive ones. The research brief is explicit that the evidence budget is narrow and sample-based.

Allowed claim style:
- the highest-signal provider-wiring seams are already test-backed
- the repo has direct prior art for validation-only provider-wiring review
- existing ADRs and tests provide a reasonable review contract

Not allowed:
- every provider path in the repo is exhaustively validated
- runtime behavior has been freshly proven end to end
- no further validation gaps can exist

### 5. Treat implementation files as read-only anchors
Even though no source edits are allowed, a credible validation design should still name the key implementation seams the tests are meant to guard:

- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/auto-start.ts`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`

These are not edit targets. They are read-only anchors that let a reviewer map the tests and ADRs back to current implementation boundaries.

## Key Decisions

### Decision 1: Treat the task as validation-only
No source changes, refactors, or test rewrites are part of this run.

**Reasoning:**
The requirement forbids source edits, and the prior art already matches a minimal validation-only workflow.

### Decision 2: Reuse the existing provider-wiring validation surface
The run should center on the existing targeted tests and ADRs instead of inventing new verification mechanisms.

**Reasoning:**
The repo already treats provider wiring as something guarded by focused tests and architectural rules. That is the right level for a fresh validation pass with no edits.

### Decision 3: Use ADR-012 as the main review rubric
The main conceptual review rule is:

- `provider` identifies transport / credential identity
- `api` identifies wire protocol / behavior shape

The canonical source for that distinction is:

- `docs/dev/ADR-012-provider-id-vs-api-shape.md`

**Reasoning:**
This is the highest-signal correctness risk in provider wiring: using provider identity where API-shape logic is actually required.

### Decision 4: Split the work by evidence type, not subsystem ownership
If the validation is divided, use two small review tracks:

**Track A — Resolution and selection**
- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- read-only anchor: `src/resources/extensions/gsd/auto-model-selection.ts`

**Track B — Bootstrap, architecture, and recovery**
- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `src/tests/provider-equality-allowlist.test.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- read-only anchor: `src/resources/extensions/gsd/auto-start.ts`

**Reasoning:**
This mirrors the repo’s existing test boundaries and avoids inventing new organizational seams for a no-edit task.

### Decision 5: If a gap is found later, add tests before changing code
A future follow-up, if required, should first add or tighten validation coverage.

**Reasoning:**
The current evidence points to test-first validation as the established repository pattern. Jumping straight to implementation changes would exceed the scope of this run.

## File Changes Needed
This task should make **documentation-only** changes.

### Files to create or refresh
The requirement calls for minimal plan artifacts covering:

- research
- design
- review
- split

Those artifacts already exist as strong prior art in:

- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-research.md`
- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-design.md`
- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-review.md`
- `docs/superpowers/plans/2026-04-21-provider-wiring-validation-split.md`

For this task, the new design document is:

- `docs/superpowers/specs/2026-04-21-fresh-validation-run-design.md`

### Files explicitly not to change
No edits should be made to:

- `src/**`
- `packages/**`
- `native/**`
- `web/**`
- `studio/**`
- any test files

## Edge Cases

### Prior artifacts already satisfy most of the requirement
This is expected, not a blocker.

**Handling:**
Treat the existing artifacts as validated prior art. The fresh run should still produce a standalone design instead of pretending the earlier material does not exist.

### Structural tests may be brittle to harmless refactors
The research notes that some tests depend on exact source ordering or source-string assertions.

**Handling:**
If such a test fails in a later execution pass, the failure should be classified carefully as one of:

- actual provider-wiring regression
- structural invariant drift
- test brittleness

This validation design should not assume that every structural failure implies a product bug.

### Local runtime may differ from CI
The repo requires **Node >=22**, while sampled CI evidence uses **Node 24**.

**Handling:**
Any later executable validation should note the runtime used. Results below Node 22 should be treated as untrustworthy for this requirement.

### Evidence is representative, not exhaustive
The research is intentionally narrow.

**Handling:**
Keep claims narrow. This design validates the strongest seams, not every possible provider-related path in the monorepo.

### The requirement might be misread as “run tests now”
This task asks for a design document based on research, not a live test execution report.

**Handling:**
Describe the intended testing strategy and completion criteria without fabricating runtime results.

## Testing Strategy
This pass is design-only, but the testing strategy should be explicit.

### 1. Resolution semantics
Primary files:

- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- read-only anchor: `src/resources/extensions/gsd/auto-model-selection.ts`

Validation goals:

- bare model IDs prefer the current provider when duplicates exist
- provider-qualified IDs resolve deterministically
- case-insensitive matching remains stable
- OpenRouter-style `org/model` IDs remain supported
- interactive disambiguation persists exact `{ provider, id }` values

### 2. Bootstrap precedence and snapshot timing
Primary files:

- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
- read-only anchor: `src/resources/extensions/gsd/auto-start.ts`

Validation goals:

- model snapshot happens before guided-flow mutation points
- manual override is evaluated before preference fallback
- current session model is preferred before repo preference defaults
- custom providers are not overwritten by defaults
- preferred models are validated against the live registry

### 3. Provider recovery and fallback behavior
Primary files:

- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- `packages/pi-ai/src/providers/api-family.ts`

Validation goals:

- transient vs permanent failures are explicitly distinguished
- fallback behavior is test-backed rather than assumed
- provider pause/resume or recovery flows remain structurally covered

### 4. Architectural correctness
Primary files:

- `src/tests/provider-equality-allowlist.test.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`

Validation goals:

- raw provider equality is only used where transport identity matters
- API-family-dependent behavior keys off `api` or API-family helpers
- current implementation still maps cleanly to ADR-012’s model

### Completion criteria
The validation design is complete when:

- the work remains documentation-only,
- the artifact set stays minimal,
- the evidence sources are clearly enumerated,
- the no-edit constraint is explicit,
- the split is small and reviewable,
- the design avoids over-claiming exhaustive coverage.

A later execution pass would be considered successful if those evidence sources can be reviewed or run without requiring code changes, and if any discovered gap is described as a validation gap rather than silently expanded into implementation work.
