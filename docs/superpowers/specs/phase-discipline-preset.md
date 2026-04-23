# Auto-Mode Phase Discipline Preset (v7)

> **File note** — this file keeps its git history from `composed-lite-harness-brainstorm.md` (renamed 2026-04-23 after v5→v6 pivot; v7 rewrites on 2026-04-23 to add a B-min 8-step profile skeleton and close six review gaps). The v1–v5 history is compressed to §16's changelog with one-line entries. Two orthogonal specs were split out in the v6 rewrite:
>
> - **AGENTS.md docs-map v1** → `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md`
> - **CLI tool-restriction chain (M0)** → `docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md`
>
> An integration overview spanning all three specs lives at `docs/superpowers/specs/README.md`.

## 0. Summary & scope

**What we are building (v1 — B-min):** an opt-in preference `milestone_profile: "phase-discipline-8step"` that (a) turns on the same three `post_unit_hooks` as v6 (code-review / design-review / findings-to-memories) **and** (b) attaches a lightweight scheduler skeleton that forces an `auto-mode` milestone to traverse the 8 composed-lite phases in order, using unit types the scheduler already has. No new execution layer, no overlay, no separate runtime. v1 is the minimum skeleton that lets v2–v1.4 migrate composed-lite's remaining capabilities (admission, scout fan-out, impl-plan-YAML, verify-fuse) one by one without rework.

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
| Per-reviewer retry semantics | `retry_on` + `retry_pattern` |
| Hook-on-hook prevention + idempotency + cycle-limit | `rule-registry.evaluatePostUnit` already implements |

**The sole genuine gaps** (closed by v1):

- No **fan-out** to N parallel reviewers on the same hook invocation
- No explicit `provider` override alongside `model` (only `model` is implicit provider hint today)

Both gaps are closed by 2 new optional fields on `PostUnitHookConfig` (+ 1 on `PreDispatchHookConfig`). Nothing else changes in the hook engine.

**v7 adds one more narrow gap:** `auto-mode`'s scheduling is adaptive (good default), but has no way to say *"for this milestone, walk the 8 composed-lite phases in order"*. The B-min skeleton (§3.1a + §3.1b) closes that gap by adding a single `milestone_profile` preference and a `profile-dispatch.ts` pre-dispatch hook that biases the scheduler's next-unit choice when the profile is opted in. The scheduler internals remain untouched; the hook runs in the existing `runPreDispatchHooks` pipeline.

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

`undefined` ≡ `"auto"` ≡ byte-identical legacy behaviour. `"phase-discipline-8step"` activates both (a) the three `post_unit_hooks` of §3.3 **and** (b) the 8-step scheduler skeleton of §3.1a. Per-milestone overrides use the existing `milestone_overrides` mechanism (no new code).

**v6's field `phase_discipline?: boolean | "phase-discipline-v1"` is dropped in v7.** Rationale: a single field expressing both *"which preset of hooks"* and *"which milestone ordering"* is cleaner than two fields, and no v1 preset exists without the skeleton. If a future user wants hooks without ordering, they can author their own hook list against the `cross_review` surface (§3.2) — that path is still open; it just does not have a named preset in v1.

### 3.1a `milestone_profile: "phase-discipline-8step"` — the B-min skeleton

When the profile is active, a single pre-dispatch hook `phase-discipline-profile-dispatch` runs inside the existing `runPreDispatchHooks()` pipeline and biases the scheduler's next-unit choice against the ordered sequence in §3.1b. The hook does not mutate `auto-dispatch.ts` internals; it returns a `preferredNextUnit` field that the existing pipeline already honours for user-authored pre-dispatch rules.

Implementation surface (under `phase-discipline/`):

- `profile-map.ts` — exports `PHASE_DISCIPLINE_8STEP_SEQUENCE: Array<{phase: string; unit: UnitType | UnitType[]; gating: "strict" | "soft"}>` — the authoritative 8-phase → auto-mode unit map of §3.1b.
- `profile-dispatch.ts` — pre-dispatch hook body. On each invocation: (1) read current milestone's executed-unit log; (2) find the next unordered phase in the sequence whose gating unit has not yet run; (3) emit `preferredNextUnit` = that phase's unit; (4) if the phase's preceding phase is `strict` gated but has not produced the expected artifact (design doc for P2, task list for P3, verification evidence for P5), emit a diagnostic and set `preferredNextUnit` back to the prior phase. No state is persisted beyond what `runPreDispatchHooks()` already records.

