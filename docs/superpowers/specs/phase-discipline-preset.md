# Auto-Mode Phase Discipline Preset (v7.1 — design draft with required kernel deltas)

> **File note** — this file keeps its git history from `composed-lite-harness-brainstorm.md` (renamed 2026-04-23 after v5→v6 pivot). v7 added a B-min 8-step profile skeleton; v7.1 applied a receiving-code-review pass on the same day that identified 8 factual and structural issues (see §16 for full list). **The document is now a design draft — not accepted for implementation — because landing requires kernel deltas to `PreDispatchResult` that were incorrectly described as "existing" in v7.** The v1–v5 history is compressed to §16's changelog with one-line entries. Two orthogonal specs were split out in the v6 rewrite:
>
> - **AGENTS.md docs-map v1** → `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md`
> - **CLI tool-restriction chain (M0)** → `docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md`
>
> An integration overview spanning all three specs lives at `docs/superpowers/specs/README.md`.

## 0. Summary & scope

**What we are building (v1 — B-min):** an opt-in preference `milestone_profile: "phase-discipline-8step"` that (a) turns on the same three `post_unit_hooks` as v6 (code-review / design-review / findings-to-memories) **and** (b) attaches a lightweight scheduler advisory skeleton that forces an `auto-mode` milestone to traverse the 8 composed-lite phases in order, using unit types the scheduler already has. No new execution layer, no overlay, no separate runtime. v1 is the minimum skeleton that lets v1.1–v1.4 migrate composed-lite's remaining capabilities (admission, scout fan-out, impl-plan-YAML, verify-fuse) one by one without rework.

