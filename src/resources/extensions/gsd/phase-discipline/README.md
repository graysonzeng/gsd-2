# Phase Discipline Preset

This directory implements the opt-in `milestone_profile: phase-discipline-8step` preset for GSD auto-mode.

## Surface

- `preset.ts`
  - Declares the preset-owned post-unit and pre-dispatch hooks.
- `merge.ts`
  - Injects preset hooks when the milestone profile is enabled.
  - User hooks shadow preset hooks by name.
- `profile-map.ts`
  - Defines the authoritative B-min phase ordering.
- `profile-dispatch.ts`
  - Enforces advisory phase ordering through the PR-3a `action: "advise"` path.
  - v1.3: gates P3/P4 on `IMPL-PLAN-VALIDATION.md` containing `- Result: pass` before allowing `execute-task`; anything else advises back to `plan-slice`.
- `reviewer-hook.ts`
  - Executes the built-in code-review and design-review fan-out hooks.
  - Writes review artifacts, retry markers, and `.phase-discipline/*.json` observability logs.
  - Dispatches the builtin impl-plan-validator and verify-fuse hooks inline.
- `scout-fanout.ts` *(v1.2)*
  - Preset-owned builtin **pre-dispatch carrier**. Evaluator returns `action: "proceed"` with a `fanOutSpec` when `research-slice` is selected and no `RESEARCH` artifact exists; `auto/phases.ts::runDispatch()` consumes the spec and executes scouts via `shared-harness/subagent-spawn`.
  - Writes the canonical slice `RESEARCH` artifact plus `.phase-discipline/` observability and raw logs on success; on first-scout failure cancels the remaining scouts and never writes the research artifact.
- `impl-plan-validator.ts` *(v1.3)*
  - Validates `rollback_hint`, `acceptance`, `files[]` in task plan frontmatter; writes `IMPL-PLAN-VALIDATION.md` and, on failure, `IMPL-PLAN-RETRY.md`.
- `verify-fuse.ts` *(v1.4)*
  - Reads `validate-milestone` verdict and writes `VERIFY-FUSE.md` (artifact/audit only).
  - **Does not** block milestone close itself — see "Enforcement ownership" below.
- `findings-carry.ts`
  - Supplies the prompt-only findings-to-memories hook.

## Hook classification

Preset-owned hooks split into two families.

**Built-in hooks (code-backed runtime handler + `builtin` marker):**

- `phase-discipline-profile-dispatch` — pre-dispatch, advises unit ordering
- `phase-discipline-scout-fanout` — pre-dispatch, carrier (see "Carrier semantics" below)
- `phase-discipline-code-review` — post-unit, runs reviewer fan-out
- `phase-discipline-design-review` — post-unit, runs reviewer fan-out
- `phase-discipline-impl-plan-validator` — post-unit, validates task plan frontmatter
- `phase-discipline-verify-fuse` — post-unit, writes fuse audit artifact

The `builtin` marker is restored after preset merge + revalidation (`preferences.ts`). `rule-registry.ts` and `reviewer-hook.ts` use that marker — not hook `name` — to identify built-ins, so a user-authored shadow hook with the same name cannot be mistaken for one.

**Prompt-only preset hooks (no `builtin` marker, legacy prompt path):**

- `phase-discipline-admission`
- `phase-discipline-findings-to-memories`

Retry semantics for prompt-only hooks: when a hook declares `retry_on` and the next cycle is still allowed, `rule-registry.ts` **deletes the main artifact before setting `retryPending`** so the prompt can truly re-emit cycle 2 instead of being short-circuited by idempotency. Do not remove that behaviour without updating admission's contract.

## Carrier semantics (v1.2 scout fan-out)

`phase-discipline-scout-fanout` is a **builtin pre-dispatch carrier**, not a generic prompt-mutating hook.

- In `preset.ts` the config carries `action: "modify"`. That is the minimum shape required to register a `PreDispatchHookConfig` entry; it does **not** describe the runtime behaviour.
- The real runtime behaviour lives in `scout-fanout.ts::evaluatePhaseDisciplineScoutFanOut()`, which returns `action: "proceed"` plus a `fanOutSpec`. The spec is consumed by `auto/phases.ts::runDispatch()` (after dispatch-match / stuck / prior-slice-blocker checks) to run `runPhaseDisciplineScoutFanOut()`.
- `rule-registry.ts` knows to route by the `builtin` marker, so the config's `action: "modify"` never takes the generic mutate path.

**Implication for maintainers:** judging this hook by its config alone is misleading; the authoritative semantics are `proceed + fanOutSpec`. The test at `tests/scout-fanout.test.ts` locks the carrier behaviour.

## Enforcement ownership

Two capabilities split their "advise / record" concern from "actually block" concern, and the split is deliberate:

| Capability | Artifact / advise owner | Real enforcement point |
|---|---|---|
| v1.3 impl-plan validation | `phase-discipline/impl-plan-validator.ts` writes `IMPL-PLAN-VALIDATION.md` / `IMPL-PLAN-RETRY.md` | `phase-discipline/profile-dispatch.ts` gates P3/P4 on `- Result: pass` in the validation artifact |
| v1.4 verify-fuse | `phase-discipline/verify-fuse.ts` writes `VERIFY-FUSE.md` and supplies `shouldBlockMilestoneClose()` | `auto-dispatch.ts` `completing-milestone → complete-milestone` rule (see `src/resources/extensions/gsd/auto-dispatch.ts`, around the `hasExplicitValidationFailure` / `shouldBlockMilestoneClose` call) returns `action: "stop"` when `verify_fuse_on_fail` is set and validation did not pass |

**Implication for maintainers:**

- Changing the fuse artifact alone will **not** change whether milestone close is blocked; `auto-dispatch.ts` is the authority. Keep the two in sync when touching either side.
- Changing `profile-dispatch.ts` advise text is not enough to change P3/P4 gating either — the gate reads `IMPL-PLAN-VALIDATION.md` contents.
- See `tests/remediation-completion-guard.test.ts` for the milestone-close enforcement regression surface.

## Runtime boundary

This implementation stays intentionally narrow:

- No generic hook plugin framework
- No changes to PR-2 `shared-harness/*` (only consumed as library)
- No new PR-3a kernel semantics beyond `PreDispatchResult.fanOutSpec` (added for v1.2)
- `phase-discipline-findings-to-memories` and `phase-discipline-admission` stay on the prompt-only path
- Scheduler (`auto-dispatch.ts`) remains the close-blocking authority; hooks supply evidence and advisories only

## Verification focus

The focused verification surface across v1.0-v1.4 is:

- preset injection and shadow semantics (`tests/merge.test.ts`, `../tests/preferences.test.ts`)
- built-in pre-dispatch routing through `rule-registry.ts` (`../tests/rule-registry.test.ts`, `../tests/pre-dispatch-fanout.test.ts`)
- built-in reviewer short-circuiting before `newSession()` (`tests/reviewer-hook.test.ts`)
- review artifact / retry / observability outputs (`tests/reviewer-hook.test.ts`, `tests/scout-fanout.test.ts`)
- integration coverage that the preset survives merge + revalidation in the real preference loader (`../../../../tests/phase-discipline-integration.test.ts`)
- v1.3 gating via validation artifact text (`tests/profile-dispatch.test.ts`, `tests/impl-plan-validator.test.ts`)
- v1.4 milestone-close enforcement via `auto-dispatch.ts` (`../tests/remediation-completion-guard.test.ts`)
