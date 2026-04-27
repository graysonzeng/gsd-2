# Phase-Discipline Readiness Guard Design

**Status:** Draft  
**Created:** 2026-04-27  
**Author:** AI Assistant  
**Related:** phase-discipline auto-mode loop, pre-dispatch hooks

## Problem Statement

Current phase-discipline auto-mode loop has "too narrow" startup preflight and "too distributed" gate semantics. Many input-integrity checks only happen at dispatch or post-unit review, causing:

- Missing artifact progress into wrong phase (e.g., execute-task without PLAN.md)
- State-inconsistency discovered too late
- Multiple invocation patterns (user must resume multiple times to real progress)

Goal: Add **L1 readiness guard** at pre-dispatch stage to block "not-ready" dispatch early, before soft advice or execution.

## Scope

**In scope (first batch):**
- New hook: `phase-discipline-readiness-guard`
- Target units: `plan-slice`, `execute-task`
- Check minimum input artifact existence (not quality)
- Behavior: `proceed` | `advise` (safe redispatch) | `block` (warning/error)

**Out of scope:**
- Artifact quality evaluation (covered by post-unit review)
- Scout generation (remains in `scout-fanout`)
- State derivation refactor (remains in `deriveState`)
- Research-slice deep gate (handled by existing scout-fanout)
- Refine-slice deep gate (progressive planning remains independent)
- Headless invocation continuity (separate work)

## Design Overview

### Hook Position in Pipeline

Preset pre-dispatch hook order becomes:

1. `phase-discipline-phase-guard` (existing, covers validate/complete)
2. `phase-discipline-readiness-guard` **(new, this design)**
3. `phase-discipline-profile-dispatch` (soft advice, backoff)
4. `phase-discipline-scout-fanout` (generation)

Reason: readiness-guard must run **before** soft advice to own authoritative gating semantics. After advise-redispatch, hooks do not re-run in current loop implementation.

### Input/Output Contract

**Input (existing hook interface, unchanged):**
- `unitType: string`
- `unitId: string`
- `prompt: string`
- `basePath: string`

**Output (PreDispatchResult):**

| action | meaning | use case |
|--------|---------|----------|
| `proceed` | input complete | normal dispatch |
| `advise` | can auto-recover | `plan-slice` missing research → advise `research-slice` |
| `block` | cannot auto-recover | missing PLAN.md, unknown task, pending gate/replan/escalation |

Block carries:
- `level`: `"warning"` (pause) | `"error"` (stop)
- `reason`: human-readable
- `issues`: array of `{code, level, detail, remedy, unitType, unitId}`

### Artifact Helpers

Reuse existing canonical helpers (do not reimplement derivation):

- `resolveSliceFile(basePath, milestoneId, sliceId, "RESEARCH")`
- `resolveSliceFile(basePath, milestoneId, sliceId, "PLAN")`
- `getSliceTasks(milestoneId, sliceId)` (DB)
- `resolveTaskFile(basePath, milestoneId, sliceId, taskId, "SUMMARY")`
- `getPendingGateCountForTurn(...)`
- `checkReplanTrigger(...)`
- `detectPendingEscalation(...)`

Principle: readiness-guard only **reads** artifact/DB state; it does **not** modify.

## Detailed Rules

### Global Step 1: Ignore Non-Target Units

If `unitType` not in `{"plan-slice", "execute-task"}`, return `{action: "proceed"}`.

### Global Step 2: Parse unitId

Parse milestone/slice/task identifiers.

- Parse fail → `block error`, code: `invalid_unit_id`

### Global Step 3: Validate Base Paths

- Milestone directory exists
- Slice directory exists
- Fail → `block error`, code: `slice_not_found`

### plan-slice Specific

| condition | action | code |
|-----------|--------|------|
| RESEARCH.md exists | `proceed` | — |
| RESEARCH.md missing | `advise research-slice` | `research_artifact_missing` |

Note: Research generation remains `scout-fanout` responsibility.

### execute-task Specific

| condition | action | level | code |
|-----------|--------|-------|------|
| PLAN.md missing | `block` | warning | `plan_artifact_missing` |
| taskId not found in plan/DB | `block` | warning | `task_not_found` |
| task plan file missing | `block` | warning | `task_plan_missing` |
| pending gate-evaluate | `block` | warning | `pending_gate_evaluate` |
| replan trigger | `block` | warning | `replan_required` |
| pending escalation | `block` | warning | `pending_escalation` |
| all pass | `proceed` | — | — |

## Error Handling

### Warning Level (Pause Auto)

Used for "fixable by user command or later" situations:
- Missing PLAN.md → user should run plan-slice first
- Task/pending gate/replan/escalation → user should resolve