**Required kernel deltas for v1** *(v7.1 correction of v7's "reuse existing pipeline" claim)* — landing the B-min skeleton requires contract changes that v7 described as already existing but are in fact missing:

- `PreDispatchResult` needs a scheduler-advisory field so a pre-dispatch hook can recommend a different `unitType` / `unitId` than the scheduler picked. Exact shape is in §3.1a (two candidate shapes, both minimal). Without this, the skeleton cannot bias ordering.
- `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` do NOT currently take a `milestoneId` parameter — v1 does not add one; per-milestone opt-out is deferred to v1.1 and NOT included in v1 scope.
- These kernel deltas are collected in PR-3a (§9); the `phase-discipline/` extension code is PR-3b, consuming PR-3a's new contract.

**Why B-min over pure preset (v6's L1+L2 only):** v6's three hooks add cross-review to task / slice units but do not restore the composed-lite quality guarantees that come from *phase ordering* (admission before research, research before design, design before split, split before implementation, implementation before verification). Without the skeleton, adding admission or impl-plan-YAML in v1.1 would require revisiting the preference shape; with the skeleton, each capability slots in as a pre/post-unit hook under the existing profile. See §3.1a and §12.

**What v1 covers:**

- `execute-task` code-review cross-review loop (L1) — same as v6
- `plan-slice` / `refine-slice` design-review cross-review loop (L2) — same as v6
- `complete-slice` findings-to-memories promotion — same as v6
- `milestone_profile: "phase-discipline-8step"` 8-step scheduler skeleton — **new in v7** (§3.1a, §3.1b)
- Hook-conflict resolution rules (name shadowing + missing `cross_review` default) — **new in v7** (§3.2.1)
- Docs-map ↔ preset context-flow contract — **new in v7** (§4.5)
- Observability v1 (`.phase-discipline/*.json` per-hook structured log) — **new in v7** (§6.2)

**What v1 does NOT cover (deliberate, not accidents; all have explicit v2 migration slots — see §12):**

- `composed-lite` P0 admission gate (reinstated in v1.1 — §12)
- `composed-lite` P1 scout fan-out (reinstated in v1.2 — §12; requires new `PreDispatchHookConfig` action type)
- `composed-lite` P3 impl-plan YAML schema (reinstated in v1.3 — §12)
- `composed-lite` P5 verify-fuse strict mode (reinstated in v1.4 — §12)
- Cross-milestone `pending-findings.yaml` (ADR-013 memories channel is enough for v1)
- Machine verification hook (`enhanced_verification` already covers it — identified as duplicate in §3.4)
- Adaptive phase skipping (e.g. docs-only task skips P5) — tracked in §15 OQ-5

**Rejected entirely:**

- Any new `auto-mode` overlay layer (v4.1's PD1–PD9 matrix, `OVERLAY-STATE.json` sidecar) — v5 retired this; v6/v7 reconfirm
- Any `--phase-discipline` CLI flag — preference-only
- Any `RuntimeOwnedExecutor` interface generalisation on `main`
- `composed-lite` runtime upstream migration as a parallel main entry — the B-min skeleton is the migration path; runtime stays on `feat/composed-lite-runtime-owned` as Lab until §12 v1.4 capability parity, then deleted
- Adding a new `reviewer_model?` field — `PostUnitHookConfig.model?` already exists on `main` and is reused
- `SHARED_HARNESS_API_VERSION` runtime version protocol — TypeScript signatures already cover compat for a 5-file in-monorepo extraction

## 1. Context & problem

`auto-mode` provides adaptive unit scheduling on top of 16 unit types (verified from `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts`: `discuss-milestone`, `plan-milestone`, `research-milestone`, `plan-slice`, `refine-slice`, `research-slice`, `replan-slice`, `execute-task`, `reactive-execute`, `gate-evaluate`, `complete-slice`, `complete-milestone`, `reassess-roadmap`, `rewrite-docs`, `run-uat`, `validate-milestone`). It has two gaps relative to a composed-lite-shaped workflow:

1. **No multi-model cross-review contract** — every unit runs on the session model with no explicit reviewer.
2. **No forced review loop per slice** — review happens only when a user manually triggers `refine-slice`.

**v6's insight** — `auto-mode`'s **existing** `post_unit_hooks` engine already gives us the three semantics we need:

| composed-lite concept | existing `auto-mode` capability |
|---|---|
| `max_review_rounds` exhaustion → review deferred | `max_cycles` + exhaustion → hook yields, artifact carries findings |
| Review findings injected into next task prompt | `artifact` auto-picked by `buildCarryForwardSection` |
| Reviewer runs under own subagent | `runPreDispatchHooks` / `checkPostUnitHooks` already spawn hook execution state |
| Per-reviewer retry semantics | `retry_on` (file-name match; `PostUnitHookConfig` has no `retry_pattern` field — v6/v7 referenced one that does not exist) |
| Hook-on-hook prevention + idempotency + cycle-limit | `rule-registry.evaluatePostUnit` already implements |

**The sole genuine gaps** (closed by v1):

- No **fan-out** to N parallel reviewers on the same hook invocation
- No explicit `provider` override alongside `model` (only `model` is implicit provider hint today)

Both gaps are closed by 2 new optional fields on `PostUnitHookConfig` (+ 1 on `PreDispatchHookConfig`). Nothing else changes in the hook engine.

**v7 adds one more narrow gap:** `auto-mode`'s scheduling is adaptive (good default), but has no way to say *"for this milestone, walk the 8 composed-lite phases in order"*. The B-min skeleton (§3.1a + §3.1b) closes that gap by adding a single `milestone_profile` preference and a `profile-dispatch.ts` pre-dispatch hook that biases the scheduler's next-unit choice when the profile is opted in. The scheduler internals (unit-selection heuristics) remain untouched; **but the pre-dispatch hook contract itself needs a scheduler-advisory field** — the current `PreDispatchResult` only supports `modify` / `skip` / `replace` of the already-chosen unit, not "advise a different unit". This is the required kernel delta of §3.1a, caught by the v7.1 receiving-code-review pass.

**Explicit non-goal statement** *(added 2026-04-23 after third receiving-code-review)* — `"phase-discipline-8step"` in v1 is **not** a fully enforced 8-phase workflow, and is **not** composed-lite parity. It is an **8-phase ordered skeleton with partial hard gating (P4→P5 only)**. Phases P0/P1/P2/P3/P5/P6 are soft-gated (advisory only); `auto-dispatch.ts` can override the advice. P7 is out-of-band. Readers expecting composed-lite discipline parity should wait for v1.4 — see §12 capability-migration roadmap.

## 2. Confirmed facts about `main`'s baseline (verified 2026-04-23)

### 2.1 Hook engine is already first-class

- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts:320-321` — `post_unit_hooks?: PostUnitHookConfig[]` and `pre_dispatch_hooks?: PreDispatchHookConfig[]` live on `GSDPreferences`
- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/rule-registry.ts:86-108` — `listRules()` calls `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` fresh on every invocation (no memoization)
- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/post-unit-hooks.ts` — thin facade over `RuleRegistry`; `hook-state.json` persistence already exists
- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/types.ts:274-296` — `PostUnitHookConfig` **already has `model?: string`** (and `artifact`, `retry_on`, `max_cycles`, `agent`, `enabled`)

### 2.2 Machine verification is already built-in

- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/verification-gate.ts` — discovery chain: `preference.verification_commands` → `task.verify` → `package.json` `typecheck/lint/test`
- `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-verification.ts` — runs typecheck/lint/test + `captureRuntimeErrors` + `runDependencyAudit` + auto-fix retry + persists evidence JSON
- `enhanced_verification` default-on; `enhanced_verification_pre` / `_post` / `_strict` all present
- `MAX_VERIFICATION_RETRIES` + `verificationRetryCount` already provides retry
- `validate-milestone` unit type has its own verdict mechanism

**Consequence** — the "cmd-verify" hook v5 OQ-1 proposed is a duplicate capability; it is deleted in v6 (not deferred).

### 2.3 `composed-lite/` exists ONLY on the feat branch (v7.1 correction)

**v6 and v7 incorrectly claimed "`main` already contains 30 `composed-lite` files".** Re-verified 2026-04-23:

```
$ git ls-tree -r origin/main --name-only -- src/resources/extensions/gsd/composed-lite | wc -l
0
$ git ls-tree -r feat/composed-lite-runtime-owned --name-only -- src/resources/extensions/gsd/composed-lite | wc -l
34
```

`main` does NOT contain the composed-lite runtime. The dispatcher special-cases referenced in v6 (`commands-workflow-templates.ts`, `commands/handlers/workflow.ts`) reference the **concept** of composed-lite but land zero runtime dispatch because `registry.json` on `main` has no composed-lite template entry AND the runtime files are not in the tree. These are not "dead code files" — they simply never existed on main.

**Consequences for this spec:**

- §12's retirement action no longer needs "`git rm -r composed-lite/` on `main`" — there is nothing on main to remove. The retirement action collapses to "archive `feat/composed-lite-runtime-owned` as tag + delete branch".
- PR-2 (`shared-harness/` extraction) still happens on `feat/composed-lite-runtime-owned` because the source files only exist there. After PR-2 lands, `shared-harness/` arrives on `main` via normal PR merge; `composed-lite/` itself never arrives.
- Upgrade friction for the Lab is bounded by the size of the feat branch, not by `main` carrying dead code.

### 2.4 `feat/composed-lite-runtime-owned` contents

34 files inside `src/resources/extensions/gsd/composed-lite/` including `runner.ts`, `state.ts`, `phases/p0-p7`, `review-harness.ts`, `audit-log.ts`, `subagent-spawn.ts`, `subagent-terminal.ts`, `pending-review-findings.ts`, plus preflight/anti-drift guards added during v3.x–v6 investigations. These are the runtime the v1.1–v1.4 capability migration will cannibalise — see §12.

## 3. Design (A + a' + Ω1 + Φa + L1+L2 + Π₈)

Locked decisions from the v6 brainstorm pass (2026-04-23), with one revision (a → a') and one addition (Π₈) in v7:

| # | Decision | Consequence |
|---|---|---|
| **A** | Max-reuse existing hook engine, preferences, rule-registry | No overlay skeleton, no sidecar state, no flag |
| **a'** *(v7 revision of v6's a)* | Slice-internal discipline stays; milestone-level scheduling gains one opt-in ordering mode via pre-dispatch hook | No overlay, no matrix; one new pre-dispatch hook only fires when `milestone_profile` is set |
| **Ω1** | Code lives inside `gsd` extension as `phase-discipline/`, sibling to `composed-lite/` | No new extension, no cross-extension contract |
| **Φa** | Migrate only 4 shared primitives; `composed-lite` runtime stays on `feat` as Lab, deleted at v1.4 capability parity | `/gsd start composed-lite` is not a `main` user entrypoint — the B-min skeleton is |
| **L1+L2** | v1 hooks cover code-review (L1) + design-review (L2) + findings-to-memories | Admission (L4), scout fan-out (L3), impl-plan-YAML (L3), verify-fuse slot into v1.1–v1.4 under the same skeleton |
| **Π₈** *(new in v7)* | Opt-in `milestone_profile: "phase-discipline-8step"` forces 8-phase order via pre-dispatch hook | Quality guarantees from ordering (not just review) are restored without a separate runtime; see §3.1a, §3.1b |

### 3.1 Opt-in surface

`@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts` gains a single field on `GSDPreferences`:

```ts
milestone_profile?: "auto" | "phase-discipline-8step";
```

`undefined` ≡ `"auto"` ≡ byte-identical legacy behaviour. `"phase-discipline-8step"` activates both (a) the three `post_unit_hooks` of §3.3 **and** (b) the 8-step scheduler advisory skeleton of §3.1a.

**v1 does NOT support per-milestone opt-out** *(v7.1 correction of v7)*. v7 claimed "per-milestone overrides use the existing `milestone_overrides` mechanism (no new code)" — that mechanism does not exist in `src/` (verified via grep on 2026-04-23). v1 scope is global preference only; adding `milestoneId`-aware `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` plus a `milestone_overrides` YAML block would be another 2 kernel changes and is deferred to v1.1 (see §15 OQ-12).

**v6's field `phase_discipline?: boolean | "phase-discipline-v1"` is dropped in v7.** Rationale: a single field expressing both *"which preset of hooks"* and *"which milestone ordering"* is cleaner than two fields, and no v1 preset exists without the skeleton. If a future user wants hooks without ordering, they can author their own hook list against the `cross_review` surface (§3.2) — that path is still open; it just does not have a named preset in v1.

### 3.1a `milestone_profile: "phase-discipline-8step"` — the B-min skeleton (REQUIRES KERNEL DELTA)

When the profile is active, a single pre-dispatch hook `phase-discipline-profile-dispatch` runs inside `runPreDispatchHooks()` and advises the scheduler against the ordered sequence in §3.1b. v7 described this advisory as "already honoured by the existing pipeline"; v7.1 corrects that: **the current pre-dispatch contract cannot express advisory**. Landing v1 requires one of two minimal kernel deltas (Δ-K1 or Δ-K2 below); Δ-K1 is the recommended shape.

#### Current kernel surface (verified 2026-04-23)

`@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/types.ts:413-447`:

```ts
interface PreDispatchHookConfig {
  action: "modify" | "skip" | "replace";  // modify the prompt, skip the unit, or swap its type
  // ...
}
interface PreDispatchResult {
  action: "proceed" | "skip" | "replace";
  prompt?: string;
  unitType?: string;  // for "replace" only
  model?: string;
  firedHooks: string[];
}
```

`runPreDispatchHooks()` (`rule-registry.ts:276-337`) runs **after** the scheduler has already chosen `{unitType, unitId, prompt}`. It can swap `unitType` (via `replace`) but cannot choose a different `unitId`, and cannot communicate "please pick a different unit next time" back upward.

#### Δ-K1 — recommended kernel delta (adds scheduler advisory) — PR-3a scope

Extend `PreDispatchHookConfig.action` with `"advise"` and extend `PreDispatchResult` with optional next-unit fields:

```ts
interface PreDispatchHookConfig {
  action: "modify" | "skip" | "replace" | "advise";  // + "advise"
  // ...
}
interface PreDispatchResult {
  action: "proceed" | "skip" | "replace" | "advise";
  prompt?: string;
  unitType?: string;
  unitId?: string;         // new
  advisedUnitType?: string; // new
  advisedUnitId?: string;   // new
  model?: string;
  firedHooks: string[];
}
```

When `runPreDispatchHooks()` returns `{action: "advise", advisedUnitType, advisedUnitId}`, the advisory is consumed by the real dispatch pipeline in `auto/phases.ts::runDispatch()`: the loop first resolves its normal dispatch candidate, then runs pre-dispatch hooks on that candidate, and if the result is advisory it performs **one** second `resolveDispatch(...)` call with `DispatchContext.advisedUnit` populated. If the advised unit is runnable, that second dispatch wins; otherwise the existing stock rules fall back to the original adaptive choice and log that the advice was not honoured. Legacy pre-dispatch hooks keep the `modify/skip/replace` semantics.

**Required consumer-side surface (validated against live code path on 2026-04-23):**

- `types.ts` — add `"advise"` to `PreDispatchHookConfig.action`, and add `advisedUnitType?` / `advisedUnitId?` to `PreDispatchResult`
- `rule-registry.ts` — propagate `action: "advise"` through `evaluatePreDispatch()` unchanged
- `auto/loop-deps.ts` — widen `LoopDeps.runPreDispatchHooks(...)` return type to include `advisedUnitType?` / `advisedUnitId?` / `unitId?`
- `auto/phases.ts::runDispatch()` — after the first `resolveDispatch(...)`, call `runPreDispatchHooks(...)`, emit advisory journal/notification payloads, and when advice is present perform a second `resolveDispatch(...)` with `advisedUnit` set
- `auto-dispatch.ts` — add the `honour-phase-discipline-advice` prefix rule that consumes `DispatchContext.advisedUnit`

##### Integration with `DISPATCH_RULES` *(added 2026-04-23 after third receiving-code-review)*

The third receiving-code-review pass flagged that `auto-dispatch.ts` is a **rule-driven selector** (`DISPATCH_RULES: DispatchRule[]` linear-match array at `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts:197`), not a generic scheduler that natively accepts "force this unit". The ~20-line estimate above assumes a specific integration path, spelled out here to prevent semantic drift during PR-3a implementation:

**Chosen path: insert a prefix rule.** PR-3a adds exactly one new entry at index 0 of `DISPATCH_RULES`:

```ts
{
  name: "honour-phase-discipline-advice",
  match: async (ctx) => {
    const advice = ctx.advisedUnit; // new field on DispatchContext, populated from runPreDispatchHooks()
    if (!advice) return null;
    // Reuse existing stock rules' runnable judgement — no new judgement code.
    const stockRule = DISPATCH_RULES_BY_UNIT_TYPE[advice.unitType];
    if (!stockRule) return null;
    const stockAction = await stockRule.match({ ...ctx, advisedUnit: undefined });
    if (!stockAction || stockAction.action !== "dispatch") {
      logWarning(`phase-discipline advised ${advice.unitType} but it is not runnable; falling back`);
      return null;
    }
    // Honour advice by returning the stock rule's own DispatchAction verbatim; overwrite unitId only if the caller provided one.
    return advice.unitId ? { ...stockAction, unitId: advice.unitId, matchedRule: "honour-phase-discipline-advice" } : { ...stockAction, matchedRule: "honour-phase-discipline-advice" };
  },
},
```

**Key design decisions (answers to evaluator questions from the 3rd review):**

- **"runnable" judgement** — reuse the stock `DispatchRule.match()` for the advised `unitType`. No new judgement function exists; "runnable" is defined as "the stock rule for this unit type would match the current `ctx` if it were evaluated normally."
- **Multiple candidate `unitId` for a given `unitType`** — `profile-dispatch.ts` emits only `advisedUnitType` in v1 (never `advisedUnitId`); the stock rule owns `unitId` construction (via `state.activeSlice.id`, `basePath`, etc.). `advisedUnitId` on `PreDispatchResult` is reserved for v1.1+ use cases (e.g. scout-fan-out in v1.2 where a specific slice is targeted).
- **Honour-advice is NOT short-circuit** — it is simply a `DispatchRule` with the highest priority. If the prefix rule returns `null` (advised unit not runnable), the remaining `DISPATCH_RULES` evaluate normally with the original `ctx`, preserving `auto-mode`'s adaptive behaviour.
- **Consumer of advisory output** — the prefix rule is not enough by itself. `auto/phases.ts::runDispatch()` is the real consumer of `runPreDispatchHooks()` and must issue the second `resolveDispatch(...)` call with `advisedUnit`; otherwise the new prefix rule is never exercised.
- **No recursive pre-dispatch on the advised second pass** — advisory re-dispatch happens exactly once. The advised second `resolveDispatch(...)` call does **not** rerun `runPreDispatchHooks()` on the newly selected unit, preventing recursive advice loops and keeping the originally selected post-advice unit authoritative for downstream journaling / stuck detection / pause-after-UAT / prior-slice guards.
- **`advisedUnitId` validation** — when v1.1+ callers do set `advisedUnitId`, the prefix rule overwrites the stock rule's computed `unitId` as-is. Any illegal id surfaces as a downstream failure at unit execution; the contract does not validate ids at the scheduler layer (keeps scheduler pure).
- **`DISPATCH_RULES_BY_UNIT_TYPE`** — new index map built once at module load by iterating `DISPATCH_RULES` and grouping by the `unitType` emitted by each rule's first `dispatch` match. Rules with no fixed `unitType` (e.g. the pause-for-escalation rule at index 0) are excluded from the map (their semantics are "interrupt", not "dispatch a named unit").
- **Line count** — "~20 lines" refers only to the prefix rule in `auto-dispatch.ts`. Real PR-3a scope is larger: `types.ts`, `rule-registry.ts`, `auto-dispatch.ts`, `auto/phases.ts`, `auto/loop-deps.ts`, plus focused tests for the advised re-dispatch path.

**Rejected alternative: hard hint on preferences.** The third-review evaluator suggested adding `preferredUnitType/preferredUnitId` to `ctx` and letting existing rules optionally consult it. Rejected because (a) it requires editing every stock rule to consult the preference, (b) it couples rules to a preset-level concept, (c) it complicates testing (every rule's `match` now has an implicit branch). The prefix-rule approach keeps the advisory mechanism localised to a single new rule and leaves stock rules byte-identical.

#### Δ-K2 — alternative kernel delta (scheduler-side profile awareness) — not recommended

Add a `profile-aware` branch directly in `auto-dispatch.ts` that reads `milestone_profile` and consumes `PHASE_DISCIPLINE_8STEP_SEQUENCE`. Rejected because it couples scheduler to the `phase-discipline/` extension, violating Decision Ω1 (preset should not require extension-specific scheduler branches).

#### Implementation surface (under `phase-discipline/`) assuming Δ-K1 lands

- `profile-map.ts` — exports `PHASE_DISCIPLINE_8STEP_SEQUENCE: Array<{phase: string; unit: UnitType | UnitType[]; gating: "strict" | "soft"; completionArtifact?: string}>` — the 8-phase → auto-mode unit map of §3.1b. `completionArtifact` is a path glob relative to `.gsd/{mid}/{sid}/` used for strict gating verification.
- `profile-dispatch.ts` — pre-dispatch hook body. On each invocation: (1) read current milestone's executed-unit log from existing `.gsd/{mid}/STATE.json`; (2) determine the next expected phase from the sequence; (3) if the scheduler's chosen `unitType` matches, return `{action: "proceed"}`; (4) if it does not match and the prior phase is strict-gated without its `completionArtifact`, return `{action: "advise", advisedUnitType: priorPhaseUnit}`; (5) if it does not match but all prior phases are satisfied, return `{action: "advise", advisedUnitType: expectedUnit}`. No state persisted beyond the existing `firedHooks` log.

#### Behaviour specification

- **Strict gating** — the next unit cannot fire until the prior phase's `completionArtifact` exists. v1 enforces strict gating on P4 → P5 only (implementation evidence before verification) because `execute-task` already produces `.gsd/{mid}/{sid}/tasks/*` files as a verifiable artifact on main. **P2 → P3 and P3 → P4 strict gating is deferred to v1.3** when the `impl-plan-YAML` schema validator lands — v1 cannot enforce them without an artifact contract (caught by v7.1 review).
- **Soft gating** — the hook emits `action: "advise"` but does not block. `auto-dispatch.ts` honours the advice if the advised unit is runnable, otherwise logs the mismatch and proceeds with its original choice. v1 uses soft gating for P0, P1, P2, P3, P5, P6 (P7 is out-of-band — see §3.1b.2).
- **Backoff on repeated scheduler disagreement** — if `auto-dispatch.ts` returns the same `unitType` for 3 consecutive dispatch calls after the hook has advised otherwise, `profile-dispatch.ts` emits `logWarning` and stops advising for that phase for the rest of the milestone; this surfaces configuration errors without infinite-looping.
- **Per-milestone opt-out** — NOT supported in v1 (see §3.1 note). Users who need per-milestone scope disable the profile globally and author bespoke `post_unit_hooks` for the milestones they want covered.

**What `profile-dispatch.ts` is NOT.** Not a scheduler replacement. Not a state machine owned outside `auto-dispatch.ts`. Not allowed to mutate completed-unit records. Not allowed to skip phases in v1 (adaptive skipping is OQ-5). Not allowed to dispatch out-of-band workflows like `extract-learnings` (which is not a dispatch unit — see §3.1b.2).

### 3.1b 8-phase → auto-mode unit map (authoritative)

v7 collapsed scheduler-owned dispatch units and out-of-band post-processing into one table, which made P7 look like it had a dispatch unit `extract-learnings` that does not exist. v7.1 splits them.

#### 3.1b.1 Scheduler-owned phases (profile-dispatch can advise these)

All 6 rows verified against `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts`. v1 adds no new unit types.

| Phase | Composed-lite concept | auto-mode dispatch unit(s) | Gating in v1 | `completionArtifact` glob | v1 attached hook(s) | Capability migration slot |
|---|---|---|---|---|---|---|
| P0 | Admission | `discuss-milestone` | soft | — | — | v1.1: admission-checklist post-unit hook |
| P1 | Research | `research-milestone`, `research-slice` | soft | — | — | v1.2: scout-fan-out requires a new `PreDispatchHookConfig.action: "fan-out"` kernel delta |
| P2 | Design | `plan-slice`, `refine-slice` | soft *(v7.1: was strict in v7; downgraded because no `completionArtifact` schema exists until v1.3)* | *(v1.3)* | `phase-discipline-design-review` (§3.3) | v1.3: impl-plan-YAML schema validator supplies the artifact |
| P3 | Split | `plan-slice` task-decomposition pass (same unit type; reuses `gsd_plan_slice` tool) | soft *(v7.1: was strict in v7; same reason as P2)* | *(v1.3)* | — | v1.3: impl-plan-YAML validator |
| P4 | Implementation | `execute-task` | **strict** | `.gsd/{mid}/{sid}/tasks/*/EVIDENCE.md` | `phase-discipline-code-review` (§3.3) | — |
| P5 | Verification | `validate-milestone` (+ `enhanced_verification` machine check) | soft *(auto-on; no profile-dispatch action needed)* | — | — | v1.4: verify-fuse strict mode adds a block-on-fail hook |
| P6 | Synthesis | `complete-slice`, `complete-milestone` | soft | — | `phase-discipline-findings-to-memories` on `complete-slice` (§3.3) | — |

**P7 is intentionally NOT in this table.** auto-mode's `rewrite-docs` unit is a dispatch unit but it is triggered by `reassess-roadmap` heuristics, not by the phase-discipline skeleton. See §3.1b.2.

#### 3.1b.2 Out-of-band post-processing (NOT dispatched by profile-dispatch)

These happen inside existing hook prompts or as user commands. The profile-dispatch skeleton does not advise them; they are listed here only because composed-lite's phase model included them and readers will ask.

| Composed-lite P7 concept | auto-mode equivalent | How triggered in v1 |
|---|---|---|
| Postmortem — memory promotion | `capture_thought` calls inside the existing `phase-discipline-findings-to-memories` post-unit hook at `complete-slice` | Already covered by v1 preset (§3.3) |
| Postmortem — docs rewrite | `rewrite-docs` dispatch unit | Triggered by auto-mode's own reassess heuristic, or manually via `/gsd` command. v1 does not force it |
| Postmortem — cross-milestone learnings | `extract-learnings` **was listed as a dispatch unit in v7 — it is not one** (verified `grep -n 'extract-learnings' auto-dispatch.ts` = 0). Instead: the existing `phase-discipline-findings-to-memories` hook uses `capture_thought` which `loadMemoryBlock` reads in the next milestone's research units. ADR-013 channel. | Already covered by v1 preset; no new unit needed |

#### 3.1b.3 Why strict gating is narrower in v1 than v7 claimed

**Strict gating on P4 → P5 is the only one v1 can enforce.** `execute-task` writes verifiable evidence to `.gsd/{mid}/{sid}/tasks/{tid}/EVIDENCE.md` (or equivalent; the exact path is confirmed by PR-3b against `auto-post-unit.ts`). `validate-milestone` can check this before running.

**P2 → P3 and P3 → P4 strict gating are deferred to v1.3.** v7 claimed these could be strict based on "the existing `gsd_plan_slice` schema already enforces non-empty task list". That is partially true — the tool schema enforces non-empty task arrays at call time — but there is no stable artifact path that `profile-dispatch.ts` can check without duplicating plan-slice's internal state. v1.3 adds the impl-plan-YAML artifact at `.gsd/{mid}/{sid}/PLAN.yaml` which makes strict gating checkable. Until then, P2/P3 run soft-gated.

**Profile-dispatch still advises ordering for soft-gated phases.** Soft does not mean "silent" — it means the hook still emits `action: "advise"` when the scheduler's pick is out of sequence, but `auto-dispatch.ts` can override the advice if its heuristic disagrees (e.g. it picks `reassess-roadmap` after a slice fails UAT). This preserves auto-mode's adaptive recovery.

### 3.2 New `PostUnitHookConfig` fields (only 3 additions)

```ts
interface PostUnitHookConfig {
  // ── existing (unchanged) ──
  name: string;
  after: string[];
  prompt: string;
  max_cycles?: number;
  model?: string;                 // reused as the primary reviewer model
  artifact?: string;
  retry_on?: string;
  agent?: string;
  enabled?: boolean;

  // ── v1 additions ──
  provider?: string;              // explicit provider; unset → existing resolution
  cross_review?: number;          // N>1 → fan-out N reviewers; unset/0/1 ≡ legacy single reviewer
  cross_review_models?: string[]; // advanced override: force specific extra reviewers; length ≤ N-1
}
```

`PreDispatchHookConfig` gains only `provider?: string` for symmetry (v1 preset does not use it).

**Important — `reviewer_model` is NOT added.** v5 §5.3's proposal to introduce `reviewer_model` is rejected: `model?` already exists and is semantically equivalent; adding `reviewer_model` would create ambiguity about precedence.

### 3.2.1 Hook conflict resolution (v7)

When a user-authored `post_unit_hook` has the same `name` as a preset hook, merge semantics are:

1. **Full user-hook replacement, no field-level merging.** The user hook wins in its entirety; preset fields do NOT leak into the user hook even if the user hook omits them. Rationale: silent field merging is the classic source of "I thought I disabled this" production surprises.
2. **`logWarning` emitted on shadow.** Message: `phase-discipline preset hook "{name}" shadowed by user hook; preset fields not inherited`.
3. **`cross_review` default when user hook omits it.** If the shadowing user hook has no `cross_review` field, `mergePresetIntoHooks()` treats it as `cross_review: 1` (single-reviewer legacy path). An additional `logWarning` says `user hook "{name}" lacks cross_review; defaulting to single-reviewer (preset wanted {preset_value})`. Rationale: silently inheriting `cross_review=2` from the preset would spawn extra subagents the user did not author.
4. **`provider`, `model`, `retry_on`, `max_cycles` all default to user's explicit value or their documented `PostUnitHookConfig` defaults**, never to preset values.
5. **Ordering when user provides hooks in addition to (not shadowing) preset.** Both sets run; order is preset hooks first, user hooks second within the same `after: [...]` trigger. Documented in `phase-discipline/README.md`.

**Validation order in `mergePresetIntoHooks()`** *(added 2026-04-23 after third receiving-code-review — locks in the "merge vs validate" sequence):*

1. Load raw user `.gsd/preferences.yaml` via existing path; no schema validation yet.
2. Validate raw user config against `GSDPreferences` schema — fail fast on type errors / required fields.
3. If `milestone_profile === "phase-discipline-8step"`, call `mergePresetIntoHooks(userHooks, presetHooks)` producing the merged hook list per rules 1–5 above (name-shadow semantics; `cross_review` default fill for shadowing hooks happens here).
4. Re-validate the merged hook list — each merged `PostUnitHookConfig` / `PreDispatchHookConfig` must satisfy the same schema as a user-authored hook. Failure here indicates a preset bug, not user error.
5. `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` return the validated merged list; this is the only list `rule-registry.listRules()` ever sees.

**Invariant.** Step 4 guarantees that downstream consumers (`rule-registry`, `runPreDispatchHooks`, reviewer fan-out) never encounter a half-constructed preset hook. Schema violations in the preset are fatal at preference-load time, not at hook-fire time.

**Migration guidance for authors upgrading across v7 → v7.x** — if a preset hook gains a new field in a minor release, existing shadowing user hooks will miss that field; CI should run `phase-discipline/merge.ts` dry-run against committed `.gsd/preferences.yaml` and emit a warning at PR time (this lint is OQ-8 in §15).

### 3.3 The `"phase-discipline-8step"` preset — 3 hooks (authoritative list)

Reviewer fan-out, merge semantics, and `retry_on` naming are unchanged from v6; only the enclosing preset name changed (v6's `"phase-discipline-v1"` → v7's `"phase-discipline-8step"`).

| Hook name | Kind | Trigger | Semantics |
|---|---|---|---|
| `phase-discipline-code-review` | post-unit | after `execute-task` | Cross-review every completed task with N reviewers (default `cross_review=2`, `max_cycles=2`). Exhausted → findings written to artifact and carried. |
| `phase-discipline-design-review` | post-unit | after `plan-slice` AND `refine-slice` | Cross-review each slice plan (default `cross_review=2`, `max_cycles=2`). Exhausted → artifact carries. If review verdict = `fail`, re-run `refine-slice` via `retry_on` naming. |
| `phase-discipline-findings-to-memories` | post-unit | after `complete-slice` | Prompt drives main session to read the slice artifact directory, call `capture_thought` for unresolved `*-findings.md` / `*-review.md` entries, tagged `gotcha`. Cap 5 entries per slice-close. `max_cycles=1`, no review. |

**Deliberately NOT in v1 (assigned to a v2 slot in §12)**:

- Admission-checklist hook on `discuss-milestone` → v1.1
- Scout fan-out hook on `research-slice` → v1.2 (requires new `PreDispatchHookConfig` action type)
- Impl-plan-YAML schema validator hook on `plan-slice` → v1.3 (requires `gsd_plan_slice` schema tightening)
- Verify-fuse strict mode on `validate-milestone` → v1.4
- Machine verification hook (`enhanced_verification` already covers it — stays rejected as a duplicate)
- Milestone-closure cross-review → OQ-4 in §15 (still needs cost baseline)

### 3.4 Directory layout

#### `src/resources/extensions/gsd/shared-harness/` (new, 5 files)

```
shared-harness/
├── reviewer-core.ts          # runReview({projectRoot, model, provider, systemPrompt, reviewPrompt, targetContent, maxAttempts}) → ReviewResult
├── review-model-picker.ts    # pickCrossReviewers(primaryModel, primaryProvider, count) → Array<{model, provider}>
├── subagent-spawn.ts         # shared-harness-owned source file (state-agnostic; may use internal resolve-bin helper)
├── subagent-terminal.ts      # shared-harness-owned source file (state-agnostic)
└── index.ts                  # barrel exports + module-boundary comment
```

**Scope guard** — `shared-harness/*` imports from `./` or `../` but **never from `../composed-lite/`** or `../phase-discipline/`. A dedicated structural boundary test enforces this in PR-2's landing commit (non-negotiable).

#### `src/resources/extensions/gsd/phase-discipline/` (new, 6 files + README — v7 adds 2 files for Π₈ skeleton)

```
phase-discipline/
├── preset.ts            # exports phaseDiscipline8StepPreset: {postUnitHooks: PostUnitHookConfig[], preDispatchHooks: PreDispatchHookConfig[]}
├── reviewer-hook.ts     # cross_review fan-out runner, calls shared-harness/reviewer-core N times in parallel, union-merges findings
├── findings-carry.ts    # prompt template + artifact-dir path helper for the findings-to-memories hook; invoked by preset.ts
├── merge.ts             # mergePresetIntoHooks(userHooks, presetHooks) — user names override preset entirely per §3.2.1
├── profile-map.ts       # ★ NEW v7: PHASE_DISCIPLINE_8STEP_SEQUENCE export (§3.1b authoritative map)
├── profile-dispatch.ts  # ★ NEW v7: pre-dispatch hook body; consumes profile-map.ts; biases next-unit choice under Π₈
└── README.md            # design pointers + cross-refs §3-§8 of this document
```

**No new unit type, no new DispatchRule, no new CLI command.** `reviewer-hook.ts` is not a new mechanism — it's the body of the preset's hook prompts' execution path when `cross_review > 1`. `profile-dispatch.ts` is not a new mechanism either — it's a pre-dispatch hook body feeding into the existing `runPreDispatchHooks()` pipeline.

#### `main`-side edits (2 files, additive only; estimated ~30 lines total — slightly more than v6 due to `milestone_profile` branch in `preferences.ts`)

| File | Change |
|---|---|
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts` | Add `milestone_profile?: "auto" \| "phase-discipline-8step"` to `GSDPreferencesFields`; add `provider?`, `cross_review?`, `cross_review_models?` to `PostUnitHookConfig`; add `provider?` to `PreDispatchHookConfig` |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences.ts` | In `resolvePostUnitHooks()` / `resolvePreDispatchHooks()`: if `prefs.milestone_profile === "phase-discipline-8step"`, delegate to `phase-discipline/merge.ts` for preset injection (both post-unit hooks and the single pre-dispatch hook from §3.1a). User-authored hooks with same `name` take precedence per §3.2.1 |

**Modified in v1**: `auto-dispatch.ts` gains ~20 lines to honour `PreDispatchResult.action === "advise"` (PR-3a, Δ-K1 in §3.1a); `types.ts` gains the new `advise` action constant + the new optional fields on `PreDispatchResult`.

**Not modified in v1**: `auto-post-unit.ts` (metrics wiring is v1.1; see R-2); `rule-registry.ts` (no new *rule* shape — `runPreDispatchHooks()` only learns to propagate the new `advise` action unchanged); scheduler unit-selection heuristics (the advisory is consumed at the point where the scheduler has already picked; if the advice is honoured, the loop re-enters selection with the advised unit as a hard preference).

## 4. Data flow

```
auto-mode rule-registry.listRules()
         │
         ├─ dispatch rules            (unchanged)
         ├─ post_unit_hooks           ◄── preferences.resolvePostUnitHooks()
         │                                 ↑
         │                                 merge(userHooks, presetHooksIfOptedIn)
         ├─ pre_dispatch_hooks        ◄── preferences.resolvePreDispatchHooks()
         │                                 ↑
         │                                 merge(userHooks, presetHooksIfOptedIn)
         │                                   includes phase-discipline-profile-dispatch when
         │                                   milestone_profile === "phase-discipline-8step"
         │
         ├─ pre-dispatch fires (PR-3a kernel delta required):
         │      │
         │      ├─ profile-dispatch reads STATE.json + profile-map → returns
         │      │     {action: "proceed"}             when scheduler pick matches sequence
         │      │     {action: "advise", advisedUnitType, advisedUnitId}
         │      │                                    when scheduler pick is out-of-sequence
         │      │     {action: "skip"|"modify"|"replace"} are legacy paths
         │      └─ auto-dispatch.ts honours "advise" if runnable; otherwise logWarning + proceed
         │
         └─ post-unit hook fires after the unit completes:
              │
              ├─ cross_review ≤ 1 → existing single-reviewer path (byte-identical)
              │
              └─ cross_review ≥ 2 → reviewer-hook.ts:
                                      a. reviewer[0]  = {model: hook.model, provider: hook.provider}
                                      b. reviewer[1..N-1] = cross_review_models ??
                                                           pickCrossReviewers(hook.model, hook.provider, N-1)
                                      c. Promise.all([runReview(r) for r in reviewers])
                                      d. merge findings (§5)
                                      e. write artifact file per §6
                                      f. existing auto-mode retry_on path picks up file
```

The `rule-registry` / `auto-post-unit` / `preferences` layers **never learn** about "reviewer" or "phase-discipline" as concepts after PR-3a's kernel delta. They see: (a) a regular pre-dispatch hook that happens to emit `"advise"`; (b) regular post-unit hooks that happen to take longer and produce richer output. All fan-out and sequence logic is local to `phase-discipline/{profile-dispatch,reviewer-hook}.ts`.

### 4.1 Profile compatibility matrix (new in v7.1)

v7.1 fills a gap flagged by review: `milestone_profile` had no documented interaction with the existing adaptive/parallel/reactive preferences. Those preferences all live under `GSDPreferences` (`@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts`). v1 behaviour:

| Preference | Shape | Interaction under `milestone_profile: "phase-discipline-8step"` | Reason |
|---|---|---|---|
| `reactive_execution` | `{ enabled?: boolean; ... }` graph-derived parallel tasks within a slice | **Compatible.** Continues to work during P4. `profile-dispatch` only cares about which *phase* is active, not about task-level parallelism inside `execute-task`. | Graph-parallelism lives below the phase boundary |
| `gate_evaluation` | `{ enabled?: boolean; ... }` parallel quality-gate eval during slice planning | **Compatible.** Runs during P2/P3 (slice planning). Profile-dispatch advises on phase *ordering*, not on whether gate-eval fires. | Same horizontal/vertical split |
| `slice_parallel` | `{ enabled?: boolean; max_workers?: number }` slice-level parallelism within a milestone | **Conditional compatibility with a WARN.** Slice-parallel means multiple slices in P2–P6 simultaneously. The 8-step sequence is defined *per slice*. v1 treats the milestone as "walk 8 phases in the aggregate" — if ALL active slices have entered P4, the profile allows P5. This requires `profile-dispatch` to read all active slices (existing `STATE.activeSlices[]`), not just `activeSlice`. If `slice_parallel.max_workers > 1` AND `milestone_profile === "phase-discipline-8step"`, `profile-dispatch.ts` emits a one-time `logWarning` at milestone start explaining the aggregate semantics. v1 does NOT auto-disable either. |
| `parallel` | `ParallelConfig` dispatch-level parallelism | **Compatible with the same aggregate-phase semantics** as `slice_parallel` above | Same |
| `phases.skip_research` / `skip_reassess` / `skip_slice_research` / `skip_milestone_validation` | `PhaseSkipPreferences` | **v1 honours user skip flags over the profile.** If the user has `skip_milestone_validation: true`, P5 soft-gate becomes a no-op (advice yields immediately). A one-time `logWarning` at milestone start explains the interaction. | User intent wins over preset ordering |
| `progressive_planning` (ADR-011 Phase 1) | `phases.progressive_planning?: boolean` | **Compatible.** Progressive planning means "plan S01 in full and S02+ as sketches just-in-time". Profile-dispatch still walks the 8 phases per slice. No special handling. | Orthogonal concerns |
| `mid_execution_escalation` (ADR-011 Phase 2) | `phases.mid_execution_escalation?: boolean` | **Compatible.** Escalation artifacts are written during P4 and consumed by the user; profile-dispatch does not observe them. | Orthogonal |
| `require_slice_discussion` | `phases.require_slice_discussion?: boolean` | **Compatible.** The pause it enforces happens before P2 and is orthogonal to profile-dispatch sequencing. | Orthogonal |
| `enhanced_verification` / `enhanced_verification_pre` / `_post` / `_strict` | booleans | **Compatible.** These run as part of P5 already; profile-dispatch does not touch them. | P5 already covers |
| `milestone_overrides` | does not exist on main (v7.1 correction) | **N/A.** Per-milestone profile opt-out is v1.1 (OQ-12). |

**Interaction-warning emission rules.** The warnings above are emitted once per milestone, at the first `profile-dispatch` invocation for that milestone. They carry the `milestoneId` and the specific preference name so operators can grep for them in logs. The warnings are **not** fatal — v1 does not auto-disable any preference — because the user explicitly opted into both surfaces.

**What this matrix does NOT cover in v1.** Interactions of `milestone_profile` with *custom user-authored pre-dispatch hooks*. If a user's own pre-dispatch hook returns `action: "skip"` or `"replace"` before `profile-dispatch` runs, that user hook wins by hook ordering (see §3.2.1). Profile-dispatch does not attempt to re-assert sequence after a user skip. Discovering edge cases here is why PR-3b includes integration tests (§10) that exercise custom pre-dispatch hook + profile together.

### 4.5 Docs-map ↔ preset context-flow contract (v7)

`AGENTS.md docs-map v1` (separate spec: `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md`) and the phase-discipline preset are orthogonal specifications, but they both touch the `execute-task` prompt pipeline. v7 locks their interaction order to prevent context-attribution ambiguity.

**Context injection order at `execute-task`:**

1. Platform loader (`@/Users/sheng/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts`): full `AGENTS.md` ancestor-walk → **system prompt**.
2. Docs-map extension (`agents-md-loader.ts`): `loadAgentsSection(hint)` → **task prompt** optional L0.
3. auto-prompts: `inlineGraphSubgraph` + `queryKnowledge` + `loadMemoryBlock` → **task prompt** supplements.
4. Task unit executes.
5. Post-unit hook dispatched by `rule-registry`; when `cross_review ≥ 2`, `reviewer-hook.ts` spawns N reviewer subagents (each under `--no-session` per existing composed-lite convention).

**What reviewer subagents see (authoritative):**

- ✅ Full `AGENTS.md` via the platform loader — because each reviewer spawns its own process and the ancestor walk runs at process start, independent of parent session state.
- ✅ Hook-prompt-provided code / task artifact content — the reviewer's job target.
- ❌ Optional L0 sections via `loadAgentsSection(hint)` — because the reviewer prompt pipeline does **not** call the docs-map helper; `hint` is a task-prompt concept, not a reviewer-prompt concept.
- ❌ `inlineGraphSubgraph` / `queryKnowledge` / `loadMemoryBlock` output — reviewer does not rebuild auto-prompts context.

**Rationale.** Reviewers are scoped to a single artifact review and benefit from AGENTS.md Routing Rules in the system prompt (they may use `read_file` to pull L1 content if a rule matches). They do not need task-prompt-level optional routing: the reviewer's focus is explicit in the hook prompt, not derived via hint.

**Implication for hook prompt authors.** When authoring a custom post-unit hook prompt that needs L1 docs-map content:

- Do NOT assume `loadAgentsSection(hint)` output is inherited.
- DO assume Routing Rules (the mandatory section of `AGENTS.md`) are visible to the reviewer.
- If the reviewer needs specific L1 content, include a `read_file("./.gsd/docs-map/<area>.md")` instruction in the hook prompt body.

**Reviewer tool set.** Preset reviewers spawn with `--tools read` (no write, no bash, no skill) by existing composed-lite review-harness convention (see `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/composed-lite/review-harness.ts` after PR-2 extraction becomes `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/shared-harness/reviewer-core.ts`). Combined with PR-1's CLI tool-restriction chain, the reviewer cannot invoke the built-in `Skill` tool; this closes the anti-drift class of issues observed in `cl-20260422-*` runs.

## 5. `cross_review` merge semantics

**Union + dedupe + worst-assessment.**

```
merged.critical  = dedupe(concat(r.critical  for r in reviewers))
merged.important = dedupe(concat(r.important for r in reviewers))
merged.minor     = dedupe(concat(r.minor     for r in reviewers))
merged.overall_assessment = worst(r.overall_assessment for r in reviewers)
   where order: pass < issues < fail
```

**Dedupe key** — `normalize(finding.target) + "|" + normalize(finding.rationale[:50])`, where `normalize(s) = s.toLowerCase().replace(/\s+/g, ' ').trim()`. Duplicates keep the first entry and append `(also flagged by K other reviewers)` to its rationale.

**Rejected alternatives** (not re-litigated in future revisions):

- `intersection` — reduces sensitivity as N grows; counter-intuitive
- `majority vote` — meaningless at N=2; adds complexity without v1 benefit
- `third-model arbitration` — cost × 3; not in v1

**If some reviewers fail:**

- ≥ 1 success → merge what succeeded, log `reviewer_unavailable` for each failure, do not abort the hook
- All fail → return `reviewer_unavailable` to hook engine; existing `retry_on` path may trigger one retry; persistent failure writes `reviewer_unavailable.md` artifact and carries forward flagged `unchecked`

**Reviewer execution status enum** *(added 2026-04-23 after third receiving-code-review — canonical status names consumed by `reviewer-hook.ts` and logged to §6.2 `.phase-discipline/*.json`):*

| Status | When emitted | Artifact effect (v1) |
|---|---|---|
| `success` | Reviewer returned a parseable review with an `overall` verdict | Normal union-merge path |
| `timeout` | Subagent exceeded `GSD_PHASE_DISCIPLINE_REVIEWER_TIMEOUT_MS` (default `180000`) | Counted as failure; emit `logWarning` with duration |
| `parse-failure` | Reviewer completed but output did not match §6 markdown template | Counted as failure; raw stdout captured to `.phase-discipline/{hook}-{tid}-reviewer{N}-raw.log` only if §6.2 observability opted in |
| `auth-failure` | Provider returned HTTP 401 / permission error | Counted as failure; emit `logError` (not `logWarning`) — these rarely self-resolve |
| `rate-limit` | Provider returned HTTP 429 | Counted as failure; emit `logWarning` with retry-after if header present |
| `reviewer-unavailable` | Catch-all for any other non-zero exit or network error | Counted as failure; emit `logWarning` |

**All-fail artifact shape** — when every reviewer returns a non-`success` status, `reviewer-hook.ts` writes `.gsd/{mid}/{sid}/{hookName}-{tid}.md` with:

```md
# Code Review — {taskId}
reviewer: {model1}, {model2}  [cross_review=2, merge=union]
overall: reviewer_unavailable

## Reviewer status
- model1 ({provider1}): auth-failure — HTTP 401 at 2026-04-23T05:13:22Z
- model2 ({provider2}): timeout — 180000ms exceeded

## Summary
All reviewers failed for this task. Findings carry forward flagged `unchecked`; see R-2 / R-8.
```

The `overall: reviewer_unavailable` literal is what `retry_on` matches against for the all-fail retry behaviour specified above.

**Clamp** — `cross_review > 5` is silently clamped to 5 (R-8 cost safeguard).

## 6. Artifact format & retry naming

**Path** (reuses `rule-registry.resolveHookArtifactPath`):

- code-review → `.gsd/{mid}/{sid}/code-review-{tid}.md`
- design-review → `.gsd/{mid}/{sid}/design-review-{sliceRevision}.md`

**Markdown template** (authoritative on `shared-harness/reviewer-core.ts`):

```md
# Code Review — {taskId}
reviewer: {model1}, {model2}  [cross_review=2, merge=union]
overall: issues

## Critical (N)
- [target: src/foo.ts:42]
  rationale: ... (also flagged by 1 other reviewer)

## Important (N)
...

## Minor (N)
...

## Summary
...
```

**`retry_on` naming convention** — the hook decides a file name based on the merged assessment:

| Merged `overall_assessment` | Artifact written | `retry_on` match |
|---|---|---|
| `pass` | `code-review-{tid}.md` | no match → no retry |
| `issues` (and `max_cycles` not exhausted) | `code-review-{tid}-retry.md` | matches `retry_on: "code-review-{tid}-retry.md"` → trigger unit rerun |
| `fail` (and `max_cycles` not exhausted) | `code-review-{tid}-retry.md` | same as above |
| `issues` / `fail` (exhausted) | `code-review-{tid}.md` | no match → carry forward |

This keeps the existing `retry_on` file-name matching in `rule-registry` unchanged. The **preset** sets `retry_on: "code-review-{tid}-retry.md"` in its config; the convention is entirely inside `reviewer-hook.ts`.

### 6.2 Observability v1 — per-hook structured log (new in v7)

**Problem.** v6's only observable artifact for a review run is the markdown review file. Real runs (e.g. `cl-20260422-*`) showed that when a reviewer fails (auth error, timeout, parse failure), the markdown artifact is empty or missing and the user has no way to see *which* reviewer failed and *when*. The existing `hook-state.json` records lifecycle but not per-reviewer details.

**v1 minimum structured log.** `reviewer-hook.ts` writes one JSON file per hook invocation:

```
.gsd/{mid}/{sid}/.phase-discipline/{hookName}-{triggerUnitId}.json
```

**Schema (authoritative):**

```json
{
  "hook_name": "phase-discipline-code-review",
  "trigger_unit_type": "execute-task",
  "trigger_unit_id": "t042",
  "cycle": 1,
  "cross_review": 2,
  "reviewers": [
    {
      "model": "gpt-5.4",
      "provider": "openai",
      "status": "success",
      "wall_clock_seconds": 18.3,
      "findings_counts": { "critical": 1, "important": 2, "minor": 0 },
      "output_chars": 2048
    },
    {
      "model": "claude-opus-4-6",
      "provider": "claude-code",
      "status": "auth_failure",
      "wall_clock_seconds": 0.5,
      "error": "401: Invalid API key"
    }
  ],
  "merge_result": { "critical": 1, "important": 2, "minor": 0, "overall": "issues" },
  "wall_clock_seconds": 18.7,
  "timestamp_iso": "2026-04-23T14:23:45Z"
}
```

**Deliberate omissions in v1:**

- No input/output token counts — requires structured metrics wiring (R-2 full fix), deferred to v1.1.
- No cost in currency — depends on token counts; same deferral.
- No full stdout/stderr capture — raw logs already live at `.gsd/composed-lite/logs/raw/*.jsonl` for composed-lite runs; phase-discipline reviewer stdout/stderr goes through the same `subagent-spawn` path and can be captured there if OQ-9 is later turned on.

**Consumption paths in v1:**

- Humans: read the JSON file directly for postmortem (`jq '.reviewers | map(select(.status != "success"))' ...`).
- `extract-learnings`: aggregate across slice closure to surface "reviewer X failed 3 times this milestone" as a `gotcha` memory (no code change required in v1; the aggregation script is a natural v1.1 addon).
- `auto-post-unit.ts` / `UnitMetrics`: **not wired in v1** (R-2 deferral). The file is persisted for future consumption.

**Size guard.** If a reviewer error contains a stack trace or long provider-specific payload, the log truncates the `error` field at 2048 chars and appends `... (truncated; see raw log)`.

**Relation to existing `hook-state.json`.** `hook-state.json` stays unchanged (it records lifecycle across hook cycles for idempotency). The new `.phase-discipline/*.json` log is orthogonal — per-invocation snapshot, not cross-invocation state.

## 7. Carry-forward model

- **Within slice, across units** — hook artifact is picked up by `auto-mode`'s existing `buildCarryForwardSection`; zero extra code
- **Across slices, within milestone** — `phase-discipline-findings-to-memories` emits `capture_thought` calls so next slice's `research-slice` / `refine-slice` sees them via `loadMemoryBlock`
- **Across milestones** — existing `extract-learnings` promotes memories milestone-to-milestone (ADR-013); no new cross-milestone findings file in v1

## 8. Error handling (full table)

| Scenario | Behaviour |
|---|---|
| Reviewer provider auth failure (401) or timeout | That reviewer counts as failed; merge proceeds with the rest; all-fail triggers `reviewer_unavailable` artifact path |
| Reviewer output unparseable as structured review | `reviewer-core` retries up to `maxAttempts=2` on its own prompt; persistent parse failure → that reviewer counts as failed |
| `max_cycles` exhausted with `issues`/`fail` | Write non-`-retry` artifact → no rerun; findings-carry hook at `complete-slice` promotes to memories |
| User-authored hook with same `name` as preset | User takes precedence per §3.2.1; `merge.ts` emits `logWarning` on shadow + a second `logWarning` if `cross_review` field is missing from the shadowing hook |
| `prefs.milestone_profile` = unknown string | Treated as `"auto"`; `logWarning` |
| `profile-dispatch` disagrees with scheduler 3 consecutive times | Stops advising for that phase for the rest of the milestone; `logWarning` per §3.1a |
| `profile-dispatch` advises a `unitType` the scheduler cannot run (e.g. no slice active) | `logWarning`; `auto-dispatch.ts` falls back to its original pick; no retry |
| User wants per-milestone profile opt-out | NOT supported in v1; see §3.1 note + OQ-12 |
| Multiple active slices with `milestone_profile` enabled | `profile-dispatch` applies the sequence in aggregate (see §4.1 `slice_parallel` row); `logWarning` at milestone start explains semantics |
| `cross_review` = 1 or unset | Byte-identical legacy single-reviewer path |
| `cross_review` > 5 | Silently clamped to 5 (R-8 safeguard) |
| All reviewers same provider (cross_review_models or picker edge case) | Runs anyway; `logWarning` emitted at hook spawn |
| Recursion (hook-on-hook) | Existing `rule-registry.evaluatePostUnit` guard prevents; unchanged |
| Parallel reviewer session state | Each reviewer spawned with `--no-session` (existing composed-lite convention); no cross-talk |

## 9. Migration plan — 4 independent PRs on clean branches (PR-0 branch strategy)

### 9.0 Implementation readiness gate *(added 2026-04-23 after second receiving-code-review)*

Before any PR below can be **landed** (not just opened), the implementer MUST re-verify these anchors against current `main`. A later code pass on 2026-04-23 found that `main` has already absorbed **part** of the originally-planned Δ-K1 surface, so the table below intentionally distinguishes **already present runtime pieces** from **still-missing authoring / validation / wiring pieces**:

| Anchor | Current `main` state | Where it must come from |
|---|---|---|
| `PreDispatchResult.action: "advise"` + `advisedUnitType` / `advisedUnitId` | Already present on current `main` in `src/resources/extensions/gsd/types.ts` | Preserve and regression-lock in PR-3a |
| Dispatch resolution honours an `"advise"` result | Already present on current `main` through `src/resources/extensions/gsd/auto/phases.ts` re-dispatch + `src/resources/extensions/gsd/auto-dispatch.ts` prefix rule `honour-phase-discipline-advice` | Preserve and regression-lock in PR-3a |
| `preferences-validation.ts` accepts `pre_dispatch_hooks[].action: "advise"` | Missing — validator still only accepts `modify` / `skip` / `replace` | PR-3a contract-sync residue, or an explicit equivalent prerequisite before PR-3b |
| `GSDPreferences.milestone_profile?: "auto" \| "phase-discipline-8step"` | Missing — no such field in `preferences-types.ts` | PR-3b |
| Preset merge in `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` | Missing — both functions return the user-configured arrays verbatim (`preferences.ts:580-593`) | PR-3b |
| `--tools` end-to-end restriction (`resolveCreateAgentSessionToolOptions` + `includeBuiltInSkillTool` + `autoActivateNewExtensionTools`) | Partially present on `main` — `sdk.ts` already carries `extraActiveToolNames`, but root CLI wiring and built-in `Skill` gating are still missing | PR-1 (remaining end-to-end chain completion) |

**Hard ordering constraint.** PR-3b MUST NOT be opened or merged until PR-1 and PR-2 are merged and the `advise` contract on `main` is fully synchronized end-to-end. As of 2026-04-23, that means the runtime pieces are already present, but the real validator still rejects `action: "advise"`; v7.1 therefore remains correct that PR-3b must not assume the contract is ready until that residue is closed.

### 9.1 Per-PR breakdown

Each PR is independently reviewable and landable. Later PRs depend on earlier ones only for the new code paths to be wired.

### PR-0 — Branch strategy (v7 prerequisite, non-code)

Current `feat/composed-lite-runtime-owned` mixes two semantically orthogonal tracks: (a) composed-lite runtime hardening (anti-drift guards, reviewer-stall investigation, preflight audit) and (b) phase-discipline preset proposal. These must not land together. PR-0 performs the branch reorganisation:

| New branch | Starts from | Contents | Who lands |
|---|---|---|---|
| `feat/cli-tool-restriction-chain` | `origin/main` | PR-1 code per `2026-04-23-cli-tool-restriction-chain.md` | Independent of other PRs; can land first |
| `feat/shared-harness-extraction` | `feat/composed-lite-runtime-owned` | PR-2 extraction from composed-lite/ into shared-harness/ | Composed-lite runtime hardening commits stay behind on `feat/composed-lite-runtime-owned` as Lab state |
| `feat/phase-discipline-preset-v1` | `origin/main` | This spec (v7.1) + `docs/superpowers/specs/README.md` + PR-3a + PR-3b code | **PR-3a has no code dependency on PR-2 or PR-1** — it only edits `main`'s kernel (`types.ts`, `rule-registry.ts`, `auto-dispatch.ts`) and can land in parallel. **PR-3b depends on all three** (`PR-1` for reviewer `--tools read` enforcement; `PR-2` for `shared-harness` imports; `PR-3a` for the `"advise"` action shape) |
| `feat/composed-lite-runtime-owned` | (unchanged) | Kept as Lab. No phase-discipline work added here. Retired at v1.4 per §12 | Frozen for new feature work; rebase-only maintenance |

**Effect on this document.** v7.1 itself lands on `feat/phase-discipline-preset-v1` first (as a pure docs change) so implementation can start from a clean slate. No more spec edits go onto `feat/composed-lite-runtime-owned`.

### PR-1 — CLI tool-restriction chain (M0 only)

Split to its own spec: `docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md`. Orthogonal to phase-discipline; benefits every `--tools`-restricted subagent regardless of preset opt-in. Not described further here.

### PR-2 — `shared-harness/` extraction

**Scope** (on `feat/shared-harness-extraction`, merges to `main`):

1. `shared-harness/reviewer-core.ts` ← extract from `composed-lite/review-harness.ts` (decouple from `ComposedLiteState`; take plain input struct)
2. `shared-harness/review-model-picker.ts` ← extract from `composed-lite/review-model-picker.ts` (already state-agnostic; just moves)
3. `shared-harness/subagent-spawn.ts` ← becomes a `shared-harness`-owned source file (with `resolve-bin.ts` as a non-exported internal helper)
4. `shared-harness/subagent-terminal.ts` ← becomes a `shared-harness`-owned source file
5. `shared-harness/index.ts` ← new barrel

**Branch reality matters.** The source files for this PR live on `feat/composed-lite-runtime-owned`, not on `main`; PR-2 is therefore a branch-local extraction from that Lab branch, not a change that can be implemented from `main` directly.

**Boundary enforcement** is a structural source test, not ESLint. Current repo state does not provide a landing path for the originally-proposed `no-restricted-paths` rule, so PR-2 uses a dedicated source-level boundary test to enforce that `shared-harness/*` never imports `composed-lite/` or `phase-discipline/`.

### PR-3a — Kernel delta Δ-K1 (new in v7.1)

**Scope** (on `feat/phase-discipline-preset-v1`, merges to `main` before PR-3b):

| File | Change | Size |
|---|---|---|
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-validation.ts` | Accept `pre_dispatch_hooks[].action = "advise"` in the real preferences pipeline | ~5-10 lines |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts` | Add focused tests that lock the existing runtime behaviour on `main`: advise honoured when runnable, falls back when not runnable, final advised dispatch remains authoritative | ~80-140 lines |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto/phases.ts` / `auto-dispatch.ts` / `types.ts` / `rule-registry.ts` / `auto/loop-deps.ts` | Verify-first only: touch these files only if branch-tip inspection shows drift from the already-landed runtime contract | typically `0-15` lines per file |

**Why PR-3a is separable.** `Δ-K1` is still the kernel contract for scheduler advice, but on current `main` it has become a **contract-sync PR** rather than a pure greenfield delta: runtime support already exists, while validation and regression coverage still lag. It remains reviewable on its own merits without coupling to phase-discipline policy.

**Why PR-3a cannot be skipped.** Without a fully synchronized `Δ-K1` contract, `profile-dispatch.ts` has no usable path for config-authored ordering advice. Current `main` already carries the additive runtime path, but the real validator still rejects `action: "advise"`; v7.1 therefore remains correct that PR-3b must not assume the contract is ready until that residue is closed.

### PR-3b — `phase-discipline/` preset + B-min skeleton + preferences extension

**`main`-side edits (4 files, ~40-70 lines)**:

| File | Change |
|---|---|
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts` | Add `milestone_profile?: "auto" \| "phase-discipline-8step"` and update `KNOWN_PREFERENCE_KEYS` |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/types.ts` | Add `provider? / cross_review? / cross_review_models?` to hook config interfaces; keep hook-field ownership in the real type definitions |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-validation.ts` | Validate the new hook fields and preserve the already-synchronized `advise` authoring path |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences.ts` | `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` call `phase-discipline/merge.ts` when `milestone_profile === "phase-discipline-8step"` |

**New `phase-discipline/` directory** (6 files + README as in §3.4 — `preset.ts`, `reviewer-hook.ts`, `findings-carry.ts`, `merge.ts`, `profile-map.ts`, `profile-dispatch.ts`, README).

**`profile-dispatch.ts` consumes the Δ-K1 contract from PR-3a** — the runtime contract is already partially present on current `main`, but PR-3b still depends on PR-3a to finish validator acceptance and regression-lock the branch-tip behaviour. Without that sync, the preset is not safely usable even if parts of the extension still type-check.

**Rollout order** *(corrected 2026-04-23 after a third receiving-code-review pass):*

- **Parallel track 1** — PR-1 (CLI tool-restriction). Standalone. No code dependency on any other PR.
- **Parallel track 2** — PR-2 (shared-harness extraction). Standalone. Branches from `feat/composed-lite-runtime-owned`; no dependency on main's PR-1/PR-3a.
- **Parallel track 3** — PR-3a (Δ-K1 contract-sync). Standalone. Locks and finishes the already-partially-landed advisory contract on `main`; the key missing piece is validator acceptance plus focused regression coverage.
- **Parallel track 4** — PR-4 (AGENTS.md docs-map v1). Orthogonal; see separate spec.
- **Merge point** — PR-3b (phase-discipline preset + skeleton). Blocked on `{PR-1, PR-2}` plus a fully-synced `advise` contract on `main` (currently represented by PR-3a). PR-3b is still the only PR with a genuine cross-track dependency set.

v1.1–v1.4 each add capability on top of PR-3b without changing the branch layout; see §12.

**PR-3a + PR-3b combined size estimate** — ~90-170 lines contract-sync + tests in PR-3a, plus ~40-70 main-side preference/glue lines and ~280 extension-side lines in PR-3b. v7's earlier claim that this was a single ~310-line additive drop was wrong in both shape and sequencing.

## 10. Testing strategy

| Layer | Coverage | Location |
|---|---|---|
| Unit — `shared-harness` | `reviewer-core.runReview` contract; mock subagent-spawn verifies single-reviewer path; partial-JSON parse robustness | `src/resources/extensions/gsd/shared-harness/tests/*.test.ts` |
| Unit — `phase-discipline` | `reviewer-hook` fan-out (N=2, N=3, N=5 clamp, single-reviewer fallback); merge logic (union dedupe, worst assessment); `findings-carry` artifact→capture_thought mapping; `merge.ts` preset-inject + user-override logWarning + missing-cross_review default (§3.2.1); observability log schema (§6.2) | `src/resources/extensions/gsd/phase-discipline/tests/*.test.ts` |
| Unit — PR-3a Δ-K1 kernel delta | pre-dispatch `advise` honoured when unit runnable; `advise` ignored with warn when not runnable; legacy `modify/skip/replace` paths unchanged; `unitId` override in `advise` propagates to `HookDispatchResult` | `src/resources/extensions/gsd/tests/pre-dispatch-advise.test.ts` (new) |
| Unit — `profile-dispatch` (v7.1) | Given fixture `STATE.json`, assert `advisedUnitType` matches expected next phase; P4→P5 strict-gating blocks when `EVIDENCE.md` missing; P2/P3 soft-gating advises but does not block; 3-consecutive-disagreement backoff stops advising; aggregate semantics under multiple active slices (§4.1 `slice_parallel`) | `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts` |
| Integration — preset-in-auto-mode | Temp repo with `prefs.milestone_profile = "phase-discipline-8step"`; run one milestone; assert unit order follows §3.1b.1 sequence; assert preset hooks appear in `rule-registry.listRules()`; confirm `milestone_profile = "auto"` case is byte-identical to pre-v7.1 (pre-PR-3a) | `src/tests/phase-discipline-integration.test.ts` (new) |
| Compatibility matrix — §4.1 interactions | For each row: set preference + `milestone_profile`; assert (a) expected interaction behaviour; (b) one-time warning emitted; (c) v1 does NOT auto-disable either | `src/tests/phase-discipline-compat.test.ts` (new) |
| Regression — hook engine | Existing post-unit-hooks / rule-registry / preferences tests remain green | existing paths, unchanged |
| E2E — `composed-lite` Lab (PR-2 gate) | 3 real runs pre- and post-extraction → byte-identical `.gsd/composed-lite/artifacts/*.md` sha256 and audit log seq segments | `tests/live-regression/composed-lite-extraction.ts` (new) |

**Not tested in v1**: real cross-provider API calls (env-limited); `cross_review` real subagent spawn (fully mocked); performance benchmarks (v1.1).

## 11. Upgrade sustainability — tracking `gsd-2` evolution

**Why v7 tracks upstream cleanly:**

- `phase-discipline/` depends only on the stable `post_unit_hooks` / `pre_dispatch_hooks` API surface. If `gsd-2` upstream changes `preferences` architecture, the preset re-merges into whatever new shape the API takes.
- `profile-dispatch.ts` returns `{action: "advise", advisedUnitType}` via the PR-3a kernel delta; it does not reach into `auto-dispatch.ts` scheduler heuristics. If the scheduler's unit-selection algorithm changes upstream, `profile-dispatch.ts` keeps working because its output is a *preference*, not an override.
- `shared-harness/` has 5 exported files with narrow interfaces plus an internal helper. A dedicated structural boundary test prevents bidirectional pollution with `composed-lite/`.
- `main`-side footprint after PR-3a + PR-3b is 4 files × (15–30 lines each) = ~80 lines; upstream rebases rarely conflict at this scope.
- No schema extensions to `STATE.json` / `SLICE-STATE.json` / `.gsd/preferences.yaml` top-level beyond one enum field (`milestone_profile`).
- No runtime version protocol between `shared-harness/` and its consumers (TypeScript types cover compat; see §0 rejected list).

**Where upgrade friction remains:**

- `composed-lite` Lab on `feat` needs periodic rebase against `main` until v1.4 capability parity. Post-PR-2 the rebase footprint is most of the 34 files (only `review-model-picker.ts` moves out; `subagent-spawn.ts` / `subagent-terminal.ts` are re-exported in place; `review-harness.ts` becomes a thin adapter). The bulk reduction from Lab retirement is v1.4 → full branch deletion, not PR-2.
- `shared-harness/reviewer-core.ts` is the one place where `composed-lite` and `phase-discipline` share surface; changes here need backward-compat or coordinated rebase.
- The `PreDispatchResult.advise` contract (from Δ-K1) is the kernel surface for `profile-dispatch.ts`. If this contract grows new fields upstream, `profile-dispatch.ts` must adopt — single-file coupling, narrow risk (R-11).

## 12. Capability migration path — v1.1 through v1.4 → composed-lite deletion

v7 replaces v6's time-based Lab retirement conditions (T1/T2/T3) with a **capability-parity roadmap**. The composed-lite runtime is deleted when every composed-lite-unique capability has been reimplemented as an auto-mode unit / hook / preference. Each version below slots a capability onto an already-existing phase in §3.1b:

| Version | Target | Host phase | Implementation shape | Delete from composed-lite |
|---|---|---|---|---|
| **v1** *(this spec)* | B-min 8-step skeleton + cross-review hooks | P2, P4, P6 | `milestone_profile` + 3 post-unit hooks + pre-dispatch hook | — (Lab only maintained) |
| **v1.1** | Admission-checklist hook on `discuss-milestone` | P0 | New post-unit hook `phase-discipline-admission` with 6–8 checklist items; `retry_on` pattern if checklist has unchecked items | composed-lite `phases/p0-admission.ts` |
| **v1.2** | Scout fan-out on `research-slice` | P1 | New `PreDispatchHookConfig` action type `fan-out: { count, models }`; fan-out N parallel scout subagents with merged artifact | composed-lite `phases/p1-research.ts` |
| **v1.3** | Impl-plan YAML schema validator | P2 → P3 boundary | Tighten `gsd_plan_slice` schema to require `rollback_hint`, `acceptance`, `files[]` per task; post-unit hook validates | composed-lite `phases/p3-split.ts` |
| **v1.4** | Verify-fuse strict mode | P5 | Preference `verify_fuse_on_fail?: boolean`; when true, `validate-milestone` failure blocks milestone close instead of carry-forward | composed-lite `phases/p5-verification.ts` + `phases/p6-synthesis.ts` |

**Retirement action at v1.4 capability parity** *(simplified in v7.1 because `main` never carried the composed-lite runtime — see §2.3)*:

1. Archive `feat/composed-lite-runtime-owned` as tag `composed-lite-lab-final`.
2. Delete `feat/composed-lite-runtime-owned` branch.
3. Remove the dispatcher special-cases on `main` that reference composed-lite-as-template (`commands-workflow-templates.ts`, `commands/handlers/workflow.ts`); these are small and survive as no-ops until then.
4. If `audit-log.ts` hash-chain machinery has another consumer by then, graduate it to `shared-harness/`; otherwise delete with the Lab.

(v7's step 1 "`git rm -r composed-lite/` on `main`" is removed because `main` has zero composed-lite files to begin with.)

**Why capability parity instead of time-based retirement.**

- Time-based triggers (T3 in v6: "6 months no commits") risk premature deletion before v1.4 lands.
- Usage-based triggers (T1 in v6: "v1+v1.1 covers 80%") are hard to measure without telemetry and presume phase-discipline is strictly a superset of composed-lite, which is only true after v1.4.
- Capability parity is a binary check per capability ("does admission work under auto-mode? yes/no"), each independently verifiable in CI.

**Fallback if a capability proves hard to port.** If any of v1.1–v1.4 hits an irreducible auto-mode limitation (e.g. the scheduler genuinely cannot express "strict verify-fuse"), the spec owner has two options: (a) defer the capability to v1.5+, keeping composed-lite Lab alive; (b) declare that capability permanently composed-lite-only and move composed-lite runtime into `main` as a long-term secondary entry. Option (b) would require a new v8 of this spec to un-retire Lab and should not be pursued without evidence; option (a) is the default.

**v1 does not trigger retirement.** v1 only ensures Lab maintenance cost stays bounded and proves the B-min skeleton works before the v1.1–v1.4 capability ports begin.

## 13. Risks (v7.1)

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | Preset merge cached at construction time defeats "edit `.gsd/preferences.yaml` → next unit sees it" guarantee | `merge.ts` is stateless; `resolvePostUnitHooks()` calls it fresh on every invocation (matches existing semantics at `rule-registry.ts:86-108`) |
| **R-2** *(v7 update)* | Reviewer cost invisible to budget diagnostics | **v1 interim:** §6.2 observability log persists per-reviewer `wall_clock_seconds` + `findings_counts` + `output_chars`, giving per-hook execution visibility even without token counts. **v1.1 full:** adds `unitType: "hook-review"` rows to `UnitMetrics` (~10 lines in `auto-post-unit.ts`); existing `getAverageCostPerUnitType` picks them up automatically. Downgraded from high to medium severity once v1 log lands |
| **R-3** *(v7 update)* | User `post_unit_hooks` with same `name` as preset shadow new preset fields on upgrade | §3.2.1 locks merge semantics (full replacement, no field-level merging, `cross_review` defaults to 1 when omitted by shadowing hook); `merge.ts` emits two logWarnings; `phase-discipline/README.md` documents with examples |
| **R-4** | `shared-harness/` import boundary erosion | Dedicated structural boundary test added in PR-2 landing commit; CI runs on every PR |
| **R-5** | Memory-store pollution from findings carry-forward | `phase-discipline-findings-to-memories` caps at 5 `gotcha` entries per slice; deduped by summary |
| **R-8** | `cross_review` × `max_cycles` × slice count multiplicatively amplifies cost | `cross_review` clamps to ≤ 5; default `max_cycles=2` not 3; v1.1 may add `cross_review_sample` |
| **R-9** *(updated v7.1)* | Feat Lab long-term fork maintenance | §12 capability migration path (v1.1→v1.4) replaces v6's time-based retirement; PR-2 removes `review-model-picker.ts` from the Lab-only surface but the bulk (~33 of 34 files) still rebases with main until v1.4. Rebase conflicts are bounded because the scheduler / preferences API is the only moving target and PR-3a adds to it rather than restructuring it |
| **R-10** | Users configure `cross_review_models` with all same provider | Not rejected; `reviewer-hook` emits `logWarning` listing reviewer providers so operator notices |
| **R-11** *(updated v7.1)* | `profile-dispatch` pre-dispatch hook breaks if `PreDispatchResult.advise` contract (Δ-K1) changes upstream | `profile-dispatch.ts` is 1 file with 1 contract surface. Single-file rebase; unit test coverage in §10 catches. If Δ-K1 evolves, we update `profile-dispatch.ts` in lockstep. Promoting `profile-map.ts` to a data file consumed by auto-dispatch natively is a v1.5 candidate only if Δ-K1 churn becomes a real pain. |
| **R-12** *(new v7)* | v1 observability log (§6.2) writes many small JSON files, inflating `.gsd/` directory size | Per-invocation file is ≤ 4KB typical; `.gsd/{mid}/{sid}/.phase-discipline/` dir for a busy milestone with 50 tasks × 2 hooks × 2 cycles = 200 files, ~800KB. Acceptable. Rotation / compression deferred to v1.1 if real measurement shows worse |
| **R-13** *(new v7.1)* | PR-3a kernel delta (Δ-K1) lands on main but proves misdesigned once real user-authored `advise` hooks exist | Δ-K1 is additive: legacy hook authors see zero behaviour change. If the advise semantics prove insufficient (e.g. need to advise a non-existent future unit), v1.x can extend the field shape; v1 consumers are only `phase-discipline/` itself. Mitigating factor: PR-3a's test coverage exercises both the honoured path and the fallback path, and is reviewed independently of the preset (§9). |
| **R-14** *(new v7.1)* | v1 strict gating is narrower than v7 advertised (only P4→P5); users may expect P2/P3 discipline from v1 that actually arrives in v1.3 | Spec language in §3.1b.3 explicitly documents the gating narrowing and points at v1.3. `§0 What v1 covers` lists P4→P5 as the only strict gate. Release notes for v1 must repeat this. No code-level mitigation possible — the artifact contract for P2/P3 simply does not exist yet. |

## 14. Alternatives considered

| Alt | Shape | Status |
|---|---|---|
| Overlay (v4.0's §8.4 PD1–PD9 contract + `OVERLAY-STATE.json` sidecar) | Phase-disciplined execution profile on top of auto-mode | **Retired in v5, re-confirmed in v6 and v7.** ≥ 10× complexity for same observable value |
| Sidecar state (v4.1) | Overlay-specific fields in `.gsd/<mid>/OVERLAY-STATE.json`; gate-evaluate evaluator injection | **Retired in v5, re-confirmed in v6/v7** |
| Preset-on-hook-engine (v5/v6, pure L1+L2) | Preference + preset merge into existing `post_unit_hooks` + 4 shared primitives; no milestone-level ordering | **Superseded by v7 B-min.** v6's approach was technically viable but missed the quality guarantee that comes from *phase ordering* (not just per-task review). v7 keeps everything v6 selected and adds the minimum skeleton. |
| **Preset + B-min skeleton (v7)** | v6 + `milestone_profile` enum + `profile-map.ts` + `profile-dispatch.ts` pre-dispatch hook | **Selected.** Implements §3 of this document |
| Parallel `composed-lite` runtime as a permanent main entry (Approach A in the v7 brainstorm) | Retain composed-lite runtime on main; phase-discipline as separate add-on | **Rejected.** Double-maintenance cost; upgrade friction grows unboundedly; conflicts with user goal of "as much reuse of auto-mode capability as possible" |
| Direct import of `composed-lite/` from `phase-discipline/` (no shared-harness) | Smallest patch | **Rejected (Section 1 Approach C).** Permanently couples `phase-discipline/` to Lab code; makes composed-lite removal impossible |
| `reviewer_model` new field | Explicit reviewer-only field | **Rejected in v6, re-confirmed in v7.** `model?` already exists with equivalent semantics; creates precedence ambiguity |
| `SHARED_HARNESS_API_VERSION` runtime version protocol | Consumer-side version assert | **Rejected in v7.** TypeScript types cover compat; 5-file monorepo extraction does not justify runtime checks |
| Explicit `.review-overrides.md` verdict-override mechanism | Agent or human can override review verdict per task | **Rejected in v7.** v6 already provides two human-intervention windows (`max_cycles` exhaustion → findings-carry; `extract-learnings` batch promotion). Adding a third mechanism preemptively is over-engineering; revisit only if real abuse cases emerge. Tracked as OQ-9 |

## 15. Open questions (v1.1 candidates)

Each OQ names the primary source of evidence needed to promote it from open to decided; v1 does not commit to any of them.

- **OQ-3** — Milestone-closure cross-review. Symmetric to slice-closure at milestone scope. Evidence: milestone-scope findings that do not surface from slice-scope review. v1.1 after cost baseline (OQ-7).
- **OQ-4** ✅ — `model_fallbacks: string[]` implemented on `PostUnitHookConfig`. When all primary reviewers fail, fallbacks are tried in order. Validated by `preferences-validation.ts` + 2 unit tests (fallback-success + all-exhausted). Evidence collection enabled via OQ-7 structured logs.
- **OQ-5** *(v7)* — Adaptive phase skipping under `phase-discipline-8step`. e.g. a docs-only milestone skipping P5 verification. v1 forces all 8 phases; docs-only tasks currently produce trivially-passing `validate-milestone`. Evidence: user complaints about redundant phase traversal.
- **OQ-6** — Cross-milestone explicit `pending-findings.yaml`. If memories-based carry (ADR-013) dilutes high-fidelity findings, re-introduce explicit file + admission prompt. v1.1 decision, gated on user evidence.
- **OQ-7** ✅ — Hook-level structured metrics implemented. `writeObservabilityLog` now includes `wallClockMs` and per-reviewer `reviewerMetrics` array (status/outputChars/attempts). Consumed from `.phase-discipline/*.json` logs.
- **OQ-8** *(v7)* — CI lint for `mergePresetIntoHooks` dry-run on `.gsd/preferences.yaml`. Emits PR-time warning when user hooks shadow preset hooks whose field set has changed. Low cost to implement; defer to v1.1 only because there is no field-change to detect yet.
- **OQ-9** *(v7)* — Reviewer verdict override mechanism. Shape TBD (file-based, prompt-based, or new `gsd_memory_graph` category). Evidence needed: at least one real case where a `critical` finding was a false positive and the user had to work around the preset. Placeholder only; not a v1.1 commitment.
- **OQ-10** ✅ — Full stdout/stderr capture implemented. Each reviewer writes `{hook}-{tid}-reviewer{N}-stdout.log` and `-stderr.log` to `.phase-discipline/` directory. Both success and failure paths covered.
- **OQ-11** *(v7)* — Phase-discipline preset docs-map L1 inheritance. Currently reviewers do not call `loadAgentsSection(hint)` (§4.5). If a hook prompt frequently needs the same L1 file, explore hook-prompt-level routing. Evidence needed: repeated `read_file(".gsd/docs-map/...")` pattern in hook outputs.
- **OQ-12** *(new v7.1)* — Per-milestone profile opt-out. Add `milestone_overrides[mid].milestone_profile` YAML block + make `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` `milestoneId`-aware. Deferred from v1 because it requires 2 more preferences signature changes; v1 covers global opt-in only. Evidence: users who want to run profile on some milestones but not others in the same project.

## 16. Change log

| Version | Date | Summary |
|---|---|---|
| **v7.1** | 2026-04-23 | Post-review factual correction pass. 8 issues flagged by receiving-code-review were verified against current `main` and all 8 accepted. Key corrections: (1) §2.3/§2.4 — `main` contains **0** composed-lite files, not 30 (v6/v7 error); (2) §3.1a — pre-dispatch hook contract does NOT support `preferredNextUnit`; landing v1 requires kernel delta Δ-K1 (`PreDispatchResult.action: "advise"` + `advisedUnitType` / `advisedUnitId`); (3) §3.1 — `milestone_overrides` does not exist; v1 drops per-milestone opt-out claim (deferred to OQ-12); (4) §3.1b split into 3.1b.1 (scheduler-owned phases) + 3.1b.2 (out-of-band workflows); `extract-learnings` is not a dispatch unit; (5) §3.1b.3 — strict gating narrowed from P2→P3→P4→P5 to P4→P5 only (others lack `completionArtifact` contract until v1.3); (6) §4 data flow no longer claims "v1 has no pre-dispatch preset addition"; (7) §4.1 new profile compatibility matrix for `reactive_execution` / `gate_evaluation` / `slice_parallel` / `parallel` / `phases.skip_*` / `progressive_planning` / `mid_execution_escalation` / `require_slice_discussion` / `enhanced_verification`; (8) §1 retry_pattern tombstoned (does not exist). PR-3 split into PR-3a (Δ-K1 kernel delta, ~120 lines in types.ts + rule-registry.ts + auto-dispatch.ts + tests) and PR-3b (preset + extension, ~310 lines). Status downgraded from "accepted for implementation" to "design draft with required kernel deltas" — the spec is ready to drive PR-3a scoping discussion but not yet to be implemented verbatim. Added R-13 (kernel delta post-land misdesign risk) and R-14 (strict-gating narrowing expectation-management). Added OQ-12 (per-milestone opt-out). **Post-action-plan addendum (2026-04-23 later same day):** a second receiving-code-review pass re-verified all 8 corrections against current `src/` source (not `dist-test/` / `dist/`) and confirmed them accurate. Three documents-only additions followed: (a) `specs/README.md` gained an "Implementation sequencing hard constraints" section with explicit No-Go / Go tables, (b) this spec's §9 gained §9.0 "Implementation readiness gate" with a 5-row anchor-verification table and a hard `PR-3b-after-PR-3a` ordering constraint, (c) `composed-lite-harness-brainstorm.md` received a top-of-file DEPRECATED banner pointing readers at the 4 authoritative specs. No technical decisions changed; this addendum is prescriptive guidance for implementers. §9 title also corrected from "3 independent PRs" to "4 independent PRs" (v7.1 already split PR-3 → PR-3a + PR-3b but the title had not been updated). **Third-review addendum (2026-04-23 after a third receiving-code-review pass):** a third reviewer evaluated whether the v7.1 spec was ready to drive implementation plans and accepted 4 of 4 substantive suggestions. Five spec-level edits followed: (1) **PR dependency graph corrected** — `PR-3a` has NO code dependency on `PR-2`; README migration-order table + §9 branch-strategy table + §9.1 Rollout order all rewritten to reflect that PR-1 / PR-2 / PR-3a / PR-4 are four parallel tracks and PR-3b is the sole three-way merge point. The v7.1 "PR-3a after PR-2" serialisation was a workflow-convenience choice misencoded as a hard dependency. (2) **§3.1a Integration with `DISPATCH_RULES`** — new subsection pins down the honour-advise implementation path as a prefix `DispatchRule` at index 0 of `DISPATCH_RULES`, reusing existing stock-rule `match()` for runnable judgement rather than inventing a new judgement function. Answers evaluator questions about runnable judgement, multi-candidate `unitId`, short-circuit-vs-re-evaluation, and line-count realism (net ~125 lines). Includes a rejected-alternative bullet for the evaluator-suggested "hard hint on preferences" approach. (3) **§1 explicit non-goal statement** — `"phase-discipline-8step"` in v1 is explicitly not composed-lite parity; it is "8-phase ordered skeleton with partial hard gating (P4→P5 only)". Prevents post-ship scope-expectation disputes. (4) **§3.2.1 Validation order** — locks `mergePresetIntoHooks()` sequence as load-raw → validate → merge → re-validate → resolve; downstream consumers never see a half-constructed preset hook. Answers evaluator question on "validation before or after merge". (5) **§5 Reviewer execution status enum** — canonical 6-status enum (`success` / `timeout` / `parse-failure` / `auth-failure` / `rate-limit` / `reviewer-unavailable`) + concrete all-fail artifact shape with `overall: reviewer_unavailable` marker for `retry_on` matching. Answers evaluator question on "parse failure / auth failure / timeout unified status enum". No new technical decisions introduced; all five are clarifications / contract-tightenings that were implied but not written. Third review's meta-conclusion "可以推进到实施计划阶段，但不适合直接开始实现" remains correct — these edits make the spec implementation-plan-ready (v1 scope frozen, v1.1+ slots documented). |
| **v7** | 2026-04-23 | B-min skeleton addition following receiving-code-review evaluation of v6. Core additions: (1) `milestone_profile: "auto" \| "phase-discipline-8step"` preference (§3.1) replaces v6's `phase_discipline?` boolean; (2) `profile-map.ts` + `profile-dispatch.ts` B-min skeleton (§3.1a, §3.1b) enforces 8-phase ordering via pre-dispatch hook; (3) §3.2.1 hook-conflict resolution rules (name shadowing + missing `cross_review` defaults to 1); (4) §4.5 docs-map ↔ preset context-flow contract locks reviewer subagent context inheritance; (5) §6.2 observability v1 — `.gsd/{mid}/{sid}/.phase-discipline/*.json` per-hook structured log; (6) §9 PR-0 branch strategy moves phase-discipline work off `feat/composed-lite-runtime-owned` onto `feat/phase-discipline-preset-v1` cut from main; (7) §12 replaces v6's time-based T1/T2/T3 retirement with v1.1–v1.4 capability migration roadmap (admission, scout fan-out, impl-plan-YAML, verify-fuse). R-2 severity reduced with v1 interim visibility; R-3 tightened via §3.2.1; added R-11 (profile-dispatch upstream contract risk) and R-12 (observability log dir size). New OQs: OQ-5 adaptive skip, OQ-8 merge-lint CI, OQ-9 verdict override (rejected), OQ-10 reviewer stdout/stderr capture, OQ-11 reviewer docs-map inheritance. Rejected: `SHARED_HARNESS_API_VERSION` runtime version protocol. Decisions locked: **A + a' + Ω1 + Φa + L1+L2 + Π₈**. |
| **v6** | 2026-04-23 | Ground-up rewrite following L1+L2 / Approach A brainstorm. Split AGENTS.md docs-map → own spec; split CLI tool-restriction chain → own spec. Dropped `reviewer_model?` (reuse `model?`). Dropped `impl-plan-schema-validate` + `cmd-verify` + `findings-store` + `verification-executor` as duplicates of `enhanced_verification`. `shared-harness` is 5 files (not 6); `phase-discipline` is 4 files (not 5, v7 re-expands to 6). Added §12 Feat Lab retirement conditions (later replaced by v7's capability roadmap). Added R-8/R-9/R-10. Preset renamed `"composed-lite-slice"` → `"phase-discipline-v1"` (later renamed to `"phase-discipline-8step"` in v7). Net spec drops ~70 lines while covering more decisions with cleaner boundaries. Decisions locked (v6): **A + a + Ω1 + Φa + L1+L2**. |
| **v5** | 2026-04-23 | Overlay retirement; preset-on-hook-engine selected; `composed-lite` runtime stays on `feat`; 6-file shared-harness extraction; 3-PR plan. Superseded by v6 (one-line summary retained; full prose removed). |
| **v4.x** | 2026-04-23 | Overlay contract (PD1–PD9) + sidecar state + Alt I. Retired in v5. Full prose in `git log`. |
| **v3.x** | 2026-04-22/23 | Baseline recalibration; Layer 1/2 runtime-control contract. Retired in v5. Full prose in `git log`. |
| **v1–v2** | 2026-04-22 | composed-lite-as-harness proposal → auto-mode-as-host reversal. Full prose in `git log`. |
