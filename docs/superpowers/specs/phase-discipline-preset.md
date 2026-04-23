# Auto-Mode Phase Discipline Preset (v6)

> **File note** — this file keeps its git history from `composed-lite-harness-brainstorm.md` (renamed 2026-04-23 after v5→v6 pivot). v6 is a ground-up rewrite; the v1–v5 history is compressed to §16's changelog with one-line entries. Two orthogonal specs were split out in the same rewrite:
>
> - **AGENTS.md docs-map v1** → `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md`
> - **CLI tool-restriction chain (M0)** → `docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md`

## 0. Summary & scope

**What we are building (v1):** an opt-in preference that turns on a **named preset of `post_unit_hooks` + new `PostUnitHookConfig` fields** so every task and every slice inside an `auto-mode` milestone gets multi-model cross-reviewed. No new execution layer, no overlay, no runtime migration.

**What v1 covers:**

- `execute-task` code-review cross-review loop (L1)
- `plan-slice` / `refine-slice` design-review cross-review loop (L2)
- `complete-slice` findings-to-memories promotion

**What v1 does NOT cover (deliberate, not accidents):**

- `composed-lite` P0 admission gate (needs `auto-dispatch` slice-start gate — kernel change, L4)
- `composed-lite` P1 scout fan-out (needs new `PreDispatchHookConfig` action type — kernel change, L3)
- `composed-lite` P3 impl-plan YAML schema (auto-mode does not produce this artifact — requires changing `plan-slice`/`refine-slice` prompt contract, L3)
- Machine verification hook (`enhanced_verification` already covers it — identified as duplicate in §3.4)
- Cross-milestone `pending-findings.yaml` (ADR-013 memories channel is enough for v1)

**Rejected entirely:**

