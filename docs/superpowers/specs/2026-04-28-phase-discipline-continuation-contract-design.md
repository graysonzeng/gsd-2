# Phase-Discipline Headless Continuation Contract Design

## 1. Design goal and scope

This design strengthens the user-facing contract for phase-discipline auto-mode when it is driven through `headless auto` or `headless new-milestone --auto`.

The immediate problem is not that phase-discipline cannot complete a milestone. Recent real E2E evidence shows it can complete a seeded milestone after repeated invocations. The problem is that each invocation may only advance the workflow to the next dispatchable unit while still printing a top-level `Status: complete`. That wording is easy to misread as milestone completion.

This design only covers the first, low-risk phase:

- Make headless summary and structured output workflow-aware.
- Keep default exit code behavior compatible.
- Preserve `--fail-on-incomplete` as the strict CI mode.
- Avoid changing auto-loop scheduling, dispatch rules, phase-discipline hooks, provider handling, or milestone artifact semantics.

## 2. Current code reality

The relevant current implementation is split across these files:

- `src/headless.ts`
  - Parses `--fail-on-incomplete`.
  - Runs the headless command.
  - After auto-mode, derives a workflow snapshot from `deriveHeadlessSnapshot()`.
  - Prints summary lines.
- `src/headless-query.ts`
  - Derives current workflow state and next dispatch action.
  - Uses `resolveDispatch()` to determine whether another unit is available.
- `src/headless-events.ts`
  - Defines exit codes.
  - Maps `needs-continue` to `EXIT_INCOMPLETE` when requested.
- `src/headless-types.ts`
  - Already has separate `HeadlessCommandStatus` and `HeadlessWorkflowStatus` concepts.

The current code can already derive `workflowStatus = needs-continue` when `next.action === "dispatch"`, and `--fail-on-incomplete` can already convert that to exit code `12`. The gap is the default summary contract: the primary `Status` line is still command-oriented and can say `complete` even when the workflow is not complete.

Gap summary for this implementation pass:

- Already implemented and should be preserved:
  - `workflowSnapshotFromQuery()` derives `needs-continue` from `next.action === "dispatch"`.
  - `applyFailOnIncompleteExitCode()` upgrades exit code `0 -> 12` only in strict mode.
  - The text summary already prints `Command Status`, `Workflow Status`, `Workflow Phase`, milestone metadata, and `Next` when a workflow snapshot exists.
- Still to implement in this pass:
  - The top-level text `Status:` line should become workflow-aware when the command succeeded but the workflow still needs continuation.
  - The JSON contract must be explicitly documented as command-oriented at the top level, with `workflowStatus` carrying workflow truth.

## 3. Contract decision

The contract should distinguish two layers:

1. Command status
   - Whether the current headless invocation completed successfully.
   - Examples: `complete`, `blocked`, `cancelled`, `error`, `timeout`.
2. Workflow status
   - Whether the GSD workflow/milestone is terminal or still has a next unit.
   - Examples: `complete`, `needs-continue`, `unknown`.

When a workflow snapshot is available, the primary human-facing status should prefer workflow status:

- If `workflowStatus === "needs-continue"`, print top-level `Status: needs-continue`.
- Still print `Command Status: complete` to show the invocation itself succeeded.
- Print `Workflow Status: needs-continue` and `Next: dispatch <unitType> <unitId>`.

Default exit code remains backward-compatible:

- Default `headless auto` exit code remains `0` when command execution succeeded.
- With `--fail-on-incomplete`, `workflowStatus === "needs-continue"` returns exit code `12`.

Compatibility note:

- The top-level text `Status` line becomes workflow-aware for successful auto-mode runs with pending work.
- Scripts that currently grep `Status: complete` as their success signal should switch to `Command Status: complete` or, preferably, inspect the exit code plus `workflowStatus`/`Next`.

## 4. Text output design

Top-level text status follows this priority table:

| commandStatus | workflowStatus | Top-level `Status` |
|---------------|----------------|--------------------|
| `blocked` | any | `blocked` |
| `error` | any | `error` |
| `timeout` | any | `timeout` |
| `cancelled` | any | `cancelled` |
| `needs-continue` | any | `needs-continue` |
| `complete` | `complete` | `complete` |
| `complete` | `needs-continue` | `needs-continue` |
| `complete` | `unknown` | `complete` |
| no snapshot | — | `commandStatus` |

In other words, workflow status only overrides the top-level text status in the single safe case where the command itself completed successfully and the workflow snapshot explicitly reports `needs-continue`.

For a successful command that leaves more workflow work pending, the desired text output shape is:

