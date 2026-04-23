# Auto-Mode Harness Specifications

This directory contains three independent specifications that together define the next iteration of `gsd-2`'s auto-mode harness. They were split out of a single brainstorm document (`composed-lite-harness-brainstorm.md`, later renamed `phase-discipline-preset.md`) during the v6 rewrite on 2026-04-23, extended in v7 (same date) with a B-min skeleton, and factually corrected in v7.1 (same date) after a receiving-code-review pass identified 8 errors.

## Scope

| Spec | Subject | Status |
|---|---|---|
| [`phase-discipline-preset.md`](./phase-discipline-preset.md) | Multi-model cross-review preset + 8-phase milestone ordering skeleton on top of `auto-mode` | **v7.1 — design draft with required kernel deltas.** Landing v1 requires Δ-K1 (PR-3a: `PreDispatchResult.action: "advise"` + `advisedUnitType` / `advisedUnitId`) before the extension (PR-3b) compiles. v7's claim that the existing pre-dispatch contract suffices was incorrect; see §16's v7.1 changelog entry for the 8 factual corrections |
| [`2026-04-23-agents-md-docs-map-v1.md`](./2026-04-23-agents-md-docs-map-v1.md) | Extension-side `AGENTS.md` routing-table convention with section-aware loading; platform loader unchanged | **v1 — accepted** |
| [`2026-04-23-cli-tool-restriction-chain.md`](./2026-04-23-cli-tool-restriction-chain.md) | Thread `--tools` restriction end-to-end through the CLI print/JSON subagent path so the built-in `Skill` tool can actually be excluded | **v1 — accepted** |

## Dependency graph

```
phase-discipline-preset (v7.1)
├─ Depends on (existing, stable):
│    • preferences-types.ts (PostUnitHookConfig, PreDispatchHookConfig)
│    • rule-registry.ts (listRules, runPreDispatchHooks)
├─ Requires kernel delta Δ-K1 (PR-3a):
│    • types.ts: add "advise" action + advisedUnitType/advisedUnitId to PreDispatchResult
│    • auto-dispatch.ts: +20 lines to honour "advise" advisory
│    • rule-registry.ts: propagate "advise" action unchanged
├─ Consumes (via PR-2 extraction):
│    • shared-harness/reviewer-core
│    • shared-harness/review-model-picker
│    • shared-harness/subagent-spawn
└─ Interacts with (orthogonal specs):
    • AGENTS.md docs-map v1 (context injection order — see phase-discipline §4.5)
    • CLI tool-restriction chain (ensures reviewer subagents cannot invoke Skill)
    • Existing adaptive preferences (reactive_execution / gate_evaluation / slice_parallel /
      parallel / phases.skip_* / progressive_planning / mid_execution_escalation /
      require_slice_discussion / enhanced_verification) — see phase-discipline §4.1 matrix

AGENTS.md docs-map v1
├─ Depends on: auto-prompts.ts (buildResearch/Plan/ExecutePrompt)
├─ Platform: resource-loader.ts untouched (D1 extension-only)
└─ Orthogonal to: phase-discipline-preset (can land independently)

CLI tool-restriction chain (M0)
├─ Depends on: packages/pi-coding-agent (sdk.ts, agent-session.ts) + src/cli*.ts
└─ Benefits: every --tools-restricted subagent (phase-discipline reviewers, composed-lite scouts, etc.)
```

## Recommended migration order

Migration is delivered as 4 PRs on 4 clean branches (v7.1 split PR-3 into PR-3a + PR-3b after the review identified that Δ-K1 kernel delta is a separable, reviewable unit). See "PR-0 branch strategy" in `phase-discipline-preset.md` §9.