Effect in `runDispatch`:
- `ctx.ui.notify(reason, "warning")`
- `await deps.pauseAuto(ctx, pi)`
- Journal event: `pre-dispatch-hook` with `action: "block"`, `level: "warning"`

### Error Level (Stop Auto)

Used for "state contradiction" situations:
- Invalid unitId
- Slice not found
- DB/task inconsistency

Effect in `runDispatch`:
- `ctx.ui.notify(reason, "error")`
- `await closeoutAndStop(ctx, pi, s, deps, reason)`
- Journal event: `pre-dispatch-hook` with `action: "block"`, `level: "error"`

## Observability

Minimal: reuse existing pre-dispatch hook journal events.

Event type: `pre-dispatch-hook` already emitted by `runDispatch`. Fields include:
- `firedHooks: ["phase-discipline-readiness-guard"]`
- `action`: `"proceed" | "advise" | "block"`
- `advisedUnitType` (if advise)
- `level`, `reason`, `issues` (if block)

No new JSON observability file for this hook (scout-fanout needs it for concurrent subagents; readiness-guard is synchronous single-check).

## Testing Strategy

### Unit Tests (Pure Functions)

Test `evaluatePhaseDisciplineReadinessGuard(...)` directly with mock basePath + injected artifact/DB state.

**plan-slice:**
- research exists → proceed
- research missing → advise research-slice
- invalid unitId → block error
- slice not found → block error

**execute-task:**
- plan exists, task valid → proceed
- plan missing → block warning
- task not found → block warning
- pending gate → block warning
- replan trigger → block warning

### Integration Tests

**Hook order verification:**
Confirm preset order: phase-guard → readiness-guard → profile-dispatch → scout-fanout

**Loop behavior:**
- plan-slice advise path leads to research-slice dispatch in next iteration
- execute-task block leads to pause with clear message

### Non-Regression

- phase-guard validate/complete behavior unchanged
- profile-dispatch soft advice still functional
- scout-fanout research generation still functional

## Non-Goals (Explicitly Out of Scope)

1. Quality evaluation of RESEARCH.md or PLAN.md content
2. Scout generation logic (stays in scout-fanout)
3. State derivation refactor (stays in deriveState)
4. Research-slice deep gating (handled by scout-fanout pause-on-fail)
5. Refine-slice deep gating (progressive planning remains independent)
6. Headless invocation continuity improvements
7. New comprehensive readiness framework beyond these two units
8. Changing post-unit review semantics
9. Adding state to pre-dispatch hook interface
10. Modifying deriveState to support this guard

## Rollout Plan

1. Implement `readiness-guard.ts` with evaluate function
2. Add to `preset.ts` pre-dispatch hooks (position #2)
3. Unit tests for evaluate function
4. Integration test for hook order and loop behavior
5. Non-regression verification on existing phase-guard/profile-dispatch/scout-fanout
6. Documentation update

## Open Questions

None at design approval. Questions resolved during design:
- Q: Should guard cover research-slice? A: No, scout-fanout handles.
- Q: Should guard evaluate artifact quality? A: No, post-unit review handles.
- Q: Should guard use state? A: No, keep interface minimal.
- Q: Advise vs block for missing research? A: Advise (safe auto-recover).
- Q: Block level for missing PLAN? A: Warning (pause, fixable).

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-27 | New hook instead of extending profile-dispatch | Keep soft advice separate from hard gate |
| 2026-04-27 | Hook order: after phase-guard, before profile-dispatch | Gate must own semantics before soft advice can redirect |
| 2026-04-27 | First batch: plan-slice, execute-task only | Minimal viable gate; research/refine handled elsewhere |
| 2026-04-27 | No state in hook interface | Minimal change, reuse existing helpers |
| 2026-04-27 | Readiness guard only reads, never writes | Clear boundary with deriveState and post-unit hooks |
| 2026-04-27 | Advise for missing research, block for missing plan | Safe auto-recover vs must-fix distinction |

## Appendix: Issue Codes

| Code | Level | When |
|------|-------|------|
| `invalid_unit_id` | error | Cannot parse milestone/slice/task from unitId |
| `slice_not_found` | error | Slice directory does not exist |
| `research_artifact_missing` | advise | RESEARCH.md missing for plan-slice |
| `plan_artifact_missing` | warning | PLAN.md missing for execute-task |
| `task_not_found` | warning | taskId not in plan/DB |
| `task_plan_missing` | warning | Task plan file not found |
| `pending_gate_evaluate` | warning | Pending quality gates for slice |
| `replan_required` | warning | Replan trigger active |
| `pending_escalation` | warning | Escalation awaiting user decision |

---

**Next Step:** Implementation plan via `writing-plans` skill after design approval.