```text
[headless] Status: needs-continue
[headless] Command Status: complete
[headless] Workflow Status: needs-continue
[headless] Workflow Phase: validating-milestone
[headless] Active Milestone: M006
[headless] Next: dispatch validate-milestone M006
[headless] Duration: 52.9s
[headless] Events: ...
```

For non-auto commands without workflow snapshot, `Status` remains command-oriented.

## 5. JSON output design

Structured output should keep both layers explicit:

- `commandStatus`: command-level status.
- `workflowStatus`: workflow-level status when available.
- `workflow`: snapshot with phase, active milestone, last completed milestone, and next action.
- `status`: remains command-oriented and aligned with exit-code semantics.

JSON top-level `status` is intentionally not workflow-aware in the default mode for this first pass. The reasons are:

- It stays aligned with the default exit-code contract (`exitCode === 0` implies `status: "success"`).
- It avoids the ambiguous combination `exitCode: 0` plus top-level JSON `status: "incomplete"` for default runs.
- Workflow-aware consumers can already read `workflowStatus` and `workflow.next`.

For default mode, workflow continuation must therefore be conveyed by `workflowStatus: "needs-continue"`, not by changing the top-level JSON `status`. Exit code remains controlled by `--fail-on-incomplete`.

The JSON top-level enum keeps the existing `incomplete` value for strict `--fail-on-incomplete` mode. Text mode uses `needs-continue`, while JSON continues to expose `workflowStatus: "needs-continue"` for workflow truth and reserves top-level `status: "incomplete"` for the strict non-zero-exit path.

## 6. Non-goals

This design does not attempt to fix why a real seeded phase-discipline milestone sometimes needs multiple `headless auto` invocations to finish. That may be legitimate loop segmentation or an early terminal-notification issue. It should be investigated after the output contract stops misleading users.

This design does not change:

- `auto/loop.ts` iteration semantics.
- `auto/phases.ts` dispatch/finalize behavior.
- `auto-dispatch.ts` rule ordering or hard-stop rules.
- `phase-discipline` hook order or artifact gates.
- Provider/model readiness handling.
- Default exit code policy.

Follow-up after this contract lands: open a separate investigation under `docs/superpowers/plans/` to track the root cause of the real multi-invocation behavior.

## 7. Error handling and edge cases

- If workflow snapshot derivation fails, keep existing command-level status and print the warning already emitted by `headless.ts`.
- If command status is `blocked`, `error`, `timeout`, `cancelled`, or strict-mode `needs-continue`, do not mask it with workflow status.
- If `workflowStatus === "unknown"`, keep command status as the top-level `Status` and print the workflow details for diagnosis.
- If `--fail-on-incomplete` is set and workflow status is `needs-continue`, return exit code `12` and top-level text status `needs-continue`.

## 8. Verification plan

Add or update focused tests around the headless surface:

1. `workflowSnapshotFromQuery()`
   - `next.action === "dispatch"` produces `needs-continue`.
   - `phase === "complete"` with no active milestone produces `complete`.
2. Summary status resolution
   - Command `complete` plus workflow `needs-continue` prints top-level `needs-continue`.
   - Command `complete` plus workflow `complete` prints top-level `complete`.
   - Command `error` remains `error` even if workflow snapshot exists.
   - Command `blocked` remains `blocked` even if workflow snapshot exists.
   - Command `timeout` remains `timeout` even if workflow snapshot exists.
   - Command `complete` plus workflow `unknown` stays top-level `complete`.
3. Exit code policy
   - Default incomplete workflow keeps exit code `0`.
   - `--fail-on-incomplete` returns exit code `12`.
4. JSON result
   - Includes `commandStatus`, `workflowStatus`, and `workflow.next`.
   - Keeps top-level JSON `status` command-oriented in default mode.
   - Represents incomplete workflow unambiguously through `workflowStatus` without changing default exit code.

A later implementation pass should run targeted headless tests and TypeScript typecheck. Real E2E validation can reuse the seeded phase-discipline repo, but it is not required for the first code-level contract change if focused tests cover the output and exit-code policy.

## 9. Recommended next step

Proceed to implementation with the following locked decisions:

- Text output top-level `Status` becomes workflow-aware only for the `command complete + workflow needs-continue` case.
- JSON top-level `status` remains command-oriented.
- Workflow truth for machine consumers is exposed via `workflowStatus` and `workflow`.

## 10. Revision log

- 2026-04-28
  - Clarified the already-implemented vs still-missing contract pieces.
  - Locked JSON top-level `status` to remain command-oriented in default mode.
  - Added the top-level text status priority table and expanded verification coverage.
  - Added a compatibility note for scripts that grep `Status: complete` and a follow-up investigation note for multi-invocation behavior.