| Order | PR | Branch | Gating | Scope |
|---|---|---|---|---|
| 1a | **PR-1** CLI tool-restriction chain | `feat/cli-tool-restriction-chain` from `main` | None — standalone | ~120 lines across 4 files (see CLI spec §2.2) |
| 1b | **PR-2** shared-harness extraction | `feat/shared-harness-extraction` from `feat/composed-lite-runtime-owned` | None — standalone (parallel to PR-1 / PR-3a / PR-4) | Extract 5 files into `src/resources/extensions/gsd/shared-harness/`; rewrite `composed-lite` as consumer |
| 1c | **PR-3a** Δ-K1 kernel delta *(corrected 2026-04-23 — no PR-2 dependency)* | `feat/phase-discipline-preset-v1` from `main` | None — standalone (parallel to PR-1 / PR-2 / PR-4) | ~125 lines across 4 files: `types.ts` + `rule-registry.ts` + `auto-dispatch.ts` + new test. Adds `PreDispatchResult.action: "advise"` scheduler advisory + `honour-phase-discipline-advice` prefix DispatchRule. Independently reviewable; no `phase-discipline/` consumer on main before PR-3b lands |
| 1d | **PR-4** AGENTS.md docs-map v1 | `feat/agents-md-docs-map-v1` from `main` | None — orthogonal to PR-1/2/3a/3b | See docs-map spec §6 / §8 |
| 2 | **PR-3b** phase-discipline preset + B-min skeleton | `feat/phase-discipline-preset-v1` (continues) | After PR-1 **AND** PR-2 **AND** PR-3a | ~30 main-side lines + ~280 extension-side lines across 6 files + README. Imports `"advise"` from PR-3a; imports `shared-harness/*` from PR-2; depends on PR-1 for reviewer `--tools read` enforcement |

The current `feat/composed-lite-runtime-owned` branch is **not** a landing target for any of the above; it is kept as a Lab for composed-lite runtime hardening only. `phase-discipline-preset.md` §12 defines the v1.1–v1.4 capability-migration roadmap that retires this Lab at v1.4 — note that `main` has never carried the composed-lite runtime (0 files, verified 2026-04-23), so retirement is a branch-delete, not a `git rm`.

### Implementation sequencing hard constraints *(added 2026-04-23 after a second receiving-code-review pass)*

This section is **prescriptive, not advisory.** A second reviewer pass re-verified the v7.1 spec against current `src/` source (not `dist-test/` / `dist/`) and confirmed:

- `PreDispatchResult.action` on `main` is `"proceed" | "skip" | "replace"` — no `"advise"` (`src/resources/extensions/gsd/types.ts:438`)
- `rule-registry` has no advisory path (`src/resources/extensions/gsd/rule-registry.ts:304-341`)
- `GSDPreferences` has no `milestone_profile` field (grep `src/resources/extensions/gsd/preferences-types.ts` returns 0)
- `resolvePostUnitHooks()` / `resolvePreDispatchHooks()` directly return user-configured hooks with no preset merge (`src/resources/extensions/gsd/preferences.ts:580-593`)
- `src/` has no `loadAgentsSection` / `deriveTaskTypeHint` / `agents-md-loader` / `docs-map` implementation (grep returns 0)
- `src/cli-web-branch.ts:89-90` currently has only `flags.tools = args[++i].split(',')` — no `resolveCreateAgentSessionToolOptions` helper; the helper lives on `feat/composed-lite-runtime-owned` and is explicitly forward-ported by PR-1

Therefore the following **No-Go list** applies to all implementers:

| Action | Gate | Rationale |
|---|---|---|
| Start PR-3b (phase-discipline extension code) | **No-Go** until PR-3a merged to `main` | PR-3b imports the `"advise"` action shape from `PreDispatchResult`; without Δ-K1 it does not type-check |
| Add `milestone_profile` to `GSDPreferences` outside PR-3b | **No-Go** | Preset-merge logic lives in PR-3b's `resolveMilestoneProfile()`; adding the field without the resolver creates dead preferences surface |
| Use `composed-lite-harness-brainstorm.md` as implementation source | **No-Go** | That document is a superseded brainstorm; factually inaccurate claims from v3.5 (e.g. `main...HEAD` footprint under `packages/pi-coding-agent`) remain there for git-history reasons only. Authoritative specs are the 3 files in this directory |
| Skip PR-1 on the path to PR-3b | **No-Go** | Phase-discipline reviewers require `--tools read` to actually exclude Skill; without PR-1's `resolveCreateAgentSessionToolOptions` chain, the CLI flag is cosmetic |

And the Go list (all verified as safe to start immediately on separate branches):

