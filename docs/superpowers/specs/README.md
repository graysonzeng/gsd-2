# Auto-Mode Harness Specifications

This directory contains three independent specifications that together define the next iteration of `gsd-2`'s auto-mode harness. They were split out of a single brainstorm document (`composed-lite-harness-brainstorm.md`, later renamed `phase-discipline-preset.md`) during the v6 rewrite on 2026-04-23, and extended in v7 (same date) with a B-min skeleton.

## Scope

| Spec | Subject | Status |
|---|---|---|
| [`phase-discipline-preset.md`](./phase-discipline-preset.md) | Multi-model cross-review preset + 8-phase milestone ordering skeleton on top of `auto-mode` | **v7 — accepted for implementation** (pending approval of this README) |
| [`2026-04-23-agents-md-docs-map-v1.md`](./2026-04-23-agents-md-docs-map-v1.md) | Extension-side `AGENTS.md` routing-table convention with section-aware loading; platform loader unchanged | **v1 — accepted** |
| [`2026-04-23-cli-tool-restriction-chain.md`](./2026-04-23-cli-tool-restriction-chain.md) | Thread `--tools` restriction end-to-end through the CLI print/JSON subagent path so the built-in `Skill` tool can actually be excluded | **v1 — accepted** |

## Dependency graph

```
phase-discipline-preset (v7)
├─ Depends on:
│    • preferences-types.ts (PostUnitHookConfig, PreDispatchHookConfig)
│    • rule-registry.ts (listRules)
│    • auto-dispatch.ts pre-dispatch hook pipeline
├─ Consumes (via PR-2 extraction):
│    • shared-harness/reviewer-core
│    • shared-harness/review-model-picker
│    • shared-harness/subagent-spawn
└─ Interacts with (orthogonal specs):
    • AGENTS.md docs-map v1 (context injection order — see phase-discipline §4.5)
    • CLI tool-restriction chain (ensures reviewer subagents cannot invoke Skill)

AGENTS.md docs-map v1
├─ Depends on: auto-prompts.ts (buildResearch/Plan/ExecutePrompt)
├─ Platform: resource-loader.ts untouched (D1 extension-only)
└─ Orthogonal to: phase-discipline-preset (can land independently)

CLI tool-restriction chain (M0)
├─ Depends on: packages/pi-coding-agent (sdk.ts, agent-session.ts) + src/cli*.ts
└─ Benefits: every --tools-restricted subagent (phase-discipline reviewers, composed-lite scouts, etc.)
```

## Recommended migration order

Migration is delivered as 3 PRs on 3 clean branches cut from `origin/main` (or from `feat/composed-lite-runtime-owned` for PR-2 which extracts existing code). This is "PR-0 branch strategy" in `phase-discipline-preset.md` §9.

| Order | PR | Branch | Gating | Scope |
|---|---|---|---|---|
| 1 | **PR-1** CLI tool-restriction chain | `feat/cli-tool-restriction-chain` from `main` | None — standalone | ~120 lines across 4 files (see CLI spec §2.2) |
| 2 | **PR-2** shared-harness extraction | `feat/shared-harness-extraction` from `feat/composed-lite-runtime-owned` | After PR-1 | Extract 5 files into `src/resources/extensions/gsd/shared-harness/`; rewrite `composed-lite` as consumer |
| 3 | **PR-3** phase-discipline preset + B-min skeleton | `feat/phase-discipline-preset-v1` from `main` (rebase onto PR-2 after it lands) | After PR-2 | ~30 main-side lines + ~280 extension-side lines across 6 files + README |
| parallel | **PR-4** AGENTS.md docs-map v1 | `feat/agents-md-docs-map-v1` from `main` | None — orthogonal to PR-1/2/3 | See docs-map spec §6 / §8 |

The current `feat/composed-lite-runtime-owned` branch is **not** a landing target for any of the above; it is kept as a Lab for composed-lite runtime hardening only. `phase-discipline-preset.md` §12 defines the v1.1–v1.4 capability-migration roadmap that retires this Lab.

## Key interaction points

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
