# AGENTS.md Docs-Map v1 (Candidate B)

> **Origin** — extracted from `docs/superpowers/specs/phase-discipline-preset.md` (formerly `composed-lite-harness-brainstorm.md`) v5 §7 / §8.3 during the v6 rewrite on 2026-04-23. The two initiatives are orthogonal; AGENTS.md docs-map does not depend on phase-discipline preset and is not affected by `composed-lite` runtime decisions.

## 0. Summary & scope

**What we are shipping (v1):** a progressive-loading marker convention for `AGENTS.md` that lets extensions consume a compact L0 section + on-demand L1 content based on a `taskTypeHint`, **without modifying the platform `resource-loader`**.

**Out of scope for v1:**

- Platform loader changes (loader stays untouched; see C13)
- `CLAUDE.md` semantics changes (byte-identical via C11)
- Cross-repo ancestor chain truncation (candidate A — v2 territory)
- Agent-authored `taskTypeHint` (closed by C10 in v1; adds a mismatch channel we do not want)

**Relation to other specs:** orthogonal. Does not share code or artifacts with `phase-discipline-preset.md`. Can be landed before, after, or in parallel with phase-discipline preset PRs.

## 1. Original request

`AGENTS.md` in large repos is expensive to slurp fully at every prompt. We want a convention that:

- Keeps full-slurp as the default (zero migration cost for existing files)
- Lets opt-in files declare a compact L0 section that auto-mode can always read
- Lets auto-mode route to L1 sub-files based on detected task type, as additional (not replacing) context

## 2. Candidate B (selected)

Contrast with alternatives:

| Candidate | Shape | Status |
|---|---|---|
| A | Loader truncation with cross-repo size cap | Deferred to v2 (requires platform loader change) |
| **B** | Extension-side L0/L1 marker convention; loader unchanged | **Selected** (this spec) |
| C | Skip `AGENTS.md` entirely in favour of `CLAUDE.md`-only | Rejected — breaks teams standardised on AGENTS.md |
| D | composed-lite-as-harness inherits AGENTS.md routing | Rejected in v3.x (pre-v5) |
| E–H | Various capability-driven / override / loader-branch variants | Deferred to v2 |

## 3. Contract matrix (C1 – C15)

| # | Rule |
|---|---|
| **C1** | `AGENTS.md` v1 marker is `<!-- docs-map: v1 -->` at top-of-file. Absence means the file is treated exactly as pre-v1 (full-slurp) — zero migration cost |
| **C2** | L0 mandatory sections: `## Identity`, `## Constraints`, `## Routing Rules`, `## Invariants` |
| **C3** | Per-file char cap: `AGENTS.md` whole-file ≤ 4000 chars; per L0 optional section ≤ 1000 chars |
| **C4** | Cross-chain (ancestor-walk) whole-file cap: sum across ancestor chain ≤ 10000 chars; CI-enforced |
| **C5** | `Routing Rules` syntax: `- **when phrase** → [relative L1 path]`; one optional surrounding bracket pair inside the bold phrase (for example `**[testing]**`) is tolerated and normalized during matching |
| **C6** | L0 optional sections keyed by `<!-- task-type: <hint> -->` block markers; matched against `taskTypeHint` |
| **C7** | L1 files conventionally live under `.gsd/docs-map/`, but v1 resolves them relative to the owning `AGENTS.md` file so tracked fixtures or policy-constrained repos may use another relative directory (e.g. `.docs-map/`) |
| **C8** | When a Routing Rule matches and L1 is loaded, it enters the task prompt as **additional** content, not as replacement for the L0 full-file slurp |
| **C9** | `taskTypeHint` derivation is a deterministic pure function: input = task title + file paths + file extensions; output = single hint string or `null` |
| **C10** | No agent-authored `taskTypeHint` input in v1 (closes the risk of agent-vs-extension mismatch) |
| **C11** | Existing `resource-loader.ts:57-71` per-directory first-match rule is preserved byte-identically: `AGENTS.md` is checked before `CLAUDE.md` |
| **C12** | L1 files named `AGENTS.md` or `CLAUDE.md` are forbidden (prevents ancestor-slurp defeating layer separation) |
| **C13** | Platform `resource-loader.ts` is **not** modified in v1 — all work is extension-side |
| **C14** | `--bare` CLI flag bypasses docs-map resolution (for tooling that wants raw ancestor-slurp) |
| **C15** | Lint + CI enforce C3 + C4 caps (not the loader — docs-map is extension-side) |

## 4. Decision rows (D1 – D6)