Behaviour specification:

- **Strict gating** — the next unit cannot fire until the prior phase's expected artifact exists. v1 enforces strict gating on P2 → P3 (design doc before split), P3 → P4 (tasks before implementation), P4 → P5 (implementation evidence before verification). Gating blocks by emitting `preferredNextUnit = priorPhaseUnit` with a diagnostic; does not throw.
- **Soft gating** — the scheduler still prefers the sequence's next unit but will not block if the scheduler itself chose something else (e.g. `reassess-roadmap`). v1 uses soft gating for P0, P1, P6, P7. This preserves auto-mode's adaptive recovery.
- **Profile opt-out within a milestone** — a milestone-level `milestone_overrides[mid].milestone_profile = "auto"` disables the skeleton for that milestone only. Verified to work with existing `milestone_overrides` merge logic; no new code.
- **Backoff on scheduler disagreement** — if `auto-dispatch.ts`'s own heuristic picks a different unit for 3 consecutive dispatch calls, `profile-dispatch.ts` emits `logWarning` (profile potentially wrong for this milestone) and yields; this surfaces configuration errors without infinite-looping.

**What `profile-dispatch.ts` is NOT.** Not a scheduler replacement. Not a state machine owned outside `auto-dispatch.ts`. Not allowed to mutate completed-unit records. Not allowed to skip phases in v1 (adaptive skipping is OQ-5).

### 3.1b 8-phase → auto-mode unit map (authoritative)

Every phase maps to an existing `auto-mode` unit type verified against `@/Users/sheng/tencent/gsd-2/src/resources/extensions/gsd/auto-dispatch.ts`. v1 adds no new unit types.

| Phase | Composed-lite concept | auto-mode unit(s) | Gating | v1 attached hook(s) | v2 capability slot |
|---|---|---|---|---|---|
| P0 | Admission | `discuss-milestone` | soft | — | v1.1: admission-checklist hook on `discuss-milestone` |
| P1 | Research | `research-milestone` → `research-slice` | soft | — | v1.2: scout-fan-out `PreDispatchHookConfig` action type |
| P2 | Design | `plan-slice` → `refine-slice` | **strict** | `phase-discipline-design-review` (§3.3) | v1.2 design-doc artifact; v1.3 impl-plan-YAML schema |
| P3 | Split | `plan-slice` task-decomposition pass (reuses `gsd_plan_slice`) | **strict** | — | v1.3: impl-plan-YAML schema validator hook |
| P4 | Implementation | `execute-task` | **strict** | `phase-discipline-code-review` (§3.3) | — |
| P5 | Verification | `validate-milestone` + `enhanced_verification` | **strict** | — (already auto-on) | v1.4: verify-fuse strict mode (fail → block, not carry-forward) |
| P6 | Synthesis | `complete-slice` → `complete-milestone` | soft | `phase-discipline-findings-to-memories` (§3.3) | — |
| P7 | Postmortem | `extract-learnings` → `rewrite-docs` | soft | — (uses existing mechanism) | — |

**Why all 8 phases already have units.** auto-mode is closer to composed-lite in capability than first impression suggests; the missing piece was ordering enforcement, not unit types. v1 provides that ordering; v1.1–v1.4 add the per-phase quality gates that composed-lite's runtime had hardcoded.