- Any new `auto-mode` overlay layer (v4.1's PD1–PD9 matrix, `OVERLAY-STATE.json` sidecar) — v5 retired this; v6 reconfirms
- Any `--phase-discipline` CLI flag — preference-only
- Any `RuntimeOwnedExecutor` interface generalisation on `main`
- `composed-lite` runtime upstream migration — runtime stays on `feat/composed-lite-runtime-owned` as Lab; see §12 retirement conditions
- Adding a new `reviewer_model?` field — `PostUnitHookConfig.model?` already exists on `main` and is reused

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
| Per-reviewer retry semantics | `retry_on` + `retry_pattern` |
| Hook-on-hook prevention + idempotency + cycle-limit | `rule-registry.evaluatePostUnit` already implements |

**The sole genuine gaps** (closed by v1):

- No **fan-out** to N parallel reviewers on the same hook invocation
- No explicit `provider` override alongside `model` (only `model` is implicit provider hint today)

Both gaps are closed by 2 new optional fields on `PostUnitHookConfig` (+ 1 on `PreDispatchHookConfig`). Nothing else changes in the hook engine.

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

### 2.3 `main` already contains 30 `composed-lite` files

`git ls-tree -r main -- src/resources/extensions/gsd/composed-lite` = 30 files including `runner.ts`, `state.ts`, `phases/p0-p7`, `review-harness.ts`, etc. These are **not** referenced by any `main` entrypoint: `registry.json` on `main` has no `composed-lite` template entry, and `commands-workflow-templates.ts:353`, `:598`, `commands/handlers/workflow.ts:157` have runtime-owned special-cases pointing to `composed-lite` that are **dead code paths** on `main` (no template → no dispatch). v6 does not touch these dead paths; they remain harmless.

### 2.4 `feat/composed-lite-runtime-owned` delta over `main`

19 files changed (+2008/-644), all inside `composed-lite/`. These are runtime hardening (anti-drift guards, `subagent-spawn/terminal`, `pending-review-findings`), not new capabilities. v6's PR-2 extracts 4 state-agnostic primitives up into `shared-harness/`; the remaining `composed-lite` runtime stays on `feat` as Lab.

## 3. Design (A + a + Ω1 + Φa + L1+L2)

Locked decisions from the v6 brainstorm pass (2026-04-23):

| # | Decision | Consequence |
|---|---|---|
| **A** | Max-reuse existing hook engine, preferences, rule-registry | No overlay skeleton, no sidecar state, no flag |
| **a** | Slice-internal discipline; inter-slice scheduling stays adaptive | No milestone-phase matrix, no `auto-dispatch.ts` rewrite |
| **Ω1** | Code lives inside `gsd` extension as `phase-discipline/`, sibling to `composed-lite/` | No new extension, no cross-extension contract |
| **Φa** | Migrate only 4 shared primitives; `composed-lite` runtime stays on `feat` | `/gsd start composed-lite` is not a `main` user entrypoint |
| **L1+L2** | v1 covers code-review (L1) + design-review (L2) loops only | Admission (L4), scout fan-out + impl-plan YAML (L3) deferred or out of scope |

### 3.1 Opt-in surface

`@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts` gains a single field on `GSDPreferences`:

```ts
phase_discipline?: boolean | "phase-discipline-v1";
```

`true` ≡ `"phase-discipline-v1"`. Default `undefined` / `false` → byte-identical legacy behaviour. Per-milestone overrides use the existing `milestone_overrides` mechanism (no new code).

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

### 3.3 The `"phase-discipline-v1"` preset — 3 hooks (authoritative list)

| Hook name | Kind | Trigger | Semantics |
|---|---|---|---|
| `phase-discipline-code-review` | post-unit | after `execute-task` | Cross-review every completed task with N reviewers (default `cross_review=2`, `max_cycles=2`). Exhausted → findings written to artifact and carried. |
| `phase-discipline-design-review` | post-unit | after `plan-slice` AND `refine-slice` | Cross-review each slice plan (default `cross_review=2`, `max_cycles=2`). Exhausted → artifact carries. If review verdict = `fail`, re-run `refine-slice` via `retry_on` naming. |
| `phase-discipline-findings-to-memories` | post-unit | after `complete-slice` | Prompt drives main session to read the slice artifact directory, call `capture_thought` for unresolved `*-findings.md` / `*-review.md` entries, tagged `gotcha`. Cap 5 entries per slice-close. `max_cycles=1`, no review. |

**Deliberately NOT in v1**:

- `execute-task` cmd-verify hook → `enhanced_verification` is a direct duplicate
- `plan-slice` impl-plan-yaml schema validator → auto-mode does not produce the artifact
- Milestone-closure cross-review → no cost baseline yet (OQ-4 in §15)

### 3.4 Directory layout

#### `src/resources/extensions/gsd/shared-harness/` (new, 5 files)

```
shared-harness/
├── reviewer-core.ts          # runReview({projectRoot, model, provider, systemPrompt, reviewPrompt, targetContent, maxAttempts}) → ReviewResult
├── review-model-picker.ts    # pickCrossReviewers(primaryModel, primaryProvider, count) → Array<{model, provider}>
├── subagent-spawn.ts         # re-export of composed-lite/subagent-spawn.ts (state-agnostic)
├── subagent-terminal.ts      # re-export of composed-lite/subagent-terminal.ts (state-agnostic)
└── index.ts                  # barrel exports + module-boundary comment
```

**Scope guard** — `shared-harness/*` imports from `./` or `../` but **never from `../composed-lite/`** or `../phase-discipline/`. ESLint `no-restricted-paths` enforces this in PR-2's landing commit (non-negotiable).

#### `src/resources/extensions/gsd/phase-discipline/` (new, 4 files + README)

```
phase-discipline/
├── preset.ts            # exports phaseDisciplineV1Preset: {postUnitHooks: PostUnitHookConfig[], preDispatchHooks: PreDispatchHookConfig[]}
├── reviewer-hook.ts     # cross_review fan-out runner, calls shared-harness/reviewer-core N times in parallel, union-merges findings
├── findings-carry.ts    # prompt template + artifact-dir path helper for the findings-to-memories hook; invoked by preset.ts to assemble the hook prompt string
├── merge.ts             # mergePresetIntoHooks(userHooks, presetHooks) — user names override preset; emits logWarning on shadow
└── README.md            # design pointers + cross-refs §3-§8 of this document
```

**No new unit type, no new DispatchRule, no new CLI command.** `reviewer-hook.ts` is not a new mechanism — it's the body of the preset's hook prompts' execution path when `cross_review > 1`.

#### `main`-side edits (2 files, additive only; estimated ~25 lines total)

| File | Change |
|---|---|
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences-types.ts` | Add `phase_discipline?: boolean \| "phase-discipline-v1"` to `GSDPreferencesFields`; add `provider?`, `cross_review?`, `cross_review_models?` to `PostUnitHookConfig`; add `provider?` to `PreDispatchHookConfig` |
| `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/preferences.ts` | In `resolvePostUnitHooks()` / `resolvePreDispatchHooks()`: if `prefs.phase_discipline` ∈ `{true, "phase-discipline-v1"}`, delegate to `phase-discipline/merge.ts` for preset injection. User-authored hook with same `name` takes precedence over preset |

**Not modified in v1**: `auto-post-unit.ts` (metrics wiring is v1.1; see R-2); `rule-registry.ts` (no new rule shape); `auto-dispatch.ts` (no new schedule path).

## 4. Data flow

```
auto-mode rule-registry.listRules()
         │
         ├─ dispatch rules          (unchanged)
         ├─ post_unit_hooks         ◄── preferences.resolvePostUnitHooks()
         │                               ↑
         │                               merge(userHooks, presetHooksIfOptedIn)
         ├─ pre_dispatch_hooks      (v1 has no preset addition)
         │
         └─ hook fires:
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

The `rule-registry` / `auto-post-unit` / `preferences` layers **never learn** about "reviewer" as a concept. They see a regular post-unit hook that happens to take longer and produce richer output. All fan-out logic is local to `phase-discipline/reviewer-hook.ts`.

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
| User-authored hook with same `name` as preset | User takes precedence; `merge.ts` emits `logWarning` (R-3 mitigation) |
| `prefs.phase_discipline` = unknown string | Treated as `false`; `logWarning` |
| `cross_review` = 1 or unset | Byte-identical legacy single-reviewer path |
| `cross_review` > 5 | Silently clamped to 5 (R-8 safeguard) |
| All reviewers same provider (cross_review_models or picker edge case) | Runs anyway; `logWarning` emitted at hook spawn |
| Recursion (hook-on-hook) | Existing `rule-registry.evaluatePostUnit` guard prevents; unchanged |
| Parallel reviewer session state | Each reviewer spawned with `--no-session` (existing composed-lite convention); no cross-talk |

## 9. Migration plan — 3 independent PRs

Each PR is independently reviewable and landable. Later PRs depend on earlier ones only for the new code paths to be wired.

### PR-1 — CLI tool-restriction chain (M0 only)

Split to its own spec: `docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md`. Orthogonal to phase-discipline; benefits every `--tools`-restricted subagent regardless of preset opt-in. Not described further here.

### PR-2 — `shared-harness/` extraction

**Scope** (on `feat/composed-lite-runtime-owned`, merges to `main`):

1. `shared-harness/reviewer-core.ts` ← extract from `composed-lite/review-harness.ts` (decouple from `ComposedLiteState`; take plain input struct)
2. `shared-harness/review-model-picker.ts` ← extract from `composed-lite/review-model-picker.ts` (already state-agnostic; just moves)
3. `shared-harness/subagent-spawn.ts` ← re-export of `composed-lite/subagent-spawn.ts` (no code change)
4. `shared-harness/subagent-terminal.ts` ← re-export of `composed-lite/subagent-terminal.ts` (no code change)
5. `shared-harness/index.ts` ← new barrel

**`composed-lite` is rewritten on `feat` as a consumer** — `review-harness.ts` becomes a thin `runReview(buildInputFromState(...))` adapter. The `composed-lite` runtime's observable behaviour is byte-identical (enforced by §10 regression gate).

**ESLint `no-restricted-paths`** enforces: `shared-harness/*` cannot import `composed-lite/` or `phase-discipline/`. Rule is added in the PR-2 landing commit.

### PR-3 — `phase-discipline/` preset + preferences extension

**`main`-side edits (2 files)**:

| File | Change |
|---|---|
| `preferences-types.ts` | Add `phase_discipline?` field; add `provider? / cross_review? / cross_review_models?` to `PostUnitHookConfig`; add `provider?` to `PreDispatchHookConfig` |
| `preferences.ts` | `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` call `phase-discipline/merge.ts` when preset opted-in |

**New `phase-discipline/` directory** (4 files + README as in §3.4).

**Rollout order** — PR-1 lands standalone (no dependency). PR-2 lands after PR-1 (makes `shared-harness/` available). PR-3 lands after PR-2 (consumes `shared-harness/`).

## 10. Testing strategy

| Layer | Coverage | Location |
|---|---|---|
| Unit — `shared-harness` | `reviewer-core.runReview` contract; mock subagent-spawn verifies single-reviewer path; partial-JSON parse robustness | `src/resources/extensions/gsd/shared-harness/tests/*.test.ts` |
| Unit — `phase-discipline` | `reviewer-hook` fan-out (N=2, N=3, N=5 clamp, single-reviewer fallback); merge logic (union dedupe, worst assessment); `findings-carry` artifact→capture_thought mapping; `merge.ts` preset-inject + user-override logWarning | `src/resources/extensions/gsd/phase-discipline/tests/*.test.ts` |
| Integration — preset-in-auto-mode | Temp repo with `prefs.phase_discipline = true`; run one `execute-task`; assert preset hook appears in `rule-registry.listRules()`; confirm disabled case is byte-identical | `src/tests/phase-discipline-integration.test.ts` (new) |
| Regression — hook engine | Existing post-unit-hooks / rule-registry / preferences tests remain green | existing paths, unchanged |
| E2E — `composed-lite` Lab (PR-2 gate) | 3 real runs pre- and post-extraction → byte-identical `.gsd/composed-lite/artifacts/*.md` sha256 and audit log seq segments | `tests/live-regression/composed-lite-extraction.ts` (new) |

**Not tested in v1**: real cross-provider API calls (env-limited); `cross_review` real subagent spawn (fully mocked); performance benchmarks (v1.1).

## 11. Upgrade sustainability — tracking `gsd-2` evolution

**Why v6 tracks upstream cleanly:**

- `phase-discipline/` depends only on the stable `post_unit_hooks` / `pre_dispatch_hooks` API surface. If `gsd-2` upstream changes `preferences` architecture, the preset re-merges into whatever new shape the API takes.
- `shared-harness/` has 5 files with narrow interfaces. ESLint `no-restricted-paths` prevents bidirectional pollution with `composed-lite/`.
- `main`-side footprint is 2 files × ~15 lines; upstream rebases rarely conflict at this scope.
- No schema extensions to `STATE.json` / `SLICE-STATE.json` / `.gsd/preferences.yaml` top-level beyond one enum field.

**Where upgrade friction remains:**

- `composed-lite` Lab on `feat` needs periodic rebase against `main`. Post-PR-2 the rebase footprint is `composed-lite/runner.ts` + `phases/` + `state.ts` + `audit-log.ts` (~24 files), down from 30 today. See §12 for retirement conditions.
- `shared-harness/reviewer-core.ts` is the one place where `composed-lite` and `phase-discipline` share surface; changes here need backward-compat or coordinated rebase.

## 12. Feat Lab retirement conditions

`feat/composed-lite-runtime-owned` is maintained as Lab with:

- **Keep condition** — `composed-lite/runner.ts` + `phases/*` + `state.ts` + `audit-log.ts` remain on `feat`. Each `main → feat` merge rebases only these. Other `composed-lite/*` files (review-harness, subagent-spawn, subagent-terminal, review-model-picker after PR-2) are thin consumers and rebase with zero-to-low friction.
- **Retirement trigger (any of)** —
  - **T1** — phase-discipline v1 + v1.1 (OQ-3 + OQ-4) empirically covers ≥ 80% of real-project composed-lite usage
  - **T2** — `auto-mode` kernel gains scout fan-out (L3) or slice-admission gate (L4), making composed-lite's remaining phases expressible via preset/extension
  - **T3** — Lab has 6 months of no new commits and user explicitly abandons the path
- **Retirement action** — `git rm -r composed-lite/` on `main` (removing the 30 dead-code files) + archive `feat` as tag `composed-lite-lab-final` + delete branch.

**v1 does not trigger retirement.** v1 only ensures Lab maintenance cost stays bounded.

## 13. Risks (v6)

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | Preset merge cached at construction time defeats "edit `.gsd/preferences.yaml` → next unit sees it" guarantee | `merge.ts` is stateless; `resolvePostUnitHooks()` calls it fresh on every invocation (matches existing semantics at `rule-registry.ts:86-108`) |
| **R-2** | Reviewer cost invisible to budget diagnostics | v1.1 adds `unitType: "hook-review"` rows to `UnitMetrics` (~10 lines in `auto-post-unit.ts`); existing `getAverageCostPerUnitType` picks them up automatically. v1 accepts the gap |
| **R-3** | User `post_unit_hooks` with same `name` as preset shadow new preset fields on upgrade | `merge.ts` emits `logWarning` on name collision; document precedence explicitly in `phase-discipline/README.md` |
| **R-4** | `shared-harness/` import boundary erosion | ESLint `no-restricted-paths` added in PR-2 landing commit; CI runs on every PR |
| **R-5** | Memory-store pollution from findings carry-forward | `phase-discipline-findings-to-memories` caps at 5 `gotcha` entries per slice; deduped by summary |
| **R-8** | `cross_review` × `max_cycles` × slice count multiplicatively amplifies cost | `cross_review` clamps to ≤ 5; default `max_cycles=2` not 3; v1.1 may add `cross_review_sample` |
| **R-9** | Feat Lab long-term fork maintenance | §12 retirement conditions; PR-2 reduces rebase footprint to 24 of 30 files with zero conflict on the extracted 6 |
| **R-10** | Users configure `cross_review_models` with all same provider | Not rejected; `reviewer-hook` emits `logWarning` listing reviewer providers so operator notices |

## 14. Alternatives considered

| Alt | Shape | Status |
|---|---|---|
| Overlay (v4.0's §8.4 PD1–PD9 contract + `OVERLAY-STATE.json` sidecar) | Phase-disciplined execution profile on top of auto-mode | **Retired in v5, re-confirmed in v6.** ≥ 10× complexity for same observable value |
| Sidecar state (v4.1) | Overlay-specific fields in `.gsd/<mid>/OVERLAY-STATE.json`; gate-evaluate evaluator injection | **Retired in v5, re-confirmed in v6** |
| Preset-on-hook-engine (v5/v6) | Preference + preset merge into existing `post_unit_hooks` + 4 shared primitives | **Selected.** Implements §3 of this document |
| Direct import of `composed-lite/` from `phase-discipline/` (no shared-harness) | Smallest patch | **Rejected (Section 1 Approach C).** Permanently couples `phase-discipline/` to Lab code; makes composed-lite removal impossible |
| `reviewer_model` new field | Explicit reviewer-only field | **Rejected in v6.** `model?` already exists with equivalent semantics; creates precedence ambiguity |

## 15. Open questions (v1.1 candidates)

- **OQ-3** — Milestone-closure cross-review. Symmetric to slice-closure at milestone scope. v1.1 after cost baseline.
- **OQ-4** — `reviewer_model_fallbacks: string[]`. If reviewer outages are common, extend `model` to support fallback chain mirroring existing `GSDPhaseModelConfig`.
- **OQ-5** — `cross_review_sample: number` ∈ (0, 1]. Sampling rate for cross-reviewers to control cost at scale.
- **OQ-6** — Cross-milestone explicit `pending-findings.yaml`. If memories-based carry (ADR-013) dilutes high-fidelity findings, re-introduce explicit file + admission prompt. v1.1 decision, gated on user evidence.
- **OQ-7** — Hook-level cost metrics wiring (R-2). 10-line change in `auto-post-unit.ts`; v1.1.

## 16. Change log

| Version | Date | Summary |
|---|---|---|
| **v6** | 2026-04-23 | Ground-up rewrite following L1+L2 / Approach A brainstorm. Split AGENTS.md docs-map → own spec; split CLI tool-restriction chain → own spec. Dropped `reviewer_model?` (reuse `model?`). Dropped `impl-plan-schema-validate` + `cmd-verify` + `findings-store` + `verification-executor` as duplicates of `enhanced_verification`. `shared-harness` is 5 files (not 6); `phase-discipline` is 4 files (not 5). Added §12 Feat Lab retirement conditions. Added R-8/R-9/R-10. Preset renamed `"composed-lite-slice"` → `"phase-discipline-v1"`. Net spec drops ~70 lines while covering more decisions with cleaner boundaries. Decisions locked: **A + a + Ω1 + Φa + L1+L2**. |
| **v5** | 2026-04-23 | Overlay retirement; preset-on-hook-engine selected; `composed-lite` runtime stays on `feat`; 6-file shared-harness extraction; 3-PR plan. Superseded by v6 (one-line summary retained; full prose removed). |
| **v4.x** | 2026-04-23 | Overlay contract (PD1–PD9) + sidecar state + Alt I. Retired in v5. Full prose in `git log`. |
| **v3.x** | 2026-04-22/23 | Baseline recalibration; Layer 1/2 runtime-control contract. Retired in v5. Full prose in `git log`. |
| **v1–v2** | 2026-04-22 | composed-lite-as-harness proposal → auto-mode-as-host reversal. Full prose in `git log`. |