| # | Decision | Rationale |
|---|---|---|
| **D1** | Loader unchanged; section-aware loading is an extension-side helper `loadAgentsSection(hint)` | Keeps platform API surface stable; zero cross-extension impact |
| **D2** | `deriveTaskTypeHint` is extension-private in v1 | No public API contract until v2; allows iteration |
| **D3** | v1 schema = C1–C15 as stated | Explicit char caps + forbidden file names + deterministic hint derivation |
| **D4** | First L1 population: 1 file (`testing.md`) to validate routing end-to-end | Minimises initial populate cost; validates the full chain |
| **D5** | Routing-Rule promotion is batch-only inside `extract-learnings` | Avoids per-unit prompt churn on the L0 file |
| **D6** | `AGENTS.md` full-slurp remains the default for non-marker files | Zero migration cost; no risk of silent context loss |

## 5. Attachment points inside `auto-mode`

L0 attachment (always, when marker present):

- `plan-milestone` — L0 mandatory sections only (no hint derivation at this scope)
- `plan-slice` / `refine-slice` — L0 + hint from slice title / sketch area
- `execute-task` — L0 + hint from task title + `task.files`
- `complete-slice` / `complete-milestone` / `extract-learnings` — L0 only, plus batch Routing-Rule promotion (D5)

L1 attachment:

- Only when a Routing Rule matches the derived hint
- Only at `plan-slice` / `refine-slice` / `execute-task` scopes
- Always additive (C8)

## 6. Implementation scope

**Extension-side only, no platform changes.** New file locations:

- `src/resources/extensions/gsd/agents-md-loader.ts` — export `loadAgentsSection(hint)` + `deriveTaskTypeHint(input)` + routing-rule parser
- `src/resources/extensions/gsd/agents-md-lint.ts` — enforce C3 + C4 caps (called from CI lint target)
- Hook points inside `auto-prompts.ts` (or equivalent prompt-building module for each unit type)

## 7. Testing strategy

| Layer | Coverage |
|---|---|
| Unit — loader | marker detection; L0 mandatory-section parsing; optional-section hint matching; L1 path resolution; C3 / C4 cap violations |
| Unit — hint derivation | task title → hint mapping; file-path + extension matching; null return when no match |
| Integration — unit-prompt attachment | each attachment point (plan-milestone, plan-slice, refine-slice, execute-task, complete-*, extract-learnings) gets correct L0/L1 content |
| Lint — CI | C3 / C4 enforcement in `agents-md-lint.ts` |
| Regression — full-slurp | files without the `<!-- docs-map: v1 -->` marker behave byte-identically to pre-v1 |

## 8. Migration plan — 1 PR

Single PR because the change is fully additive and gated by marker presence:

1. Add `agents-md-loader.ts` + `agents-md-lint.ts`
2. Wire attachment into prompt-building paths (one call per attachment point)
3. Add one example L1 file (`testing.md`) to the repo's own `.gsd/docs-map/`
4. Convert the repo's own `AGENTS.md` to v1 with marker
5. Add lint rule to CI

Rollout is safe because:

- Files without marker → full-slurp (unchanged)
- Files with marker and no L1 → compact L0 only
- Files with marker and matching L1 → L0 + L1

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | Ancestor chain exceeds C4 cap silently | Lint rule runs in CI; violation blocks merge |
| **R-2** | Routing Rule parsing tolerates malformed syntax → silent mis-route | Strict syntax (C5); parser logs warning and falls back to L0-only on any parse error |
| **R-3** | `taskTypeHint` derivation non-determinism across machines | Pure function with explicit inputs (C9); property-based test enforces determinism |
| **R-4** | `CLAUDE.md` precedence regression on loader changes | C13 hard rule + integration test locks byte-identical loader behaviour |
| **R-5** | Adding v1 marker to a file with pre-existing `CLAUDE.md` silently shadows `CLAUDE.md` (first-match rule) | Tooling warning when marker is added; docs require merging `CLAUDE.md` content into the AGENTS.md L0 before adding the marker |
| **R-6** | 3-level ancestor chain each at C3=4000 chars delivers 12000 chars; exceeds C4=10000 | C4 cap + CI enforcement. Cross-repo ancestor chains remain a v2 concern (candidate A) |
| **R-7** | L1 file drift — users modify `.gsd/docs-map/testing.md` without updating Routing Rule | D5 batch promotion inside `extract-learnings` reconciles; manual edit warning in lint |

## 10. Open questions (v2 candidates)

- Cross-repo ancestor chain truncation (candidate A loader branch)
- Agent-authored `taskTypeHint` as a supplementary signal
- Dynamic L1 generation from memories
- Capability-driven routing rules (multi-hint match)
- Loader-branch fast-path for monorepo ancestor caching

## 11. Change log

| Version | Date | Summary |
|---|---|---|
| **v1** | 2026-04-23 | Extracted from v5 composed-lite-harness-brainstorm §7 / §8.3 + R-6 / R-7 during v6 rewrite. Full contract matrix C1–C15 + decisions D1–D6 preserved verbatim; added §6 implementation scope, §7 testing, §8 single-PR migration, §9 risks (R-1 ~ R-7 consolidated), §10 v2 candidates |