**What "strict gating on P2→P3→P4→P5" means in practice.** The scheduler will not dispatch `execute-task` until at least one slice's `refine-slice` has produced a plan with non-empty task list (the existing `gsd_plan_slice` schema already enforces this). It will not dispatch `validate-milestone` until at least one `execute-task` has recorded completion evidence. These are observable in existing `.gsd/{mid}/{sid}/` artifacts; no new artifact files are introduced.

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
├── subagent-spawn.ts         # re-export of composed-lite/subagent-spawn.ts (state-agnostic)
├── subagent-terminal.ts      # re-export of composed-lite/subagent-terminal.ts (state-agnostic)
└── index.ts                  # barrel exports + module-boundary comment
```

**Scope guard** — `shared-harness/*` imports from `./` or `../` but **never from `../composed-lite/`** or `../phase-discipline/`. ESLint `no-restricted-paths` enforces this in PR-2's landing commit (non-negotiable).

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

**Not modified in v1**: `auto-post-unit.ts` (metrics wiring is v1.1; see R-2); `rule-registry.ts` (no new rule shape); `auto-dispatch.ts` (the pre-dispatch hook reads existing state and returns `preferredNextUnit`; no scheduler internals changed).

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

- No input/output token counts — requires structured metrics wiring (R-2 / OQ-7), deferred to v1.1.
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
| `profile-dispatch` disagrees with scheduler 3 consecutive times | Yields to scheduler; `logWarning` per §3.1a |
| `milestone_overrides[mid].milestone_profile = "auto"` under opted-in top-level profile | Profile disabled for that milestone only; no post-unit hooks from preset either |
| `cross_review` = 1 or unset | Byte-identical legacy single-reviewer path |
| `cross_review` > 5 | Silently clamped to 5 (R-8 safeguard) |
| All reviewers same provider (cross_review_models or picker edge case) | Runs anyway; `logWarning` emitted at hook spawn |
| Recursion (hook-on-hook) | Existing `rule-registry.evaluatePostUnit` guard prevents; unchanged |
| Parallel reviewer session state | Each reviewer spawned with `--no-session` (existing composed-lite convention); no cross-talk |

## 9. Migration plan — 3 independent PRs on 3 clean branches (PR-0 branch strategy)

Each PR is independently reviewable and landable. Later PRs depend on earlier ones only for the new code paths to be wired.

### PR-0 — Branch strategy (v7 prerequisite, non-code)

Current `feat/composed-lite-runtime-owned` mixes two semantically orthogonal tracks: (a) composed-lite runtime hardening (anti-drift guards, reviewer-stall investigation, preflight audit) and (b) phase-discipline preset proposal. These must not land together. PR-0 performs the branch reorganisation:

| New branch | Starts from | Contents | Who lands |
|---|---|---|---|
| `feat/cli-tool-restriction-chain` | `origin/main` | PR-1 code per `2026-04-23-cli-tool-restriction-chain.md` | Independent of other PRs; can land first |
| `feat/shared-harness-extraction` | `feat/composed-lite-runtime-owned` | PR-2 extraction from composed-lite/ into shared-harness/ | Composed-lite runtime hardening commits stay behind on `feat/composed-lite-runtime-owned` as Lab state |
| `feat/phase-discipline-preset-v1` | `origin/main` | This spec (v7) + `docs/superpowers/specs/README.md` + PR-3 code after PR-2 lands | The PR-3 code rebase must wait until PR-2 lands on main |
| `feat/composed-lite-runtime-owned` | (unchanged) | Kept as Lab. No phase-discipline work added here. Retired at v1.4 per §12 | Frozen for new feature work; rebase-only maintenance |

**Effect on this document.** v7 itself lands on `feat/phase-discipline-preset-v1` first (as a pure docs change) so implementation can start from a clean slate. No more spec edits go onto `feat/composed-lite-runtime-owned`.

### PR-1 — CLI tool-restriction chain (M0 only)

Split to its own spec: `docs/superpowers/specs/2026-04-23-cli-tool-restriction-chain.md`. Orthogonal to phase-discipline; benefits every `--tools`-restricted subagent regardless of preset opt-in. Not described further here.

### PR-2 — `shared-harness/` extraction

**Scope** (on `feat/shared-harness-extraction`, merges to `main`):

1. `shared-harness/reviewer-core.ts` ← extract from `composed-lite/review-harness.ts` (decouple from `ComposedLiteState`; take plain input struct)
2. `shared-harness/review-model-picker.ts` ← extract from `composed-lite/review-model-picker.ts` (already state-agnostic; just moves)
3. `shared-harness/subagent-spawn.ts` ← re-export of `composed-lite/subagent-spawn.ts` (no code change)
4. `shared-harness/subagent-terminal.ts` ← re-export of `composed-lite/subagent-terminal.ts` (no code change)
5. `shared-harness/index.ts` ← new barrel

**`composed-lite` is rewritten on `feat/composed-lite-runtime-owned` as a consumer** — `review-harness.ts` becomes a thin `runReview(buildInputFromState(...))` adapter. The `composed-lite` runtime's observable behaviour is byte-identical (enforced by §10 regression gate).

**ESLint `no-restricted-paths`** enforces: `shared-harness/*` cannot import `composed-lite/` or `phase-discipline/`. Rule is added in the PR-2 landing commit.

### PR-3 — `phase-discipline/` preset + B-min skeleton + preferences extension

**`main`-side edits (2 files)**:

| File | Change |
|---|---|
| `preferences-types.ts` | Add `milestone_profile?: "auto" \| "phase-discipline-8step"` field; add `provider? / cross_review? / cross_review_models?` to `PostUnitHookConfig`; add `provider?` to `PreDispatchHookConfig` |
| `preferences.ts` | `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` call `phase-discipline/merge.ts` when `milestone_profile === "phase-discipline-8step"` |

**New `phase-discipline/` directory** (6 files + README as in §3.4 — includes `profile-map.ts` and `profile-dispatch.ts` for the B-min skeleton).

**Rollout order** — PR-1 lands standalone (no dependency). PR-2 lands after PR-1 (makes `shared-harness/` available). PR-3 lands after PR-2 (consumes `shared-harness/`). v1.1 through v1.4 each add capability on top of PR-3 without changing the branch layout; see §12.

**PR-3 size estimate** — ~30 lines in `preferences-types.ts` + `preferences.ts`, ~280 lines in `phase-discipline/` directory (6 files + README + tests), ~0 platform changes. 100% additive.

## 10. Testing strategy

| Layer | Coverage | Location |
|---|---|---|
| Unit — `shared-harness` | `reviewer-core.runReview` contract; mock subagent-spawn verifies single-reviewer path; partial-JSON parse robustness | `src/resources/extensions/gsd/shared-harness/tests/*.test.ts` |
| Unit — `phase-discipline` | `reviewer-hook` fan-out (N=2, N=3, N=5 clamp, single-reviewer fallback); merge logic (union dedupe, worst assessment); `findings-carry` artifact→capture_thought mapping; `merge.ts` preset-inject + user-override logWarning + missing-cross_review default (§3.2.1); observability log schema (§6.2) | `src/resources/extensions/gsd/phase-discipline/tests/*.test.ts` |
| Unit — `profile-dispatch` (v7) | Given fixture milestone state, assert `preferredNextUnit` matches expected phase; strict-gating blocks P3 without design doc; soft-gating yields on scheduler disagreement after 3 tries; `milestone_overrides[mid].milestone_profile="auto"` disables skeleton locally | `src/resources/extensions/gsd/phase-discipline/tests/profile-dispatch.test.ts` |
| Integration — preset-in-auto-mode | Temp repo with `prefs.milestone_profile = "phase-discipline-8step"`; run one milestone; assert unit order follows §3.1b sequence; assert preset hooks appear in `rule-registry.listRules()`; confirm `milestone_profile = "auto"` case is byte-identical to pre-v7 | `src/tests/phase-discipline-integration.test.ts` (new) |
| Regression — hook engine | Existing post-unit-hooks / rule-registry / preferences tests remain green | existing paths, unchanged |
| E2E — `composed-lite` Lab (PR-2 gate) | 3 real runs pre- and post-extraction → byte-identical `.gsd/composed-lite/artifacts/*.md` sha256 and audit log seq segments | `tests/live-regression/composed-lite-extraction.ts` (new) |

**Not tested in v1**: real cross-provider API calls (env-limited); `cross_review` real subagent spawn (fully mocked); performance benchmarks (v1.1).

## 11. Upgrade sustainability — tracking `gsd-2` evolution

**Why v7 tracks upstream cleanly:**

- `phase-discipline/` depends only on the stable `post_unit_hooks` / `pre_dispatch_hooks` API surface. If `gsd-2` upstream changes `preferences` architecture, the preset re-merges into whatever new shape the API takes.
- `profile-dispatch.ts` (v7) returns `preferredNextUnit` via the existing pre-dispatch hook contract; it does not reach into `auto-dispatch.ts` internals. If the scheduler's unit-selection algorithm changes upstream, `profile-dispatch.ts` keeps working because its output is a *preference*, not an override.
- `shared-harness/` has 5 files with narrow interfaces. ESLint `no-restricted-paths` prevents bidirectional pollution with `composed-lite/`.
- `main`-side footprint is 2 files × ~15–30 lines; upstream rebases rarely conflict at this scope.
- No schema extensions to `STATE.json` / `SLICE-STATE.json` / `.gsd/preferences.yaml` top-level beyond one enum field (`milestone_profile`).
- No runtime version protocol between `shared-harness/` and its consumers (TypeScript types cover compat; see §0 rejected list).

**Where upgrade friction remains:**

- `composed-lite` Lab on `feat` needs periodic rebase against `main` until v1.4 capability parity. Post-PR-2 the rebase footprint is `composed-lite/runner.ts` + `phases/` + `state.ts` + `audit-log.ts` (~24 files), down from 30 today. See §12 for the retirement plan.
- `shared-harness/reviewer-core.ts` is the one place where `composed-lite` and `phase-discipline` share surface; changes here need backward-compat or coordinated rebase.
- `auto-dispatch.ts` pre-dispatch hook pipeline is the contract surface for `profile-dispatch.ts`. If this pipeline changes shape upstream (e.g. the hook return value gains new fields), `profile-dispatch.ts` must adopt — single-file coupling, narrow risk.

## 12. Capability migration path — v1.1 through v1.4 → composed-lite deletion

v7 replaces v6's time-based Lab retirement conditions (T1/T2/T3) with a **capability-parity roadmap**. The composed-lite runtime is deleted when every composed-lite-unique capability has been reimplemented as an auto-mode unit / hook / preference. Each version below slots a capability onto an already-existing phase in §3.1b:

| Version | Target | Host phase | Implementation shape | Delete from composed-lite |
|---|---|---|---|---|
| **v1** *(this spec)* | B-min 8-step skeleton + cross-review hooks | P2, P4, P6 | `milestone_profile` + 3 post-unit hooks + pre-dispatch hook | — (Lab only maintained) |
| **v1.1** | Admission-checklist hook on `discuss-milestone` | P0 | New post-unit hook `phase-discipline-admission` with 6–8 checklist items; `retry_on` pattern if checklist has unchecked items | composed-lite `phases/p0-admission.ts` |
| **v1.2** | Scout fan-out on `research-slice` | P1 | New `PreDispatchHookConfig` action type `fan-out: { count, models }`; fan-out N parallel scout subagents with merged artifact | composed-lite `phases/p1-research.ts` |
| **v1.3** | Impl-plan YAML schema validator | P2 → P3 boundary | Tighten `gsd_plan_slice` schema to require `rollback_hint`, `acceptance`, `files[]` per task; post-unit hook validates | composed-lite `phases/p3-split.ts` |
| **v1.4** | Verify-fuse strict mode | P5 | Preference `verify_fuse_on_fail?: boolean`; when true, `validate-milestone` failure blocks milestone close instead of carry-forward | composed-lite `phases/p5-verification.ts` + `phases/p6-synthesis.ts` |

**Retirement action at v1.4 capability parity:**

1. `git rm -r src/resources/extensions/gsd/composed-lite/` on `main` (removing the 30 dead-code files).
2. Archive `feat/composed-lite-runtime-owned` as tag `composed-lite-lab-final`.
3. Delete `feat/composed-lite-runtime-owned` branch.
4. Remove the 4 dispatcher special-cases (`commands-workflow-templates.ts`, `commands/handlers/workflow.ts`) identified in v3.5 Appendix E.2.
5. Remove `audit-log.ts` hash-chain machinery from composed-lite or graduate it to `shared-harness/` if another consumer appears by then.

**Why capability parity instead of time-based retirement.**

- Time-based triggers (T3 in v6: "6 months no commits") risk premature deletion before v1.4 lands.
- Usage-based triggers (T1 in v6: "v1+v1.1 covers 80%") are hard to measure without telemetry and presume phase-discipline is strictly a superset of composed-lite, which is only true after v1.4.
- Capability parity is a binary check per capability ("does admission work under auto-mode? yes/no"), each independently verifiable in CI.

**Fallback if a capability proves hard to port.** If any of v1.1–v1.4 hits an irreducible auto-mode limitation (e.g. the scheduler genuinely cannot express "strict verify-fuse"), the spec owner has two options: (a) defer the capability to v1.5+, keeping composed-lite Lab alive; (b) declare that capability permanently composed-lite-only and move composed-lite runtime into `main` as a long-term secondary entry. Option (b) would require a new v8 of this spec to un-retire Lab and should not be pursued without evidence; option (a) is the default.

**v1 does not trigger retirement.** v1 only ensures Lab maintenance cost stays bounded and proves the B-min skeleton works before the v1.1–v1.4 capability ports begin.

## 13. Risks (v7)

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | Preset merge cached at construction time defeats "edit `.gsd/preferences.yaml` → next unit sees it" guarantee | `merge.ts` is stateless; `resolvePostUnitHooks()` calls it fresh on every invocation (matches existing semantics at `rule-registry.ts:86-108`) |
| **R-2** *(v7 update)* | Reviewer cost invisible to budget diagnostics | **v1 interim:** §6.2 observability log persists per-reviewer `wall_clock_seconds` + `findings_counts` + `output_chars`, giving per-hook execution visibility even without token counts. **v1.1 full:** adds `unitType: "hook-review"` rows to `UnitMetrics` (~10 lines in `auto-post-unit.ts`); existing `getAverageCostPerUnitType` picks them up automatically. Downgraded from high to medium severity once v1 log lands |
| **R-3** *(v7 update)* | User `post_unit_hooks` with same `name` as preset shadow new preset fields on upgrade | §3.2.1 locks merge semantics (full replacement, no field-level merging, `cross_review` defaults to 1 when omitted by shadowing hook); `merge.ts` emits two logWarnings; `phase-discipline/README.md` documents with examples |
| **R-4** | `shared-harness/` import boundary erosion | ESLint `no-restricted-paths` added in PR-2 landing commit; CI runs on every PR |
| **R-5** | Memory-store pollution from findings carry-forward | `phase-discipline-findings-to-memories` caps at 5 `gotcha` entries per slice; deduped by summary |
| **R-8** | `cross_review` × `max_cycles` × slice count multiplicatively amplifies cost | `cross_review` clamps to ≤ 5; default `max_cycles=2` not 3; v1.1 may add `cross_review_sample` |
| **R-9** *(v7 update)* | Feat Lab long-term fork maintenance | §12 capability migration path (v1.1→v1.4) replaces v6's time-based retirement; PR-2 reduces rebase footprint to 24 of 30 files with zero conflict on the extracted 6 |
| **R-10** | Users configure `cross_review_models` with all same provider | Not rejected; `reviewer-hook` emits `logWarning` listing reviewer providers so operator notices |
| **R-11** *(new v7)* | B-min skeleton's `profile-dispatch` pre-dispatch hook breaks when upstream `auto-dispatch.ts` changes hook contract | `profile-dispatch.ts` is 1 file with 1 contract surface (the pre-dispatch hook return shape). Breakage is a single-file rebase; unit test coverage in §10 catches it before landing. If upstream changes frequency becomes a real pain, promote `profile-map.ts` to a data file consumed by auto-dispatch natively (v1.5 candidate, not committed) |
| **R-12** *(new v7)* | v1 observability log (§6.2) writes many small JSON files, inflating `.gsd/` directory size | Per-invocation file is ≤ 4KB typical; `.gsd/{mid}/{sid}/.phase-discipline/` dir for a busy milestone with 50 tasks × 2 hooks × 2 cycles = 200 files, ~800KB. Acceptable. Rotation / compression deferred to v1.1 if real measurement shows worse |

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
- **OQ-4** — `reviewer_model_fallbacks: string[]`. If reviewer outages are common, extend `model` to support fallback chain mirroring existing `GSDPhaseModelConfig`. Evidence: `.phase-discipline/*.json` logs showing repeated `auth_failure` or `timeout` across runs.
- **OQ-5** *(v7)* — Adaptive phase skipping under `phase-discipline-8step`. e.g. a docs-only milestone skipping P5 verification. v1 forces all 8 phases; docs-only tasks currently produce trivially-passing `validate-milestone`. Evidence: user complaints about redundant phase traversal.
- **OQ-6** — Cross-milestone explicit `pending-findings.yaml`. If memories-based carry (ADR-013) dilutes high-fidelity findings, re-introduce explicit file + admission prompt. v1.1 decision, gated on user evidence.
- **OQ-7** — Hook-level cost metrics wiring (R-2 full fix). 10-line change in `auto-post-unit.ts`; v1.1.
- **OQ-8** *(v7)* — CI lint for `mergePresetIntoHooks` dry-run on `.gsd/preferences.yaml`. Emits PR-time warning when user hooks shadow preset hooks whose field set has changed. Low cost to implement; defer to v1.1 only because there is no field-change to detect yet.
- **OQ-9** *(v7)* — Reviewer verdict override mechanism. Shape TBD (file-based, prompt-based, or new `gsd_memory_graph` category). Evidence needed: at least one real case where a `critical` finding was a false positive and the user had to work around the preset. Placeholder only; not a v1.1 commitment.
- **OQ-10** *(v7)* — Full stdout/stderr capture for preset reviewers (§6.2 "Deliberate omissions"). Matches composed-lite's `.gsd/composed-lite/logs/raw/*.jsonl` scheme. Deferred because `subagent-spawn` already supports it; turning it on is ~5 lines once someone needs the evidence.
- **OQ-11** *(v7)* — Phase-discipline preset docs-map L1 inheritance. Currently reviewers do not call `loadAgentsSection(hint)` (§4.5). If a hook prompt frequently needs the same L1 file, explore hook-prompt-level routing. Evidence needed: repeated `read_file(".gsd/docs-map/...")` pattern in hook outputs.

## 16. Change log

| Version | Date | Summary |
|---|---|---|
| **v7** | 2026-04-23 | B-min skeleton addition following receiving-code-review evaluation of v6. Core additions: (1) `milestone_profile: "auto" \| "phase-discipline-8step"` preference (§3.1) replaces v6's `phase_discipline?` boolean; (2) `profile-map.ts` + `profile-dispatch.ts` B-min skeleton (§3.1a, §3.1b) enforces 8-phase ordering via pre-dispatch hook; (3) §3.2.1 hook-conflict resolution rules (name shadowing + missing `cross_review` defaults to 1); (4) §4.5 docs-map ↔ preset context-flow contract locks reviewer subagent context inheritance; (5) §6.2 observability v1 — `.gsd/{mid}/{sid}/.phase-discipline/*.json` per-hook structured log; (6) §9 PR-0 branch strategy moves phase-discipline work off `feat/composed-lite-runtime-owned` onto `feat/phase-discipline-preset-v1` cut from main; (7) §12 replaces v6's time-based T1/T2/T3 retirement with v1.1–v1.4 capability migration roadmap (admission, scout fan-out, impl-plan-YAML, verify-fuse). R-2 severity reduced with v1 interim visibility; R-3 tightened via §3.2.1; added R-11 (profile-dispatch upstream contract risk) and R-12 (observability log dir size). New OQs: OQ-5 adaptive skip, OQ-8 merge-lint CI, OQ-9 verdict override (rejected), OQ-10 reviewer stdout/stderr capture, OQ-11 reviewer docs-map inheritance. Rejected: `SHARED_HARNESS_API_VERSION` runtime version protocol. Decisions locked: **A + a' + Ω1 + Φa + L1+L2 + Π₈**. |
| **v6** | 2026-04-23 | Ground-up rewrite following L1+L2 / Approach A brainstorm. Split AGENTS.md docs-map → own spec; split CLI tool-restriction chain → own spec. Dropped `reviewer_model?` (reuse `model?`). Dropped `impl-plan-schema-validate` + `cmd-verify` + `findings-store` + `verification-executor` as duplicates of `enhanced_verification`. `shared-harness` is 5 files (not 6); `phase-discipline` is 4 files (not 5, v7 re-expands to 6). Added §12 Feat Lab retirement conditions (later replaced by v7's capability roadmap). Added R-8/R-9/R-10. Preset renamed `"composed-lite-slice"` → `"phase-discipline-v1"` (later renamed to `"phase-discipline-8step"` in v7). Net spec drops ~70 lines while covering more decisions with cleaner boundaries. Decisions locked (v6): **A + a + Ω1 + Φa + L1+L2**. |
| **v5** | 2026-04-23 | Overlay retirement; preset-on-hook-engine selected; `composed-lite` runtime stays on `feat`; 6-file shared-harness extraction; 3-PR plan. Superseded by v6 (one-line summary retained; full prose removed). |
| **v4.x** | 2026-04-23 | Overlay contract (PD1–PD9) + sidecar state + Alt I. Retired in v5. Full prose in `git log`. |
| **v3.x** | 2026-04-22/23 | Baseline recalibration; Layer 1/2 runtime-control contract. Retired in v5. Full prose in `git log`. |
| **v1–v2** | 2026-04-22 | composed-lite-as-harness proposal → auto-mode-as-host reversal. Full prose in `git log`. |