| Action | Gate | Notes |
|---|---|---|
| Start PR-1 (CLI tool-restriction forward port) | **Go** — parallel | Forward-ports the existing `feat/composed-lite-runtime-owned` implementation for 4 files; see CLI spec §2.2 |
| Start PR-2 (shared-harness extraction) | **Go** — parallel *(corrected 2026-04-23 — no PR-1 dependency)* | Pure refactor; no semantic change; runs on `feat/composed-lite-runtime-owned`-derived branch; no kernel or CLI touch |
| Start PR-3a (Δ-K1 kernel delta) | **Go** — parallel *(corrected 2026-04-23 — no PR-2 dependency)* | Standalone kernel change on `main`; see `phase-discipline-preset.md` §3.1a including the new "Integration with `DISPATCH_RULES`" subsection for the honour-advice prefix-rule design |
| Start PR-4 (AGENTS.md docs-map v1) | **Go** — parallel | Orthogonal to PR-1/2/3a/3b |
| Start PR-3b (phase-discipline preset) | **No-Go until PR-1 AND PR-2 AND PR-3a all merged to `main`** | Only PR with a genuine three-way dependency; see `phase-discipline-preset.md` §9.0 readiness gate |

## Key interaction points

### Why the kernel delta (Δ-K1) exists

The 8-step scheduler skeleton (`profile-dispatch.ts`) needs to tell auto-mode "you picked unit X, but the phase-discipline sequence expects unit Y at this point". The current `PreDispatchResult` only supports `modify` (change the current unit's prompt), `skip` (skip the current unit), or `replace` (swap the unit type). None of these express "advise a different unit". PR-3a adds `action: "advise"` with `advisedUnitType` / `advisedUnitId`, and a single branch in `auto-dispatch.ts`'s main loop honours it when the advised unit is runnable (otherwise fall back to the original pick with a logWarning).

See `phase-discipline-preset.md` §3.1a for the Δ-K1 vs Δ-K2 alternative analysis. Δ-K1 is additive — legacy hook authors see zero behaviour change — so the blast radius is narrow.

### Context-flow at `execute-task`

1. Platform `loadProjectContextFiles` runs full-file ancestor walk for `AGENTS.md` → **system prompt** (unchanged).
2. AGENTS.md docs-map: `loadAgentsSection(hint)` → **task prompt** optional L0 (extension-only; gated by `<!-- docs-map: v1 -->` marker).
3. auto-prompts: `inlineGraphSubgraph` + `queryKnowledge` + `loadMemoryBlock` → **task prompt** supplements.
4. Task unit executes.
5. Post-unit hook dispatched; phase-discipline preset reviewer subagents spawn with `--no-session --tools read` (PR-1 + review-harness convention).

Reviewer subagents inherit the full `AGENTS.md` via the platform loader (step 1 rerun at subprocess start) but **not** the optional L0 from step 2 — see `phase-discipline-preset.md` §4.5 for authoritative contract.

### CLI restriction enforcement

`--tools read` on a reviewer subagent reliably excludes `Skill` and all extension tools once PR-1 lands. This is the anti-drift lever that fixed the `cl-20260422-*` reviewer-stall investigation; documented in the CLI spec §1.

### Cost visibility

Per-hook reviewer cost is visible in two places:

- **v1 (shipped with PR-3):** `.gsd/{mid}/{sid}/.phase-discipline/{hookName}-{tid}.json` records wall-clock, provider, model, findings counts, output chars per reviewer. See `phase-discipline-preset.md` §6.2.
- **v1.1 (deferred):** `UnitMetrics` gains a `unitType: "hook-review"` row; OQ-7 / R-2.

### Capability migration (composed-lite → auto-mode)

`phase-discipline-preset.md` §12 defines the v1.1–v1.4 roadmap. Each version lifts one composed-lite-unique capability (admission, scout fan-out, impl-plan-YAML, verify-fuse) onto an existing auto-mode phase using the B-min skeleton from v1. composed-lite runtime is deleted at capability parity, not on a time schedule.

## File headers and cross-references

Every spec in this directory carries:

- A title with its version in the top-level heading (e.g. `# Auto-Mode Phase Discipline Preset (v7)`).
- A `> **Origin**` block recording git-history provenance.
- A `## 0. Summary & scope` section with "what we are building" / "what v1 does NOT cover" / "rejected entirely" bullets.
- A `## N. Change log` section at the end with one row per version.

If a spec adds a section that references another spec, it must use the absolute file path `docs/superpowers/specs/<name>.md` (not a relative link) to stay resilient against directory moves.

## Not in this directory

- Design docs for specific reviewer stall / preflight investigations: see `docs/superpowers/specs/2026-04-21-*.md` and `2026-04-22-*.md` (historical validation runs).
- ADRs: see `docs/dev/ADR-*.md` (architecture decisions governing the whole `gsd-2` codebase, not just the harness).
- User-facing documentation: see `docs/user-docs/` and `gitbook/`.
