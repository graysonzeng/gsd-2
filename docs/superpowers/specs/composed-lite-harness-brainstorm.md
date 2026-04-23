# Auto-mode Harness — `AGENTS.md` Progressive Docs-map Proposal

**Status:** Discussion Draft (v3.5 — candidate-C selection + platform-zero-change consolidation, 2026-04-23)
**Scope:** Design only; no implementation in this document
**Primary Context:** `gsd-2` (host) + `auto-mode` (harness host) + `composed-lite` (migration prerequisite, Appendix E; optional follow-up, Appendix A)
**History:** Originally framed around `composed-lite`. v2 reversed the host to `auto-mode` (see §4.8). v3 extracted the v1 contract matrix (§8.3.0). v3.1 tightened platform-footprint / char-token / worker-inheritance claims. v3.2 locked D1–D6. v3.3 synced §9 / §13 / Appendix E with D2/D6. v3.4 responded to a code-anchored external review by downgrading the `agentsFilesOverride` claim and surfacing §8.3.4.e. **v3.5** (this revision) selects candidate **C (extension-only, platform-zero-change)** from §6.5 as the v1 implementation path, restating D2 as **D2'** with extension-private rendering. Candidates A (loader-branch) and B (override route) move to "Deferred to v2." This change is motivated by (i) user intent to minimise impact on open-source iteration of `gsd-2`, and (ii) a new evidence finding (Appendix E.1) that the current `feat/composed-lite-runtime-owned` branch does not modify `packages/pi-coding-agent` at all — v1 can preserve that property end-to-end. C3 / C4 move from "loader-enforced" to "lint/CI + marker opt-in enforced" under new **C15**; **C14** adds the explicit `--bare` contract. §8.3.4 is simplified (platform side is now a single sentence of "no change"); §8.3.4.e keeps only the ancestor-walk drift guard (iii). §13 Step A is retained but narrowed to `--bare` wording + golden-test shape. No D1 / D3 / D4 / D5 / D6 changes.
**Filename note:** The on-disk filename `composed-lite-harness-brainstorm.md` is kept for git history continuity only; the authoritative subject is the one in the title above.

## 0. Terminology

- **harness** — mechanisms for task decomposition, per-task context assembly, and knowledge compounding. A set of mechanisms, not a single file or runtime.
- **workflow** — orchestration hosting those mechanisms. `auto-mode` and `composed-lite` are workflows.
- **host** — the workflow carrying the harness. Per §4.8, the host is `auto-mode`.
- **`AGENTS.md`** — the platform's ancestor-walked, pre-system-prompt context file. In v1 it is a stable preamble + routing table (§8.3.2). No new file layer is added.
- **L0** — `AGENTS.md` itself. Subject to the byte caps in §8.3.0 C3 / C4.
- **L1** — per-area detail files under `.gsd/docs-map/<area>.md`. Never named `AGENTS.md` or `CLAUDE.md` (§8.3.0 C7, §8.3.3).
- **`memories`** — durable lessons / gotchas / patterns already covered by ADR-013. Earlier drafts referred to this as **"L2"**; that term is conceptual shorthand only and **no new file or discovery layer is introduced**. This document uses `memories` throughout.
- **v1 marker** — the HTML comment `<!-- docs-map: v1 -->` on line 1 of an `AGENTS.md` / `CLAUDE.md` that opts in to section-aware loading (§8.3.0 C1).

## 1. Original User Request (background)

The user asked for a harness engineering system on top of `gsd-2` with four goals: task decomposition, per-task context minimisation, a progressive docs-map centered on `AGENTS.md`, and using accumulated process data to iteratively improve the docs-map. Design-only scope.

Per §4.8, three of the four goals are already implemented inside `auto-mode`. Only the progressive-docs-map goal remains an open gap, and that is what this document designs. Prior art inside `gsd-2` (see §4.9) is the authoritative reference; the OpenAI article that inspired the original framing was not inspected directly.

## 2. Discussion Boundaries

### In Scope

- Locating the real harness host by evidence (§4).
- Designing the `AGENTS.md` routing-table model, section-aware loading protocol, and the v1 contract matrix (§8.3) — the one genuine gap.
- Mapping that design onto the existing `auto-mode` lifecycle phases (§9).
- Recording a minimal follow-up for `composed-lite` so it does not diverge (Appendix A).

### Out of Scope

- Any code / prompt / template implementation or rewrite.
- Any automatic documentation mutation by agents.
- Any repository structure changes beyond the recommended `.gsd/docs-map/` convention.
- Redesigning task decomposition, per-task context assembly, or knowledge compounding as if they did not already exist in `auto-mode` (§4.8).
- Runtime validation. **This document records a discussion outcome only; it does not imply code changes, prompt changes, file-layout changes, runtime-behaviour changes, or approval to implement.** Implementation requires a separate planning phase and explicit review.

## 3. Core Problem Statement

Three linked engineering problems. Per §4.8, only **context minimisation** intersects an unsolved surface (`AGENTS.md` ingestion); the other two are already covered by `auto-mode` + ADR-013 and receive no new design here.

- **Task decomposition** — covered by `auto-mode` milestone → slice → task with ADR-011 sketch-and-refine and `gsd_plan_slice` + `plan-quality-validator`. (§4.8 Part A)
- **Context minimisation** — covered for most surfaces by `context-budget.ts` / `inlineGraphSubgraph` / `queryKnowledge` / `truncateAtSectionBoundary`; **unsolved surface** is the `AGENTS.md` full-file ancestor walk (§4.10). §8.3 addresses only this surface. (§4.8 Part B)
- **Knowledge compounding** — covered by ADR-013 `memories` table + `capture_thought` / `memory_query` / `gsd_memory_graph` auto-injected via `loadMemoryBlock`; "propose, don't mutate" enforced in `execute-task.md:86`. (§4.8 Part D)

## 4. Confirmed Facts from the Current Codebase

The following facts were established from direct code inspection during this discussion and the immediately preceding architecture analysis.

### 4.1 `composed-lite` baseline facts

`gsd-2` provides the CLI, session/runtime, resource loading, extension runtime, model/tool system, and workflow dispatch. `composed-lite` is not a markdown template but a runtime-owned workflow selected via `executor_extension: composed-lite` and dispatched to a dedicated runtime. It carries a strong governance skeleton: phase-driven runtime (`p0-admission` through `p7-postmortem`), durable state (`.gsd/composed-lite/state.yaml` + `.gsd/STATE.json`), envelope-with-content-hash artifacts, per-phase raw logs, append-only hash-chained audit, a constrained review harness, and runtime-owned command-based verification.

Task decomposition exists in primitive form: Phase 3 produces `impl-plan` as structured YAML with per-step `title / files / acceptance / rollback_hint`, validated by a strong schema, and Phase 4 executes steps sequentially. Phase 4 also already assembles per-task context — current step, allowed / target files, acceptance assertions, original requirement, last verification failure, prior review findings, previous implementation summary — but does so as a hand-rolled string without declared context classes, routing rules, or explicit budgets. Full citations: Appendix B.

### 4.2 `auto-mode` / `AGENTS.md` / docs-routing baseline facts

`auto-mode` hosts a mature, production harness. `auto-prompts.ts` (2439 lines, 40+ exports) is the production harness implementation — not partial or experimental — covering dependency-scoped carry-forward, knowledge inlining from `.gsd/KNOWLEDGE.md`, `RUNTIME.md` inlining, graph-based contextual subgraphs on the main path of three prompt builders, budget-aware section-boundary truncation, task / slice / milestone layering, resume sections, skill activation, ADR-011 mid-execution escalation, and `capture_thought` / `memory_query` integration (ADR-013). Framing: **`auto-mode` is the harness; `composed-lite` is a lighter linear flow that never adopted these mechanisms by design.** §4.8 tabulates the evidence.

The platform already recognises `AGENTS.md` as a first-class context entry point. `resource-loader.ts:57-112` walks ancestor directories and looks for `AGENTS.md` / `CLAUDE.md` with two load-time invariants any v1 loader must preserve or explicitly override — (1) per-directory **first-match mutual exclusion** (`AGENTS.md` wins; `CLAUDE.md` silently shadowed), and (2) concatenation order **global → ancestor(root → cwd)**, giving cwd-adjacent files the rightmost (latest) position. `--bare` is the only existing escape hatch and suppresses the whole mechanism indiscriminately.

Internal prior art for docs-routing already exists: `docs/dev/agent-knowledge-index.md` is explicitly structured as a "machine-operational routing table for pi docs" with `Use when / Read first / Read together / Follow-up` blocks, and `.gsd/*.md` named roots such as `KNOWLEDGE.md` and `RUNTIME.md` plus `queryKnowledge` already scope reads by keyword. The v1 design formalises and extends these existing surfaces rather than inventing a new mechanism; see §4.9 for authoritative prior-art references. Full citations: Appendix B.

### 4.8 Auto-mode already implements the majority of harness engineering

This section records, by evidence, that `auto-mode` — not `composed-lite` — is the real harness host. It is the factual foundation for the Decisions in §7 and the scope in §8.

Confirmed from (combined with §4.2):

- `src/resources/extensions/gsd/prompts/refine-slice.md` — ADR-011 Phase 1 landed implementation
- `src/resources/extensions/gsd/graph-context.ts` — called from three main prompt builders
- `src/resources/extensions/gsd/context-budget.ts` — `computeBudgets` / `truncateAtSectionBoundary`
- `src/resources/extensions/gsd/context-store.ts` — `queryKnowledge` keyword-scoped filter
- `src/resources/extensions/gsd/bootstrap/system-context.ts` — `loadMemoryBlock` (ADR-013 step 4, landed and auto-injected in `before_agent_start`) + `loadKnowledgeBlock`
- `src/resources/extensions/gsd/tests/plan-quality-validator.test.ts` — 32 assertions against `gsd_plan_slice` contract
- `src/resources/extensions/gsd/tests/load-memory-block.test.ts` — confirms `loadMemoryBlock` is code-level, not ADR-proposed

Coverage map by harness concern:

| Harness concern | `auto-mode` coverage | Location / evidence |
|---|---|---|
| **Part A: Task Decomposition** | | |
| Three-level task model (milestone/slice/task) | ✅ | `.gsd/<mid>/<sid>/tasks/<tid>-PLAN.md`, `paths.ts` |
| Progressive planning (sketch-and-refine) | ✅ | ADR-011 Phase 1, `refine-slice.md:1-70` |
| Task plan structural schema + code validation | ✅ | `gsd_plan_slice` + `plan-quality-validator.test.ts` |
| Executor context constraint (task count, per-task budget) | ✅ | `formatExecutorConstraints` in `auto-prompts.ts` |
| **Part B: Context Assembly** | | |
| Budget engine | ✅ | `context-budget.ts` `computeBudgets`, `MAX_PREAMBLE_CHARS=30_000` |
| Section-boundary smart truncation | ✅ | `truncateAtSectionBoundary` |
| Dependency carry-forward | ✅ | `buildCarryForwardSection` |
| Resume section | ✅ | `buildResumeSection` |
| Skill activation | ✅ | `buildSkillActivationBlock` |
| Phase anchor | ✅ | `phase-anchor.ts` + `readPhaseAnchor` |
| Knowledge subgraph injection | ✅ | `inlineGraphSubgraph` called in `buildResearchSlicePrompt:1243`, `buildPlanSlicePrompt:1341`, `buildExecuteTaskPrompt:1529` — main path, not experimental |
| Keyword-scoped knowledge filter | ✅ | `queryKnowledge(content, keywords)` in `context-store.ts:225` |
| RUNTIME.md inline | ✅ | `resolveRuntimeFile` + `inlineFile` in `buildExecuteTaskPrompt:1559-1563` |
| **Part C: Progressive docs-map** | | |
| Routing-table concept as proven pattern | ✅ | `docs/dev/agent-knowledge-index.md` — §4.9.1 |
| `.gsd/*.md` named-file registry | ✅ | `paths.ts` `GSD_ROOT_FILES` (8 entries: `PROJECT / DECISIONS / QUEUE / STATE / REQUIREMENTS / OVERRIDES / KNOWLEDGE / CODEBASE`) — note `RUNTIME.md` is **not** in this registry; it is resolved separately via `resolveRuntimeFile()` (`paths.ts:403-405`) |
| Section-aware AGENTS.md loading | ❌ | **Gap — subject of §8.3** |
| AGENTS.md as routing table (not content dump) | ❌ | **Gap — subject of §8.3** |
| L1 local docs-map files | ❌ | **Gap — subject of §8.3** |
| **Part D: Knowledge Compounding** | | |
| Memories table as canonical store | ✅ | ADR-013 accepted, steps 1-4 landed |
| `capture_thought` / `memory_query` tools | ✅ | `execute-task.md:35, 85-86` integrated |
| Six-category structured knowledge | ✅ | `architecture / convention / gotcha / pattern / preference / environment` + `structuredFields` JSON |
| Auto-injection `loadMemoryBlock` | ✅ | `system-context.ts:147, 246` active on `before_agent_start` |
| Extract-learnings flow | ✅ | `commands-extract-learnings.ts` (19.9KB) |
| "Propose, don't mutate" rule for durable knowledge | ✅ | `execute-task.md:86` explicit ban on direct `KNOWLEDGE.md` / `DECISIONS.md` appends |

Three parts out of four are already solved. The remaining part (C) is the only genuine design work this document should drive.

### 4.9 Internal prior art already covers the progressive-docs-map concept — but not in `AGENTS.md`

Two internal documents in this repository independently anticipated the progressive-docs-map idea. Both are references for §8.3; neither has been applied to the `AGENTS.md` ingestion path.

#### 4.9.1 `docs/dev/agent-knowledge-index.md` is the routing-table pattern

Confirmed from: `/Users/l/tencent/gsd-2/docs/dev/agent-knowledge-index.md`

This file is structured exactly as the routing-table model requested in the original §8.3:

- Opening line: "Use this file as a machine-operational routing table for pi docs and research references."
- Explicit rules: "Read only the specific files relevant to the current task. Prefer the primary bundle first. Follow conditional references only when the primary bundle does not answer the question."
- Per-topic sections with `Use when`, `Read first`, `Read together when relevant`, `Follow-up if needed` blocks.

This is the progressive routing model, already proven inside `gsd-2`. Its limits: it covers only pi platform architecture docs, lives outside the `AGENTS.md` slot, and is not wired into `auto-mode` prompt assembly.

#### 4.9.2 `docs/dev/pi-context-optimization-opportunities.md §5` identifies the platform-level anti-pattern

Confirmed from: `/Users/l/tencent/gsd-2/docs/dev/pi-context-optimization-opportunities.md` section 5 "Context File Deduplication and Trim".

That section names the `AGENTS.md` ancestor-walk anti-pattern explicitly:

> **Anti-pattern**: A project with AGENTS.md at 3 ancestor levels (repo root, workspace, home) injects all three in full. If they share common boilerplate, that content is re-injected multiple times.

It then proposes three remedies, the most relevant of which is:

> **Section-aware loading**: Parse `## ` headings in AGENTS.md; only include sections relevant to the current task type (e.g., `## Testing` section only when running tests).

This is the platform-level implementation of progressive docs-map. The document is tagged `Research only — not planned for implementation`.

#### 4.9.3 Consequence

§8.3 is therefore not a new design but a **consolidation of two internal proposals that were never bridged**: take the routing-table pattern from §4.9.1, land it inside `AGENTS.md`, and land the section-aware loader from §4.9.2 inside the platform so that the pattern is actually honored at ingestion time.

### 4.10 The `AGENTS.md` ingestion path is an unbounded full-file ancestor walk

Confirmed from: `@/Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:57-112`

Behaviour:

- `loadContextFileFromDir` reads an entire `AGENTS.md` (or `CLAUDE.md`) via `readFileSync(filePath, "utf-8")` with no chunking, no section filter, no budget. Per directory, the two filenames are **first-match mutually exclusive**: `AGENTS.md` wins if both exist; `CLAUDE.md` is silently shadowed.
- `loadProjectContextFiles` first reads the global file from `agentDir`, then walks from `cwd` all the way up to the filesystem root, accumulating every `AGENTS.md`-or-`CLAUDE.md` match it finds. Final order in the concatenated context is **global → ancestor(root→cwd)**.
- `--bare` is the only escape hatch (`src/headless.ts`), and it suppresses the whole mechanism indiscriminately.

Implications for any L0 / L1 docs-map design:

1. `AGENTS.md` content is effectively a pre-system-prompt injection, arriving before the harness-layer budget engine can touch it.
2. Any L1 file also named `AGENTS.md` **or `CLAUDE.md`** will be slurped on top of the L0 file at ancestor-walk time, defeating any intended separation.
3. Projects with an existing `CLAUDE.md` that want to adopt the v1 schema must migrate carefully: introducing a sibling `AGENTS.md` **silently shadows** the original `CLAUDE.md` under the first-match rule (see §11 Risk 3 for mitigation).
4. Any docs-map protocol must either
    - (a) **impose a hard byte cap** on the L0 file (lint-enforced) so the full-file slurp stays tolerable — this is what v1 does under D2' / candidate C (§6.5 + C15), and
    - (b) **upgrade the resource-loader itself** to support section-aware loading per §4.9.2 — deferred to v2 as candidate A.

v1 picks option (a) — lint-enforced cap with no loader change; §8.3 is the concrete schema + extension helper that makes (a) workable.

### 4.11 `AGENTS.md` ingestion lives on the system-prompt path; `taskTypeHint` is a task-prompt concept — **RESOLVED by §6.4 D2'**

Under v3.5 / D2' the two paths are fully decoupled: the system-prompt path continues to carry the full `AGENTS.md` unchanged; the task-prompt path applies optional-section routing via the extension-side `loadAgentsSection` (§8.3.4.b). No signal crosses the boundary and no platform change is required.

**Evidence anchor:** `agent-session.ts:1001-1003, 821-826, 1955-1959` (system-prompt rebuild from `getAgentsFiles()`); `auto-prompts.ts` builders (task prompts, orthogonal). Earlier multi-candidate architecture discussion retired; see Appendix D.

## 5. Analysis Process Summary

Evidence lives in §4; decisions live in §6; prior art and deferred options in the appendices. The six-step reframe → host-reversal → `auto-prompts`-confirmation → `AGENTS.md`-weakness-location → concern-separation → four-parts-to-one reduction trail is preserved in Appendix D v2 / v3 changelog entries; no implementation-relevant content is gated behind this section.

## 6. Key Design Decisions

Three framing decisions plus a v3.2 architecture-decision block. Older drafts had six framing decisions; see Appendix D for the full reversal trail.

### 6.1 Host: `auto-mode` is the harness host, not `composed-lite`

Evidence in §4.8 shows `auto-mode` already implements Parts A / B / D; `composed-lite` does not. `composed-lite`'s Phase 7 is audit-sealing (not a feedback signal), and its Phase 4 worker is a deliberately-simpler `spawn()`-ed fresh `gsd` process with a hand-rolled task string. Porting 13+ modules of `auto-prompts` dependency chain into it would eliminate its design premise.

**Decision.** The harness host is `auto-mode`. The §8.3 design attaches to the `auto-mode` lifecycle (plan-milestone, refine-slice, execute-task, complete-slice, complete-milestone). `composed-lite` receives a small, optional follow-up (Appendix A) to prevent divergence; the follow-up is **not** the proposal.

### 6.2 Scope: only Part C (progressive `AGENTS.md`) is new design

Parts A / B / D are covered by existing code and ADRs:

- **Part A (task decomposition).** `gsd_plan_slice` writes DB-backed task plans with a documented shape (`refine-slice.md:57`); `plan-quality-validator.test.ts` enforces 32 assertions. Extensions (e.g. a `non-goals` field) belong against `gsd_plan_slice` + validator, not a parallel schema.
- **Part B (context assembly).** `auto-prompts.ts` + `context-budget.ts` (`computeBudgets`, `MAX_PREAMBLE_CHARS=30_000`, `truncateAtSectionBoundary`) run on the main path of `buildResearchSlicePrompt`, `buildPlanSlicePrompt`, `buildExecuteTaskPrompt`. The only context surface they do **not** touch is `AGENTS.md` ingestion — §8.3.
- **Part D (knowledge compounding).** ADR-013 ("Memory Store Consolidation", accepted 2026-04-19) makes the `memories` table the canonical store; `KNOWLEDGE.md` / `DECISIONS.md` become read-only projections; `loadMemoryBlock` is auto-injected in `before_agent_start`; direct appends banned in `execute-task.md:86`. Promotion from `memories` to Routing Rules is locked in §6.4 D6 (batch via `extract-learnings`).

**Decision.** This document's design deliverable is strictly §8.3 (plus the v1 contract matrix in §8.3.0). Everything else is acknowledgement of existing machinery.

### 6.3 Schema shape: `AGENTS.md` is a stable preamble + routing table

The platform slurps `AGENTS.md` as a full file at ancestor-walk time (§4.10), so a "keep it short" soft rule is unenforceable — a hard byte cap plus a structural schema are. L0 content is intentionally mixed: `Overview` / `Invariants` / `High-risk Zones` are stable preamble; `Routing Rules` is the actual routing table; optional sections are task-scoped area summaries. All sit under the caps in §8.3.0 C3 / C4.

**Decision.** `AGENTS.md` v1 is defined structurally by §8.3.0's contract matrix and §8.3.2's schema. The loader honours the schema only when the v1 marker is present (C1); absent the marker, behaviour is byte-for-byte unchanged (C11).

### 6.4 v3.2 Architecture decisions (2026-04-23)

Locked during review-response iteration. Each row supersedes the "open question" or "candidate" wording that previously appeared in §8.3.4 / §12 / Appendix E.

| # | Question | Decision | Supersedes |
|---|---|---|---|
| **D1** | `composed-lite` → `main` migration posture | **Posture (b) — stabilise-first.** Migration PR consolidates the four host dispatch special-cases into one `executorExtensionRegistry: Map<string, ExecutorRunner>`; `composed-lite/index.ts` self-registers at load time; `loadYamlPlugin` is updated to propagate `executor_extension` (symmetric across md/yaml/registry loaders). | Appendix E.4 open choice; §13 Step −1 "decide" |
| **D2'** | `taskTypeHint` → `resource-loader` data-flow architecture | **(III) Extension-only rendering (candidate C in §6.5).** Platform loader is **unchanged** in v1. All section-aware behaviour — mandatory parsing, cap enforcement, optional-section routing — lives inside the GSD extension via `loadAgentsSection(name)` at task-prompt build time. `AGENTS.md` continues to enter the system prompt as a full file per the existing `loadProjectContextFiles` path; v1 marker becomes a **schema / lint / CI** contract rather than a **loader** contract (see new C15). Platform-zero-change preserves open-source iteration surface. Candidates A (platform loader-branch) and B (`agentsFilesOverride`) are both deferred to v2. | §4.11 open question; §8.3.4 three-candidate block; §12.5 platform boundary; v3.4 §6.5 candidate comparison |
| **D3** | `taskTypeHint` derivation location | **Extension-private.** Pure function in `src/resources/extensions/gsd/derive-task-type-hint.ts` (or equivalent), consumed only by `auto-prompts.ts` builders. Platform does not see the hint. Single hint per task (C9). | §12.2 sub-questions |
| **D4** | v1 marker / schema details | **Line-1 HTML comment `<!-- docs-map: v1 -->` (C1)** kept as-is; `## Invariants` is bullet-only in v1 (paragraphs deferred to v2); char cap is **fixed** (not context-window-scaled) in v1. | §12.1 |
| **D5** | First L1 file | **`.gsd/docs-map/testing.md`.** Widest coverage, lowest failure cost when routing under-matches. | §12.3 |
| **D6** | `capture_thought` → Routing-Rule promotion | **Batch via `extract-learnings`.** Milestone-close scan proposes Routing-Rule edits into a human review queue. No per-thought `propose_for_agents_md` flag in v1. Repetition / confidence threshold kept open (§12.4). | §12.4 options α vs β vs γ |

**Consequences recorded elsewhere:**

- D1 → Appendix E.4 resolved; Risk 9 mitigation promoted from open to decided.
- D2' → §8.3.4 simplified (platform is "no change"; all rendering inside the extension); §4.11 marked resolved but now resolves to extension-side handling; §12.5 restated as "platform has no v1 boundary to own"; Risk 4 becomes "not applicable — `getAgentsFiles()` shape & content are untouched"; new C14 / C15 in §8.3.0.
- D2' locks **platform footprint for v1**: **zero files changed under `packages/pi-coding-agent/`**. C13's "no new platform return shape" is strengthened to "no platform change at all." A GSD-side `loadAgentsSection` helper performs its own read-only ancestor walk / parse against v1-marked files.
- D3 → `auto-prompts.ts` builders gain one new input (hint) and one new helper call (`loadAgentsSection`). No platform signature change.
- D4 / D5 / D6 → §12.1 / §12.3 / §12.4 close.

**Responsibility boundaries (v1, under D2'):**

| Layer | Responsibility | Must not do in v1 |
|---|---|---|
| **Platform loader** | **Unchanged.** Continue current full-file ancestor walk per `loadProjectContextFiles` | Be modified at all (no marker parsing, no cap enforcement, no rendering change, no return-shape change, no hook wiring) |
| **GSD extension** | Derive deterministic hint; run `loadAgentsSection(name)` (own ancestor walk, marker parse, cap enforcement); inject optional L0 into task prompts; emit diagnostics on its own `EventBus` channel | Move routing decisions into the model or invent a parallel knowledge layer; widen the platform contract |
| **Runtime agent** | Consume Routing Rules (seen in full because `AGENTS.md` still enters system prompt whole in v1), pull L1 docs via `read_file`, use existing memory tools | Choose optional L0 routing independently or mutate `AGENTS.md` directly |
| **`extract-learnings`** | Batch-propose Routing Rule edits into a human review queue | Add a per-thought promotion flag in v1 or write `AGENTS.md` directly |
| **Human reviewer / lint / CI** | Author `AGENTS.md`, enforce C3 / C4 caps via lint + CI (not loader); approve proposals; tune promotion thresholds | Delegate policy authorship wholly to the agent; assume loader enforces caps |

`agent` is therefore **not** the routing decider in v1: optional L0 routing comes from deterministic hint derivation in the extension, while the agent only consumes the result and may pull L1 files on demand under C8.

Anything not in this table that is still marked "open" in §12 is a **v2 candidate**, not a v1 blocker.

*Note on numbering: §7 is intentionally unused in this revision. The six-decision structure of the v2 draft has been collapsed into §6.1–§6.3; §6.4 above holds the v3.2 architecture decisions separately. See Appendix D.*

### 6.5 v1 implementation ownership — candidate C selected

**Decision (v3.5):** candidate **C (extension-only, platform-zero-change)** is selected. This supersedes D2's "(II) Dual-path ingestion" framing; the current line in §6.4 is D2' and locks this choice. Candidates A and B are deferred to v2 and recorded below for reference.

**Selection rationale:**

1. **Matches the primary user constraint — minimal impact on gsd-2 open-source iteration.** Candidate C is the only option with zero files changed under `packages/pi-coding-agent/`.
2. **Evidence compounding.** Independent `git diff main...HEAD` shows the current `feat/composed-lite-runtime-owned` branch already does not touch `packages/pi-coding-agent` (see Appendix E.1). Candidate C extends this property through the v1 feature set.
3. **C11 marker opt-in is already the safety net.** Repos that do not add `<!-- docs-map: v1 -->` behave byte-identically; repos that opt in accept lint/CI-enforced caps. User-facing behaviour between candidate A's "loader-enforced cap" and candidate C's "lint/CI + marker opt-in" is negligible; upstream-maintainer-facing behaviour is very different.
4. **Candidate B has structural gaps (v3.4 evidence).** `agentsFilesOverride` is construction-time, post-read, and has no diagnostics slot. Choosing B would require three platform-level fixes before it becomes safe; choosing C needs none.
5. **Candidate A's trade-off is backwards for this phase.** Paying a platform change now to get loader-enforced caps for TBD C3 / C4 numbers is premature; lint/CI gives the same enforcement with zero platform risk, and the upgrade path to A in v2 (after real usage data) remains open.

**Candidate comparison (reference only).**

| # | Ownership shape | Platform `main`-tree changes | v1 status |
|---|---|---|---|
| **A** | Platform loader mandatory-only + extension optional | Modify `resource-loader.ts` + shared `truncateAtSectionBoundary` | Deferred to v2 |
| **B** | App-layer `agentsFilesOverride` renders mandatory-only | Modify `main.ts` + extend hook signature for diagnostics + add extension-register API | Deferred to v2 |
| **C** (selected) | Extension-only: `loadAgentsSection` does all parse / cap enforcement / optional-section routing | **None** | **Selected** |

**Evidence preserved (motivation for B's deferral).** `agentsFilesOverride` exists (`@/Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:152-154, 192-194, 241, 450-452`) and is used today only by `--bare` (`@/Users/l/tencent/gsd-2/packages/pi-coding-agent/src/main.ts:431-432`). Three properties make it unsafe as a v1 substrate: (i) construction-time injection prevents extension registration; (ii) `loadProjectContextFiles(...)` is called before the override, so full files are already in memory; (iii) `{agentsFiles}` → `{agentsFiles}` signature has no diagnostics slot. A v2 revisit that wants candidate B must first address these three.

**What §13 Step A now handles (narrowed).** With ownership decided, the remaining spike surface is small:

1. Lock `--bare` wording for C14 (recommendation: "traversal suppressed; v1 marker behaviour does not activate under `--bare`").
2. Decide the golden-test shape for §8.3.4.e (iii) ancestor-walk mirroring (the only boundary still live under candidate C).
3. Confirm that `extract-learnings` + lint/CI enforcement of C3 / C4 is implementable without a platform change (sanity check, not a redesign).

Step A's output remains a short addendum (≤ 50 lines under candidate C) and must not reopen D1 / D3 / D4 / D5 / D6 / D2'.

## 8. Proposed Design

The single design deliverable is §8.3 — a progressive docs-map for `AGENTS.md`. Parts A / B / D are acknowledged as already-solved by `auto-mode` + ADR-013 and receive no new design here; see §6.2 for the coverage summary and §4.8 + Appendix B for the evidence. §8 is therefore structured as one design subsection (§8.3) rather than four.

### 8.3 Part C — Progressive docs-map for `AGENTS.md`

The design has two coupled deliverables:

1. An `AGENTS.md` structural schema that works as a small stable preamble + routing table rather than a content dump (§8.3.2).
2. An **extension-side** section-aware helper (`loadAgentsSection`) that honours the schema at task-prompt build time, plus lint / CI that enforces the caps at author time (§8.3.4, under D2' / candidate C). The platform loader is intentionally untouched in v1; the existing full-file ancestor walk of §4.10 remains the system-prompt ingestion path. This is a deliberate trade: user projects opt into docs-map via the C1 marker, and the marker's teeth come from lint/CI + `loadAgentsSection` in the task-prompt path, not from a loader change.

L0 content is intentionally mixed: a small always-loaded preamble plus task-routed guidance. The invariants that any implementation must honour are consolidated in §8.3.0 below.

#### 8.3.0 v1 Contract Matrix

This is the authoritative, implementation-facing summary of v1. Everything else in §8.3 is commentary. A contract listed here **must** be honoured by any loader / schema / prompt-builder change; prose elsewhere that appears to contradict it is wrong and should be patched against this table.

| # | Contract | Decision (v1) | Rationale / Evidence | Open Risk | Deferred Options |
|---|---|---|---|---|---|
| **C1** | Opt-in marker | An `AGENTS.md` or `CLAUDE.md` is v1-managed iff **line 1 exactly equals** `<!-- docs-map: v1 -->`. Files whose line 1 is BOM / empty / YAML frontmatter `---` fall back to legacy full-file behaviour. | §4.10; opt-in keeps legacy files byte-identical. | Some editors strip leading BOM silently. | Later marker via frontmatter `docs_map: v1`. |
| **C2** | L0 mandatory sections | `## Overview` / `## Invariants` / `## High-risk Zones` / `## Routing Rules` are authored in `AGENTS.md` and (under D2') continue to enter the system prompt as part of the full file. Optional L0 sections load only on `taskTypeHint` match via `loadAgentsSection` (C9 / C10; §8.3.4.b). In v1 the loader does **not** render "mandatory-only"; authors rely on C3 / C15 to keep the full file small enough that "mandatory-only" is not needed. | §8.3.2 + D2'. | `Routing Rules` may be empty in a fresh repo. | Mandatory-only loader rendering (would become candidate A in v2). |
| **C3** | Per-file cap + counting | L0 mandatory sections combined ≤ **2000 characters** (JS `string.length`); each optional L0 section ≤ **1000 characters**; the whole `AGENTS.md` file ≤ **4000 characters**. **Numbers are TBD pending §13 step 0 footprint measurement.** Enforcement is by lint / CI per C15, not by loader. | Aligns with `context-budget.ts` character-based budgeting; not tokens. | Measurement may justify different defaults. | Secondary token-based cap (future). |
| **C4** | Cross-chain total cap | Across global + all ancestor `AGENTS.md` files combined, L0 mandatory ≤ **4000 characters** *(TBD, same measurement)*. In v1 this is checked by the **`extract-learnings` / lint job**, not by the loader (because the loader is untouched per D2'). When the combined total exceeds cap, the lint job flags the offending file chain and recommends author action; it does **not** truncate at ingestion. | Closes the 3-level ancestor blow-up path identified in §4.10 and `pi-context-optimization-opportunities.md §5`, while keeping platform untouched. | Advisory-only enforcement may be ignored by authors. | Loader-level truncation via `truncateAtSectionBoundary` (candidate A, v2). |
| **C5** | Same-section merge across ancestors | **Nearest-wins inside `loadAgentsSection` only.** When two ancestor files both carry e.g. `## Testing`, `loadAgentsSection("testing")` returns the cwd-nearest copy and emits a diagnostic naming both files on the extension's EventBus. The system-prompt path is unaffected (ancestor concatenation order for full-file loading stays as `resource-loader.ts` currently defines it). | Predictable behaviour; avoids silent concatenation; no platform change required. | Home-level global rules can be shadowed in optional-section routing. | `<!-- merge: append -->` marker per section (future). |
| **C6** | L0-optional vs L1 split rule | A section belongs in L0 optional when **all three** hold: (a) fits under the 1000-char cap; (b) needed by ≥ ~90% of tasks in its area; (c) changes at most quarterly. If any fails, content moves to an L1 file referenced by a Routing Rule. | Removes the "write in L0 or in L1?" ambiguity identified during review. | Thresholds are judgemental; expect calibration after first 2–3 L1 files. | Lint rule that flags cap violations automatically. |
| **C7** | L1 naming & location | L1 files live under `.gsd/docs-map/<area>.md` (or pre-existing `docs/<area>/` trees); they **must not** be named `AGENTS.md` or `CLAUDE.md`. L1 paths in Routing Rules must be **repo-relative**, contain no `..` segments, and must not traverse symlinks. | Prevents re-triggering the ancestor-walk slurp; bounds ingestion surface. | Cross-repo sharing of L1 files becomes harder. | Allowlist mechanism for shared L1 roots. |
| **C8** | L1 ingestion semantics | v1 **does not auto-inline L1 files** into the prompt. A Routing Rule declares "(when condition) read (path)"; agent resolves it via `read_file` at task time. L1 bytes count against the **task** budget, never against the L0 preamble. | Keeps v1 loader simple and avoids re-creating full-slurp. | Agent may skip reading relevant L1. | Builder-side auto-inline of L1 (future; requires new contract). |
| **C9** | `taskTypeHint` input whitelist | Hint is a pure function over (a) task title, (b) task plan `Files[]`, (c) phase-anchor as a coarse fallback only. **The model MUST NOT produce the hint.** A single hint per task in v1. | `phase-anchor` gives phase, not domain — §5 para 4; confirmed during review. | Whitelist may not cover niche tasks. | Add `skills_used` as a fourth input (future). |
| **C10** | Hint & section canonicalisation | Both hint and optional section name are canonicalised via `s.toLowerCase().trim().replace(/\s+/g,'-')` before matching. Example: `"Build and Deploy"` → `build-and-deploy`. **No aliases in v1.** Unknown hint ⇒ `loadAgentsSection` returns `null`, builder proceeds without optional section, and a diagnostic is emitted on the extension's EventBus channel. | Prevents silent drift between header text and hint enum. | Teams may want aliases. | `alias:` frontmatter per section (future). |
| **C11** | Legacy compatibility | Any `AGENTS.md` / `CLAUDE.md` **without** the v1 marker must be loaded byte-for-byte identically to today. Golden tests gate this. First-match mutual exclusion (`AGENTS.md` ≻ `CLAUDE.md`) from `resource-loader.ts:57-71` is preserved. | Protects existing user projects. | Migration still silent-shadows `CLAUDE.md` when a sibling `AGENTS.md` is added (Risk 8). | Opt-in flag to invert precedence (future). |
| **C12** | Determinism principle | Hint derivation, section matching, canonicalisation, and truncation order are deterministic pure functions with no model-in-the-loop. Any future "ask the model what hint to use" requires a new contract superseding C9 / C12. | Elevates the most common v2-drift risk to contract level. | None in v1. | n/a |
| **C13** | Platform non-modification boundary | v1 introduces **no platform changes at all**. `getAgentsFiles()` signature, `loadProjectContextFiles` behaviour, and `agentsFilesOverride` hook are all untouched. `loadAgentsSection(name)` is entirely extension-owned and repeats the ancestor walk + parse locally against v1-marked files. C13 strengthens the v3.3 wording from "no new platform return shape" to "no platform change." | Preserves D2' platform-zero-change; aligns with the evidence in Appendix E.1 that the migration PR can also stay out of `packages/pi-coding-agent`. | Duplicate parse / I/O between the existing full-file ancestor walk and `loadAgentsSection`'s walk. | Shared parsed-section view / mandatory-only rendering become candidate A in v2. |
| **C14** | `--bare` behaviour | When `--bare` is passed, `loadProjectContextFiles` returns `[]` (current code at `main.ts:431-432`); v1 marker behaviour does **not** activate under `--bare` because there is no `AGENTS.md` text to parse. This is explicit, not incidental. | `--bare` is the user's documented way to suppress AGENTS.md; v1 must not re-introduce it through a back door. | Users running `--bare` get no marker-aware routing — documented, not fixed. | `--bare` flag invert for "v1 marker only, no full-file" (future). |
| **C15** | Cap enforcement mechanism | C3 / C4 are enforced by a **lint / CI job** (recommended home: the same tooling that runs `extract-learnings` at milestone close, plus a pre-commit / CI step in user repos that opt in). v1 ships a reference lint rule as part of the GSD extension; user repos are expected to wire it into their own CI. The platform loader performs **no cap enforcement** in v1. | Keeps D2' platform-zero-change intact while still giving the cap teeth. Matches Alternative E's "just keep it short" only in name — the difference is that C15 is automatable and gated on the marker, whereas Alternative E had no automation. | Author can bypass lint locally; CI enforcement depends on user repo configuration. | Loader-level truncation (candidate A, v2). |

**Conventions for this matrix:**

- Numbers marked *TBD* in C3 / C4 are placeholders; §13 step 0 (footprint measurement) is the gate to freeze them.
- When this table conflicts with `§8.3.1–§8.3.7`, the table wins.
- Appendix C tracks candidate **implementation shapes** (function names, tool signatures, promotion paths) that this matrix intentionally leaves unspecified.

#### 8.3.1 Goals

- **G1** — `AGENTS.md` fits inside a hard character cap (per C3 / C4), enforced by lint / CI per C15 (not by loader).
- **G2** — Its content routes the agent to other files on demand, rather than carrying those files' content.
- **G3** — The task-prompt path loads only the sections relevant to the current task via `loadAgentsSection`; the system-prompt path still carries the full `AGENTS.md` per the existing loader, under the assumption that G1 keeps the file small enough for that to be tolerable.
- **G4** — The design composes with existing `auto-prompts` / `loadMemoryBlock` / `capture_thought` / `.gsd/*.md` machinery without duplication.
- **G5** — The design is compatible with `--bare` (C14), with the existing ancestor-walk (C11), and introduces zero platform changes (C13).

#### 8.3.2 `AGENTS.md` v1 structural schema

`AGENTS.md` is a single **L0** file with fixed top-level sections. The extension-side `loadAgentsSection` (§8.3.4) keys on these section names for optional-section routing; the full file continues to enter the system prompt per the existing loader. Additional sections are ignored by `loadAgentsSection` but still appear in the system prompt via the full-file path and may be surfaced to humans.

For the first repository-specific draft discussed in §13, it is sufficient to author the four mandatory L0 sections and route into a single external L1 file. This is a drafting strategy for the initial prototype, not a reduction of the v1 schema.

Mandatory sections (L0, always loaded):

- `## Overview` — one-paragraph summary of what the project is and the primary mental model agents should hold.
- `## Invariants` — bullet list of non-negotiable rules (for example "never write to `.gsd/KNOWLEDGE.md` directly; use `capture_thought`"; "tests must not reference files in `.gitignore`").
- `## High-risk Zones` — bullet list of files or areas where changes are likely to cascade (for example "`resource-loader.ts` changes touch every extension; require ADR").
- `## Routing Rules` — the routing table itself. Each rule is `task-type → file list`, using the exact form proven in `agent-knowledge-index.md` (§4.9.1): `Use when` / `Read first` / `Read together when relevant` / `Follow-up if needed`.

Optional sections (still L0 — inside `AGENTS.md`, never reclassified as L1):

- `## Testing` — "when writing tests, read X, conform to Y".
- `## Build and Deploy` — "when changing build, read X".
- `## Extension Authoring` — task-type-specific pointers for people modifying extensions.
- `## Frontend`, `## Storage`, `## Integration`, etc. — one per major area the project contains.

Size cap (G1):

- L0 mandatory sections: combined `≤ 2000 characters` **(TBD pending §13 Step 0)**, measured in JS `string.length`, enforced by lint / CI per C15.
- Each optional L0 section: `≤ 1000 characters` **(TBD pending §13 Step 0)** individually.
- Whole `AGENTS.md` file: `≤ 4000 characters` (C3 per-file) — because under D2' the full file enters the system prompt and must stay tolerable at turn level.

v1 caps are **character-based, not token-based**, for three reasons: (1) `context-budget.ts` already budgets in characters, (2) character counting is deterministic and provider-agnostic, (3) C3/C4 can be enforced in a lint / CI step without a tokenizer dependency. Any future provider-token gate is a second layer on top, not a replacement.

This cap is chosen so that the full `AGENTS.md` can ride along as a permanent system-prompt preamble without budgeting conflict, while optional L0 sections also activate through `loadAgentsSection` when routed. If C3 / C4 cannot hold for a given repo, the right answer is "move content to L1," not "change the loader."

#### 8.3.3 L1 local docs placement and naming convention

L1 files are per-area detail docs external to `AGENTS.md`. They must never be called `AGENTS.md` or `CLAUDE.md` (to avoid the ancestor-walk trap identified in §4.10).

Recommended convention:

- Location: `.gsd/docs-map/<area>.md` (or the existing `docs/<area>/` tree when one already exists).
- Naming: descriptive (`docs-map/testing.md`, `docs-map/storage.md`), not `AGENTS.md` or `CLAUDE.md`.
- In v1, L1 files are plain detail docs referenced by path. They do **not** participate in automatic ancestor loading, and v1 does **not** define recursive generic section-aware loading of L1 files.
- `AGENTS.md` Routing Rules point **into** L1 files, not vice versa.

Durable lessons and gotchas are explicitly **not** a new file layer. They live in the `memories` table per ADR-013, with `capture_thought` as the write path and `loadMemoryBlock` / `memory_query` as the read paths. §8.3 does not add a parallel knowledge layer.

#### 8.3.4 Section-aware loading protocol (extension-only, v3.5-locked)

Per §6.4 D2' / §6.5, v1 adopts **candidate C — extension-only rendering**. The platform loader is unchanged. The full `AGENTS.md` continues to enter the system prompt via `loadProjectContextFiles`, relying on C3 / C15 (lint-enforced caps) to keep that file small. Optional-section routing lives entirely inside the GSD extension at task-prompt build time.

##### 8.3.4.a Platform side — no change

`loadProjectContextFiles` in `@/Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:75-112` is **not modified in v1**. `getAgentsFiles()` keeps its existing signature and behaviour. The `<!-- docs-map: v1 -->` marker is **not** interpreted by the platform; it is a schema / lint contract only. Golden tests for the unmarked loader remain unchanged (C11).

If v2 wants to reintroduce mandatory-only rendering or `agentsFilesOverride`-based rendering, that is candidate A or B respectively; v1 does not pre-commit to either.

##### 8.3.4.b Extension side — `loadAgentsSection(name)` helper

The GSD extension provides a pure helper, owned by the extension:

- Signature (draft): `loadAgentsSection(name: string): string | null`.
- Performs its own read-only ancestor walk that mirrors the platform loader (§8.3.4.e below), reads each candidate file, checks for the C1 v1 marker, and parses `##` headings only when the marker is present.
- Canonicalises `name` per C10 before matching against headings.
- Honours the per-section cap from C3 by truncating at a section boundary locally (the extension already owns `truncateAtSectionBoundary` in `@/Users/l/tencent/gsd-2/src/resources/extensions/gsd/context-budget.ts`).
- Returns `null` when no v1-marked ancestor file exposes the named section, or when `name` canonicalises to a mandatory-section name (mandatory sections already ride in the system prompt via the full-file path; re-injecting them would duplicate content).
- Is called by `auto-prompts.ts` builders (`buildPlanSlicePrompt`, `buildRefineSlicePrompt`, `buildExecuteTaskPrompt`) using `deriveTaskTypeHint(task)` output as `name`. On `null`, the builder proceeds without the optional section and emits a diagnostic.
- Diagnostics (C5 shadow, C10 unknown-hint fallback, per-section truncation) go onto the extension's own EventBus channel; the platform EventBus is not required to carry them, though the extension may publish there too if that is already idiomatic.

##### 8.3.4.c Why this shape

- **Platform footprint is zero.** No `resource-loader.ts` change, no `main.ts` change, no `agent-session.ts` rebuild, no new return shape. Matches D2' / C13.
- **The full `AGENTS.md` still enters the system prompt.** This means `Routing Rules` / `Invariants` / `High-risk Zones` / `Overview` are visible every turn by virtue of the existing full-file path; optional sections add targeted routing on top.
- **The duplicate full-file + optional-section injection is intentional.** Optional sections are small (C3 ≤ 1000 chars each); the cost of sending a matching optional section alongside the full file is bounded, and the Routing Rule's "Read first" guidance justifies the double-mention.
- **Upgrade path to candidate A is preserved.** If v2 later wants loader-side "mandatory-only rendering," the `loadAgentsSection` helper and the schema are already in place; only a platform-side renderer needs to be added, at which point C2 / C13 / C15 can tighten.

##### 8.3.4.d Scope bounds

V1 keeps the routing signal singular (C9 / §6.4 D3). V1 stops at L0 section-aware task-prompt injection: it does **not** define a recursive generic loader for L1 files, and it does **not** render `AGENTS.md` into mandatory-only form at ingestion time. Any future "let the agent fetch optional sections on demand" shape is Alternative F / C-imp.2; any mandatory-only loader rendering is candidate A.

##### 8.3.4.e Ancestor-walk mirror (the only live implementation boundary under candidate C)

Because `loadAgentsSection` does its own ancestor walk, that walk must match `loadProjectContextFiles`'s behaviour in every respect, or the two paths drift. Concrete mirror list:

- Start point: same `agentDir` global file as `loadProjectContextFiles` (`@/Users/l/tencent/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts:84-88`).
- Per-directory precedence: `AGENTS.md` wins over `CLAUDE.md` (first-match mutual exclusion).
- Ancestor traversal order: global → ancestor(root→cwd); cwd-nearest is the rightmost / latest.
- Stop condition: filesystem root (`resolve("/")`), plus the `parentDir === currentDir` guard at `:104-105`.
- Symlink / traversal: consistent with the loader's inherited behaviour (no explicit guard today; the extension helper must not add a new guard without updating the loader too, or the two diverge).

**Drift guard (the one Step A item that remains).** Add a golden test inside the GSD extension that enumerates a synthetic ancestor tree, captures the `loadProjectContextFiles` output path list (as seen via `getAgentsFiles()`), and compares it to the `loadAgentsSection` helper's internal walker on the same tree. Failing this test is the tripwire for drift. This is the only active §8.3.4.e item under candidate C; the two v3.4-era sub-items (cross-package utility ownership, diagnostics-channel platform surface) disappear because platform is not modified.

#### 8.3.5 Relationship to the existing `.gsd/*.md` registry

The existing `.gsd` root-file mechanism and the new docs-map mechanism are related but not identical. §8.3 must not rename or restructure existing `.gsd` root files. Their relationship to the L0/L1 model is:

| Existing file | Layer in the §8.3 model | Responsibility |
|---|---|---|
| `AGENTS.md` | **L0 — stable preamble + routing table** | Schema defined above (§8.3.2) |
| `PROJECT.md` | Content, not docs-map | Auto-injected via `queryProject()` |
| `DECISIONS.md` | Read-only projection of `memories` | Per ADR-013; do not modify |
| `KNOWLEDGE.md` | Read-only projection of `memories` | Per ADR-013; do not modify |
| `RUNTIME.md` | Content, auto-inlined by `auto-prompts` | Already budget-bounded; resolved separately via `resolveRuntimeFile()`, not via `GSD_ROOT_FILES` |
| `REQUIREMENTS.md` / `OVERRIDES.md` | Content, queried by context-store | No change |
| `QUEUE.md` / `STATE.md` / `CODEBASE.md` | Runtime state, not docs-map | No change |
| `.gsd/docs-map/<area>.md` | **L1 — new local detail docs** | Referenced from `AGENTS.md` Routing Rules; outside the existing root-file registry |

`GSD_ROOT_FILES` in `paths.ts` remains a fixed registry for canonical root files. L1 docs are a separate discovery model and should not be silently treated as new `GSD_ROOT_FILES` entries.

#### 8.3.6 What §8.3 does **not** include

- No automatic writes to `AGENTS.md` by agents. `AGENTS.md` is human-authored. Any agent-driven proposal to update it must go through the `capture_thought` → review → human-commit flow, not through in-place mutation.
- No new knowledge table. Durable lessons and gotchas are the `memories` table per ADR-013.
- No changes to `composed-lite` phase contracts. `composed-lite` improvements are in Appendix A.
- No per-language or per-framework AGENTS.md conventions. The v1 schema is language-agnostic; specialisation is deferred.

#### 8.3.7 Reference to Part D

With ADR-013 covering the memories pipeline, the only Part D–adjacent work that still fits inside §8.3 is Routing-Rule promotion. Per §6.4 D6, this is a **batch** surface inside `extract-learnings` that writes proposals to `.gsd/proposals/` for human review — not a per-thought `capture_thought` flag, and not a new subsystem. Repetition / confidence threshold is deferred (§12.4).

## 9. Mapping the Design onto the `auto-mode` Lifecycle

Consistent with §6.1, the design attaches to the `auto-mode` prompt pipeline; `composed-lite` changes are covered in Appendix A.

### `plan-milestone`

Attachment:

- The milestone-level prompt reads `AGENTS.md` L0 mandatory sections as usual; no per-task hint is available yet, so optional sections are not activated.
- Sketches produced here (ADR-011 Phase 1) reference task areas that later wire into `taskTypeHint` at slice-refine time.

### `plan-slice` and `refine-slice`

Attachment:

- `buildPlanSlicePrompt` / `buildRefineSlicePrompt` compute a `taskTypeHint` from the slice title + sketch area.
- The builders call `loadAgentsSection(hint)` on the GSD side; the platform loader remains mandatory-only per D2.
- `refine-slice` already has access to prior slice Forward Intelligence (see `refine-slice.md:17-19`); §8.3 adds the matched optional L0 section (when any) plus `AGENTS.md` Routing Rule matches as extra, stable signals.

### `execute-task`

Attachment (the most important surface):

- `buildExecuteTaskPrompt` computes a more precise `taskTypeHint` from task title + `Files` paths + file extensions (e.g. paths under `tests/` or extensions `.test.ts` map to `testing`; paths under `web/` map to `frontend`).
- System-prompt path still contributes only mandatory L0 sections; optional L0 comes from extension-side `loadAgentsSection(hint)` and is injected as turn content when present.
- `buildExecuteTaskPrompt` continues to use `inlineGraphSubgraph`, `queryKnowledge`, and `loadMemoryBlock` as before. §8.3 does not replace them; it adds an `AGENTS.md` routing input alongside them.

### `complete-slice` / `complete-milestone` / `extract-learnings`

Attachment:

- No additional prompt-builder changes are required.
- The existing `capture_thought` flow continues to write `gotcha` / `pattern` / `convention` memories into the `memories` table per ADR-013.
- Per §6.4 D6 / §8.3.7, Routing-Rule promotion remains batch-only inside `extract-learnings`; there is no per-thought `propose_for_agents_md` flag in v1.

### `composed-lite` (brief)

Attachment:

- No phase contract changes.
- **Worker inheritance under §6.4 D2' is trivial — the loader is unchanged, across all five spawn sites.** `composed-lite` spawns a fresh `gsd` subprocess at five places: `p1-research.ts`, `p2-design.ts`, `p3-split.ts`, `p4-implementation.ts`, and `review-harness.ts`. Because v1 does not change the platform loader, each subprocess sees the same full-file `AGENTS.md` ancestor walk it sees today. No hint propagation, no marker-aware parsing, and no spawn-time wiring is needed anywhere. `--bare` is honoured per C14 on any spawn site that chooses to pass it.
- Whether any of those five sites chooses to call `loadAgentsSection(name)` when assembling its step prompt is a **composed-lite-internal** choice, independent of the §8.3 v1 contract. If Appendix A is adopted later, that helper would be a natural fit alongside `inlineGraphSubgraph` / `queryKnowledge`, and the adoption should cover all five sites together to avoid half-migrated behaviour.
- Optional follow-up in Appendix A adopts `context-budget` + `truncateAtSectionBoundary` + `inlineGraphSubgraph` inside Phase 4 worker prompt assembly. (Appendix A stays scoped to Phase 4 for the narrow prompt-bloat motivation; broader coverage is out of scope until measurement justifies it.)

## 10. Alternatives Considered

| Alt | Shape | Main pro | Main con | Decision |
|---|---|---|---|---|
| **A** | Prepend full `AGENTS.md` to every task | no loader change | poor context hygiene; rapid prompt bloat; no task-type routing | Rejected |
| **B** | `AGENTS.md` as entry map + route to local docs on demand | aligns with platform behaviour and `auto-prompts` patterns | requires schema + routing rules; under D2' / candidate C the "loader logic" part is swapped for extension helper + lint/CI, so no platform change is needed | **Selected;** formalised as §8.3 + §8.3.0 matrix; implementation path is candidate C from §6.5 |
| **C** | Skip `AGENTS.md`; jump straight to retrieval / KG systems | powerful long-term retrieval | over-engineered for this phase; duplicates `inlineGraphSubgraph` / `queryKnowledge` / ADR-013 | Rejected for this phase |
| **D** | Attach harness to `composed-lite` first | phased runtime; existing artifacts / audit | §4.8 shows `auto-mode` covers A / B / D already; `composed-lite` would have to reimplement them | Rejected; `composed-lite` gets narrow Appendix A only |
| **E** | Keep full-slurp `AGENTS.md` and "just keep it short" | no platform change | unenforceable under `readFileSync` ancestor walk; silent compounding across home / workspace / repo | **Evolved into v1 via C15 + C1 marker.** The "keep it short" idea becomes enforceable once paired with an opt-in marker and lint/CI automation; that is exactly what candidate C ships. Pure Alt E (no marker, no lint) remains rejected. |
| **F** | Capability-driven pull: loader exposes section **titles + `Use when` lines** only; agent pulls sections via a dedicated tool | composable with existing `memory_query` / `queryKnowledge` style; removes hint-derivation heuristics; agent decides | adds a tool round-trip per task; may under-load when agent misjudges relevance; opens a new tool surface | **Deferred to v2 candidate;** see Appendix C for the candidate tool shape |
| **G** | `agentsFilesOverride` route: render mandatory-only inside the existing app-layer hook instead of modifying `loadProjectContextFiles` | reuses an already-shipped hook; no new loader function | hook is construction-time (not extension-registrable), runs *after* full-file load (so C3/C4 cannot prevent slurp), signature has no diagnostics slot — see §6.5 evidence | **Deferred to v2** per §6.5 selection of candidate C. G remains a viable v2 path if lint-enforcement proves insufficient. |
| **H** | Platform loader-branch (candidate A in §6.5): loader parses v1 marker and emits mandatory-only | loader-level enforcement of C3/C4; no double full-file + optional-section cost | modifies `packages/pi-coding-agent`; cross-package `truncateAtSectionBoundary` ownership; needs new diagnostics surface | **Deferred to v2** per §6.5 selection of candidate C. Natural upgrade once real usage data confirms loader enforcement is needed. |

## 11. Major Risks and Failure Modes

### Risk 1: `AGENTS.md` becomes a universal prompt blob

If L0 sections grow unchecked, §8.3 collapses back into pure Alternative E (full-slurp with no discipline).

**Mitigation (v3.5 / candidate C).** C3 / C15 enforce hard character caps via lint / CI (not loader). CI must reject cap-breaking commits; pre-commit hook recommended but not mandatory. **Residual risk:** lint is author-facing, not consumer-facing — a user repo that skips wiring the lint gets no protection. This is the explicit trade of candidate C; it is acceptable because adoption is opt-in via C1 and the user is the author. If this residual risk ever materialises (e.g. observed prompt bloat in a real opted-in repo), v2 candidate A (loader truncation) is the designed upgrade path.

### Risk 2: Routing logic becomes brittle or opaque

This includes wrong `taskTypeHint` derivation, overly clever routing, and sparse rules that fail to explain when a section applies.

**Mitigation:** Keep routing shallow, require `Use when` clauses, treat hint derivation as a deterministic pure function, and emit per-load diagnostics `(taskTypeHint, sections loaded, bytes, truncations)`. On ambiguity or miss, fall back to L0 mandatory sections only.

### Risk 3: Migration and filename precedence surprise existing projects

A project with an existing `CLAUDE.md` can silently change behavior by adding a sibling `AGENTS.md`, because `resource-loader.ts` uses first-match precedence per directory. Likewise, subfolder L1 files named `AGENTS.md` / `CLAUDE.md` get ancestor-slurped and defeat layer separation.

**Mitigation:** Keep v1 opt-in via marker, document the precedence rule explicitly, forbid `AGENTS.md` / `CLAUDE.md` as L1 names, and add lint / CI checks that flag sibling collisions and invalid L1 filenames.

### Risk 4: Section-aware loading breaks the `getAgentsFiles()` contract — **not applicable under v3.5 / D2'**

Under candidate C the platform is not modified at all (C13 strengthened). `getAgentsFiles()` signature, return shape, and content are byte-identical to pre-v1. The risk is retired at the v1 contract level. If v2 revisits candidate A or B, Risk 4 must be re-evaluated against the chosen diagnostics-channel option.

### Risk 5: Routing rules drift stale or point at missing files

Because `AGENTS.md` is human-authored, Routing Rules can outlive the files they reference.

**Mitigation:** Add CI validation that every referenced L1 path exists and that every rule still conforms to the schema. Treat stale pointers as documentation failures, not harmless noise.

### Risk 6: No agent-side feedback channel for wrong `taskTypeHint`

The loader delivers sections based on a deterministic hint (C9). If a `testing`-typed hint actually lands on a "flaky-test debug" task where the needed L1 is `debugging.md`, the agent has no signal-back mechanism — it silently proceeds with the wrong routing, and the mismatch is only visible in post-hoc review.

**Mitigation:** v1 emits a structured diagnostic `(hint, sections-loaded, sections-skipped, truncations)` with every load. Require `extract-learnings` / postmortem passes to inspect this diagnostic alongside the task result so persistent mismatches become `gotcha` memories. Deferred: any in-task feedback tool is an explicit v2 candidate (Appendix C).

**Why a `capture_thought`-based in-task mismatch report is not promoted to v1.** During review response it was suggested that agents could flag routing mismatches via a `capture_thought` entry with `category: gotcha, subtype: routing-mismatch`, on the grounds that the tool already exists so the cost is zero. That reading under-counts three real costs: (a) `capture_thought` writes durable memory per ADR-013, and routing mismatches are frequently local, transient, trial-and-error noise that would pollute the canonical store; (b) it requires defining a new `structuredFields` shape and dedup / confidence semantics, none of which are free; (c) agents need prompt-level guidance on when to use it versus ignoring a wrong hint silently, which is another authored surface. v1 therefore sticks with loader-emitted diagnostics and batch review in `extract-learnings`; an explicit agent-side mismatch tool remains Appendix C (C-imp.5) and is v2 territory.

### Risk 7: Ancestor-chain cap exceeded through per-file cap alone

A 3-level ancestor chain (`~/.gsd/agent/AGENTS.md`, workspace `AGENTS.md`, repo-root `AGENTS.md`) each at the per-file cap (C3 = 4000 chars whole-file) delivers 12000 chars of preamble — potentially 3× the per-repo intended budget.

**Mitigation (v3.5).** C4's **cross-chain** cap is enforced by the same lint / CI job as C3 per C15. Because the loader is not modified in v1, there is no ingestion-time truncation; lint flags the combined ancestor total at author / CI time. §13 Step 0 measures real-world chain depth before the numeric TBDs are locked. **Residual risk:** ancestor chains that span multiple repos (e.g. user's global `~/.gsd/agent/AGENTS.md` + repo A + repo B open in the same session) cannot be lint-checked across repo boundaries; this is a genuine gap that only candidate A (loader truncation) can close. Acceptable for v1 because cross-repo ancestor chains are uncommon and detectable via Step 0 measurement.

### Risk 8: Migrating to v1 silently shadows `CLAUDE.md`

When a project whose only file is `CLAUDE.md` adds a sibling `AGENTS.md` with the v1 marker, the first-match rule in `resource-loader.ts:57-71` causes the new `AGENTS.md` to win and the original `CLAUDE.md` to be silently dropped. Users may not realise their `CLAUDE.md` guidance has stopped taking effect.

**Mitigation:** C11 keeps legacy files byte-identical, but migration must be explicit: tooling should emit a prominent warning when it detects both files in the same directory where `AGENTS.md` is new, and documentation should require migrators to move `CLAUDE.md` content into `AGENTS.md` before adding the marker (CI check belongs against this migration guide).

### Risk 9: `executor_extension` contract is asymmetric across workflow-plugin formats — **mitigated by §6.4 D1**

Posture (b) closes this. Current state (preserved for audit): field read at `workflow-plugins.ts:161` (md) and `:285` (registry), **not** at `:166` (yaml); four dispatch sites carry duplicated `if (… === "composed-lite")` blocks (Appendix E.2). Migration PR consolidates to `executorExtensionRegistry` + teaches YAML loader to propagate `executor_extension` + has `composed-lite/index.ts` self-register. After migration, adding runtime-owned workflows requires no host edits.

## 12. Open Questions for Further Review

All high-priority questions are closed by §6.4. Remaining open items listed here are explicitly **v2-or-later candidates**, not v1 blockers. The §4.8 evidence pass and §6.4 decision pass closed items are summarised in Appendix D; see the full trail there.

| # | Topic | v1 status | Deferred item (if any) |
|---|---|---|---|
| **12.1** | `AGENTS.md` v1 schema (marker / invariants shape / char-vs-token / scaling) | CLOSED by D4 (marker `<!-- docs-map: v1 -->`, bullet-only invariants, fixed char cap) | — |
| **12.2** | `taskTypeHint` computation | CLOSED by D3 (extension-private; title + `Files[]` + phase-anchor fallback; single hint) | `skills_used` as 4th input → v2 |
| **12.3** | First L1 population | CLOSED by D5 (`.gsd/docs-map/testing.md`; `.gsd/docs-map/<area>.md` default, `docs/<area>/` optional) | — |
| **12.4** | `capture_thought` → Routing-Rule promotion | CLOSED by D6 (batch in `extract-learnings`; `.gsd/proposals/` on disk) | Repetition / confidence threshold (human-gated; tunable without contract change) |
| **12.5** | Platform ownership boundary | CLOSED by D2' (platform → **unchanged**; extension → both schema parse and optional-section routing via `loadAgentsSection`; agent → L1 via `read_file`) | Upstreaming `loadAgentsSection` or adding loader-side rendering → v2 (candidate A) |
| **12.6** | v1 implementation ownership (A vs B vs C) | CLOSED by §6.5 (candidate C selected); A and B deferred to v2 | Step A narrowed to `--bare` wording + golden-test shape |

## 13. Next Steps and Final Recommendation

Recommended direction stays the same as the v2 draft: **`auto-mode` is the harness host; this document's single deliverable is §8.3 + the v1 contract matrix in §8.3.0.** Parts A / B / D are not new design (covered by `gsd_plan_slice`, `auto-prompts` + `context-budget` + `graph-context`, and ADR-013); `composed-lite` receives only the optional Appendix A adoption to prevent divergence; knowledge compounding stays in the ADR-013 pipeline.

Step sequence under v3.5 / candidate C (serial -1 → A → 0 → 1 → 2-5):

-1. **(Migration prerequisite, serial head) Execute posture (b) per §6.4 D1.** Migration PR from `feat/composed-lite-runtime-owned` to `main` consolidates four dispatch special-cases into `executorExtensionRegistry`, teaches `loadYamlPlugin` to propagate `executor_extension`, aligns template metadata with that contract, and has `composed-lite/index.ts` self-register. Independently verified as of 2026-04-23: `main` has 0 files under `composed-lite/`, `HEAD` has 30; total `main...HEAD` diff is 41 files / +5865 / -42; `packages/pi-coding-agent/` is **untouched** in the diff. Posture (b) adds a small host-contract surface (4 files / ~141 insertions today) and keeps the `packages/pi-coding-agent` zero-change property. Do not bundle §8.3 work into this PR.
A. **(Architectural spike, non-coding; narrow under candidate C)** After Step -1 merges, produce a ≤ 50-line addendum that locks three small items: (i) `--bare` wording for C14 (recommended: "v1 marker behaviour does not activate under `--bare`"); (ii) golden-test shape for the §8.3.4.e ancestor-walk mirror (test harness, expected equivalence class); (iii) sanity check that a GSD-extension-hosted lint rule covers C3 / C4 without a platform change. **Scope guard:** must not reopen D1 / D2' / D3 / D4 / D5 / D6 / §6.5 candidate-C selection.
0. **Measure the current ancestor-walk footprint.** Sample `AGENTS.md` / `CLAUDE.md` usage across `gsd-2` and one or two representative repos so C3 / C4 numbers are chosen by evidence, not by guesswork. Under candidate C this measurement is used to calibrate the **lint/CI** thresholds, not loader truncation thresholds.
1. **Freeze the contract matrix (§8.3.0).** Resolve TBD numbers in C3 / C4 from Step 0 measurement. Fold Step A's `--bare` wording into C14 as the canonical text. After this step, implementation PRs may begin.
2. **Paper walkthrough as contract stress-test.** Take 5 real recent `execute-task` prompts and walk them by hand through the `loadAgentsSection(hint)` helper. Goal: surface any C1–C15 contract that breaks under real inputs (e.g., C10 canonicalisation ambiguity, C6 L0-optional-vs-L1 split calls). If 2+ of 5 break, the matrix regresses before drafting starts.
3. **Prototype `loadAgentsSection` offline** against hand-authored `AGENTS.md` content. Under candidate C this is a single prototype (the helper itself + the §8.3.4.e golden test), not two. Read-only; extension-internal; no platform commits.
4. **Draft the first `AGENTS.md` v1 for this repo** against §8.3.2 — four mandatory L0 sections + one Routing Rule pointing at `testing.md` (per §6.4 D5). Include the `<!-- docs-map: v1 -->` marker on line 1.
5. **Draft `.gsd/docs-map/testing.md`** (per §6.4 D5) and verify its Routing Rule resolves cleanly under C7 / C8 by running the Step-3 prototype against it.

**Already closed by prior decisions:** Step 0.5 (`taskTypeHint` data-flow gap) closed by §6.4 D2'; Step 6 (ownership-boundary decision) closed by §6.4 D2' / §6.5.

Closed tracks (no follow-up): "new task contract", "parallel docs-feedback subsystem", "composed-lite as harness host", "taskTypeHint in platform loader", "upstream-routed loading in v1". See Appendix D for the full reversal trail.

In one line: `gsd-2`'s `auto-mode` is already a harness. This document's contribution is formalising the one surface — `AGENTS.md` — that existing harness machinery cannot reach, consolidating the routing-table pattern from `agent-knowledge-index.md` and the section-aware loader from `pi-context-optimization-opportunities.md §5` into one v1 contract matrix.

## Appendix A — `composed-lite` Adoption Follow-up (Optional)

This appendix is a **small, optional** track to keep `composed-lite` from diverging from `auto-mode`'s context-engineering conventions. It is **not** part of the §8.3 core proposal and carries **no implementation commitment** at this time.

### A.0 When to consider Appendix A

Appendix A is a dormant track. It becomes worth scheduling only when at least one of the following observable conditions holds; until then, do not open engineering work against it:

- `composed-lite` Phase 4 worker prompts show a consistently high size footprint or prompt-bloat complaints in review data.
- Visible drift emerges between `composed-lite` and `auto-mode` in how per-task context is built (e.g. different keyword-filter behaviours, different carry-forward truncation semantics), causing cross-workflow user confusion.
- A separate initiative intends to reuse `composed-lite` as a substrate for additional agents and needs the shared primitives for that purpose.

Precise thresholds (e.g. p95 prompt size) are **not** defined here; defining them requires measurement comparable to §13 Step 0 for `auto-mode` (the footprint-measurement step). No Appendix A work should begin without such measurement.

### A.1 Motivation

Evidence (§4.2, §4.8): `composed-lite`'s Phase 4 worker prompt is built as a hand-rolled string that includes the full `state.requirement`, full review feedback, and full previous-round summary, with no budget control. `auto-mode` solved this with `context-budget.ts` / `truncateAtSectionBoundary`. `composed-lite` could adopt the three narrow primitives without ingesting the rest of `auto-mode`'s dependency chain.

### A.2 Minimal primitive set to adopt

Three imports, no DB or gate / preferences / escalation dependencies required:

- `computeBudgets` and `truncateAtSectionBoundary` from `src/resources/extensions/gsd/context-budget.ts`.
- `inlineGraphSubgraph` from `src/resources/extensions/gsd/graph-context.ts` (graceful fallback when no `.gsd/graphs/graph.json` exists).
- `queryKnowledge(content, keywords)` pure function from `src/resources/extensions/gsd/context-store.ts:225`.

### A.3 Proposed change shape

Replace the hand-rolled task string construction in `p4-implementation.ts:235-250` with a small helper `buildStepPrompt(step, state, req)` that:

1. Computes a budget using `computeBudgets` from a session-context-window fallback.
2. Assembles sections (`title`, `files`, `acceptance`, `context_requirement`, `failure`, `review`, `summary`) and emits them as distinct `## ` sections rather than inline string concatenation.
3. Applies `truncateAtSectionBoundary` per section with a per-section cap.
4. Optionally calls `inlineGraphSubgraph(projectRoot, step.title, { budget: 2000 })` for dependency hints.
5. Optionally calls `queryKnowledge(knowledgeMdContent, extractKeywords(step.title))` when `.gsd/KNOWLEDGE.md` is present.

### A.4 What this does NOT do

- Does not introduce milestone/slice/task three-level decomposition into `composed-lite`.
- Does not adopt `buildExecuteTaskPrompt` directly (too many transitive dependencies).
- Does not add escalation, gates, preferences, or DB access.
- Does not change `composed-lite` phase contracts, artifacts, fuse rules, or audit chain.

### A.5 Risk

Low. The three primitives are all pure functions (or graceful-fallback when their underlying files do not exist). No existing `composed-lite` run should behave worse; most runs should experience less prompt bloat.

## Appendix B — Auto-mode Harness Coverage Evidence Map

This appendix keeps the detailed evidence table in one place. §4.8 is the summary judgment; this appendix is the audit lookup table.

| Part | Concern | File / Location | Mechanism |
|---|---|---|---|
| A | Three-level task model | `src/resources/extensions/gsd/paths.ts` | `.gsd/<mid>/<sid>/tasks/<tid>-*.md` |
| A | Sketch-and-refine | `src/resources/extensions/gsd/prompts/refine-slice.md` | ADR-011 Phase 1 landed |
| A | Task plan code validator | `src/resources/extensions/gsd/tests/plan-quality-validator.test.ts` | 32 assertions vs `gsd_plan_slice` |
| A | Executor context constraint | `src/resources/extensions/gsd/auto-prompts.ts` `formatExecutorConstraints` | Task-count range + per-task char budget |
| B | Budget engine | `src/resources/extensions/gsd/context-budget.ts` | `computeBudgets`, `MAX_PREAMBLE_CHARS`, `inlineContextBudgetChars`, `verificationBudgetChars` |
| B | Section-boundary truncation | `src/resources/extensions/gsd/context-budget.ts` | `truncateAtSectionBoundary` |
| B | Dependency carry-forward | `src/resources/extensions/gsd/auto-prompts.ts:801` | `buildCarryForwardSection` |
| B | Resume section | `src/resources/extensions/gsd/auto-prompts.ts:770` | `buildResumeSection` |
| B | Skill activation | `src/resources/extensions/gsd/auto-prompts.ts:654` | `buildSkillActivationBlock` |
| B | Phase anchor | `src/resources/extensions/gsd/phase-anchor.ts` | `readPhaseAnchor`, `formatAnchorForPrompt` |
| B | Knowledge subgraph | `src/resources/extensions/gsd/graph-context.ts:159` | `inlineGraphSubgraph` called in three prompt builders (research/plan/execute) |
| B | Keyword-scoped knowledge | `src/resources/extensions/gsd/context-store.ts:225` | `queryKnowledge(content, keywords)` |
| B | RUNTIME.md inline | `src/resources/extensions/gsd/paths.ts:403` + `auto-prompts.ts:1559-1563` | `resolveRuntimeFile` + `inlineFile` |
| C | Routing-table pattern prior art | `docs/dev/agent-knowledge-index.md` | "Machine-operational routing table for pi docs" |
| C | Section-aware loading prior art | `docs/dev/pi-context-optimization-opportunities.md §5` | "Section-aware loading — parse `## ` headings" |
| C | AGENTS.md ingestion (defect) | `packages/pi-coding-agent/src/core/resource-loader.ts:57-112` | Full-file ancestor walk, no filter |
| C | `.gsd/*.md` named registry | `src/resources/extensions/gsd/paths.ts:259-268` | `GSD_ROOT_FILES` has 8 named files; `RUNTIME.md` is resolved separately via `resolveRuntimeFile()` |
| D | Memories table | ADR-013 | Steps 1–4 landed; canonical knowledge store |
| D | `capture_thought` / `memory_query` | `src/resources/extensions/gsd/prompts/execute-task.md:35, 85-86` | Agent-callable tools |
| D | Auto-injection | `src/resources/extensions/gsd/bootstrap/system-context.ts:147, 246` | `loadMemoryBlock` on `before_agent_start` |
| D | "Propose, don't mutate" rule | `src/resources/extensions/gsd/prompts/execute-task.md:86` | Explicit ban on direct KNOWLEDGE.md / DECISIONS.md appends |
| D | Extract-learnings flow | `src/resources/extensions/gsd/commands-extract-learnings.ts` | Milestone-close extraction into memories |

## Appendix B.1 — `composed-lite` Baseline File Citations (summary of merged §4.1)

Kept here for audit continuity. Grouped by concern; not exhaustive.

- **Platform & extension plumbing** — `package.json`, `src/cli.ts`, `packages/pi-coding-agent/src/core/sdk.ts`, `packages/pi-coding-agent/src/core/extensions/index.ts`, `src/resources/extensions/gsd/index.ts`, `src/resources/extensions/gsd/commands-workflow-templates.ts`, `src/resources/extensions/gsd/commands/handlers/workflow.ts`, `src/resources/extensions/gsd/workflow-plugins.ts`, `src/resources/extensions/gsd/workflow-templates.ts`, `src/resources/extensions/gsd/workflow-templates/registry.json`, `src/resources/extensions/gsd/workflow-templates/composed-lite.md`.
- **Composed-lite governance skeleton** — `composed-lite/{index,runner,types,state,artifacts,audit-log,run-lock,review-harness,review-model-picker,verification-runner}.ts`, plus `composed-lite/phases/p0-admission.ts` through `p7-postmortem.ts`.
- **Task decomposition baseline** — `composed-lite/phases/p3-split.ts`, `p4-implementation.ts`.

## Appendix C — Deferred Implementation Options

Items that came up during design / review but are intentionally **not** part of v1. They are recorded here so they can be picked up later without rediscovery, and so prose in the main document does not inflate with candidate-implementation detail.

### C-imp.1 Hint-derivation helper

A single pure function, tentatively `deriveTaskTypeHint(task) → string | null`, centralising the logic covered by C9 / C10. Exact naming and helper input shape are not frozen, but in v1 the helper remains extension-private per D3 / §12.2; any upstream move into `pi-coding-agent` is a v2 contract decision.

### C-imp.2 Tool-based section pull (Alternative F follow-up)

A candidate tool `load_agents_section(name)` that lets the agent fetch an `AGENTS.md` optional section on demand, making Alternative F usable without hint derivation. Open items: whether to count its output against preamble or task budget; whether the tool should support L1 paths too (collapsing C8's `read_file` fallback into the same surface).

### C-imp.3 Memory-to-Routing-Rule promotion surface

Per §6.4 D6, v1 selects the batch path inside `extract-learnings`. The alternative shapes remain recorded here for future reference:

- **Per-thought flag** on `capture_thought`: `propose_for_agents_md: true`, added to an explicit review queue.
- **Batch inside `extract-learnings`**: milestone-close scan produces both `KNOWLEDGE.md` projection patches and `AGENTS.md` Routing-Rule proposals.

`extract-learnings`-based promotion is coarser-grained but has a natural review window; per-thought is faster but noisier. D6 closes the v1 choice; Appendix C keeps both shapes only so v2 does not need to rediscover the trade-off.

### C-imp.4 L1 keyword-scoped subsection extraction (v2)

The `queryKnowledge(content, keywords)` primitive in `context-store.ts:225` can be extended to L1 files for keyword-scoped subsection extraction, replacing C8's "read the whole L1 on demand" with "read only matching subsections". Deferred because it requires a parser change for L1 files and a new contract beyond C8.

### C-imp.5 Agent-side hint-mismatch feedback

A `report_routing_mismatch(hint, reason)` tool or structured `capture_thought` template that lets the agent flag when a routing hint selected the wrong section. Closes the feedback-loop gap called out in Risk 6. Intentionally not in v1; diagnostics-only in the loader is the v1 answer.

### C-imp.6 Invariants expressed as `memories`

Long-term direction where `## Invariants` in `AGENTS.md` is the read-only projection of `convention` / `gotcha` memories flagged as "project-wide invariant", via `loadMemoryBlock`. Removes double-maintenance between memory store and static invariant list, but couples §8.3 to ADR-013 far more tightly than v1 contemplates.

## Appendix D — Change Log

Kept for traceability so future revisions do not keep accumulating "(revised)" traces in the main prose. Each entry is capped at what a future implementer needs: *what semantic thing shifted and why*. Procedural notes ("slim-down not applied to X") and reviewer-private audit trails have been dropped from entries older than 12 weeks.

| Version | Date | Summary |
|---|---|---|
| **v3.5** | 2026-04-23 | **Candidate C selected; platform-zero-change consolidation.** §6.5 downgrades candidates A and B to v2-deferred; D2 becomes D2' and locks "extension-only rendering, loader unchanged." New C14 (`--bare` contract) and C15 (lint/CI cap enforcement) added; C13 strengthened from "no new return shape" to "no platform change at all." §8.3.4 simplified: §8.3.4.a is now a single sentence of "no platform change"; §8.3.4.e keeps only (iii) ancestor-walk drift guard (the two other sub-items disappear because platform is not modified). §10 Alt table extended: Alt E now records "evolved into v1 via C15+C1 marker"; Alt G / new Alt H both deferred to v2. Risk 1 / 4 / 7 mitigations rewritten under candidate C. §13 linearised to serial `-1 → A → 0 → 1 → 2-5`; Step A narrowed to ≤50 lines (`--bare` wording, golden-test shape, lint sanity check). Appendix E.1 independently re-verified via `git diff main...HEAD`; records the new finding that `packages/pi-coding-agent/` is untouched by the feat branch, aligning with candidate C's intent. No D1 / D3 / D4 / D5 / D6 changes; §6.2 / §8.3.2 / §8.3.5 language adjusted where D2' shifts the enforcement model. |
| **v3.4** | 2026-04-23 | **Evidence-corrected review-response.** External review proposed routing v1 via `agentsFilesOverride` as "platform zero change"; code inspection of `main.ts:417-433` and `resource-loader.ts:450-452` shows the hook is construction-time, post-read, and has no diagnostics slot — claim downgraded to a Spike candidate in new §6.5 and §13 Step A. New §8.3.4.e surfaces three previously-implicit v1 blockers: cross-package ownership of `truncateAtSectionBoundary`, diagnostics channel ownership, and `loadAgentsSection` loader-semantics mirror list. §9 corrected to cover all five `composed-lite` `spawn` sites (p1-p4 + review-harness), not just Phase 4. Risk 6 gains an explicit "why not promoted to v1" paragraph (ADR-013 noise / taxonomy / prompt-surface costs). §12 collapsed from 5 CLOSED sub-sections to a single table + one new open 12.6. §10 gains Alternative G (override route, Deferred). No D1-D6 changes. |
| **v3.3** | 2026-04-23 | §9 / §13 / Appendix E synced to D2 / D6; C2 cross-reference fix; C13 added (no new platform return shape); §8.3.2 caps re-marked *TBD pending §13 Step 0*; responsibility-boundary / minimal-change tables added; §4.11 slimmed to evidence anchor; §13 reordered so measurement precedes freezing; false-precision migration file counts removed. |
| **v3.2** | 2026-04-23 | Architecture decisions locked: new §6.4 table with D1–D6. D1 picks migration posture (b) stabilise-first. D2 picks dual-path ingestion. D3 locks hint derivation as extension-private pure function. D4 locks v1 schema. D5 picks `.gsd/docs-map/testing.md` as first L1. D6 picks batch promotion via `extract-learnings`. §12.1–§12.5 all closed by the corresponding Dx. Remaining open: C3 / C4 numeric values (gated on §13 Step 0), promotion threshold, `skills_used` as 4th hint input. |
| **v3.1** | 2026-04-22 | Reviewer audit against `main` + feat branch. Unified char/token unit in §8.3.2 / Risk 1 / §12.1 (characters per C3/C4). Added §4.11 (system-prompt vs task-prompt path divergence), Risk 9 (`executor_extension` asymmetry), Appendix E (migration boundary with 2D framing). §8.3.4 rewritten as three architecture candidates pending later decision; §9 `composed-lite (brief)` tightened to reflect no hint propagation across `spawn()`. §13 gained Step −1 (migration posture) and Step 0.5 (hint→loader data-flow) as blocking prerequisites. |
| **v3** | 2026-04-22 | Renamed subject to *Auto-mode Harness — AGENTS.md Progressive Docs-map Proposal* (filename kept for git history). Added §8.3.0 Contract Matrix (C1–C12). Merged §4.1–§4.7 into §4.1 / §4.2 + Appendix B.1. Collapsed §7.1–§7.6 into §6.1–§6.3. §10 converted to table; added Alternative F (capability-driven pull, deferred). Added Risks 6 / 7 / 8. Extracted candidate implementations to Appendix C. Renamed "L2" to `memories` throughout. |
| **v2** | 2026-04-22 | **Evidence-driven scope reversal.** Host reversed from `composed-lite` to `auto-mode` based on the §4.8 evidence table. §8.1 / §8.2 / §8.4 downgraded to acknowledgements; §8.3 expanded from stub to full schema-plus-loader design. Alternatives D (composed-lite-first) and E (full-slurp with discipline) added and rejected. |
| **v1** | early 2026-04-22 | Original four-part draft framed around `composed-lite`: (A) new task contract, (B) new context-assembly buckets, (C) progressive `AGENTS.md` docs-map, (D) docs-update feedback loop. Superseded by v2 after codebase evidence showed A / B / D already implemented in `auto-mode`. |

## Appendix E — `composed-lite`-to-`main` Migration Boundary

This appendix is **not** part of the §8.3 design. It exists because the user's stated execution order is *migrate `composed-lite` from `feat/composed-lite-runtime-owned` to `main`, then implement §8.3*, and the migration surface shapes the "extension point" assumptions §8.3 rests on. Treat this as evidence + migration-scope material, not as a design.

**Calibration status (2026-04-23, independently re-verified this revision).** All statements in E.1–E.4 are grounded in direct `git diff main...HEAD` / `git ls-tree` evidence from the current branch. Numbers from the command output:

- `main` contains **0** files under `src/resources/extensions/gsd/composed-lite/**`
- `HEAD` contains **30** files under the same path (all added by the feat branch)
- total `main...HEAD` diff: **41 files changed, +5865 insertions, −42 deletions**
- host-contract files touched by the diff: **4 files / +141 / −1** (`commands-workflow-templates.ts`, `commands/handlers/workflow.ts`, `workflow-plugins.ts`, `workflow-templates.ts`)
- **`packages/pi-coding-agent/` files touched by the diff: 0.** This is a key v3.5 finding: the current migration surface already does not reach into the platform package. Candidate C is designed to preserve this property through the v1 feature set.

### E.1 Dimensional framing (use this instead of "how many files?")

Counting changed files is a poor proxy for upstream / open-source risk. The better axis pair is:

- **Axis A — is this a platform / host contract?** A contract change is any change whose shape is observable by consumers outside the feature (other extensions, interactive mode, external tooling).
- **Axis B — is this feature-private?** Feature-private changes live entirely inside `src/resources/extensions/gsd/composed-lite/**` and have no observable host behaviour.

|  | Feature-private (B high) | Contract-adjacent (A high) |
|---|---|---|
| **Low risk to open-source iteration** | feature-private `composed-lite/**` file set (**current `main...HEAD` diff: 30 added files**) | — |
| **High risk to open-source iteration** | — | dispatcher special-cases; `executor_extension` field coverage; future `resource-loader` contract change for §8.3 |

Statements like "only N files change" are misleading on the bottom-right cell: a single 3-line dispatcher special-case in the host is higher risk than 300 lines added to a feature-private directory.

**Minimal change matrix (migration + v1 design boundary):**

This matrix intentionally mixes two scopes: (a) migration-PR surfaces that Step −1 must settle, and (b) later §8.3 implementation surfaces that remain out of scope for that migration PR. Read it as a boundary map, not as a single-PR checklist.

| Bucket | Surfaces | Scope guard |
|---|---|---|
| **Must change in `main` core** | `packages/pi-coding-agent/src/core/resource-loader.ts`; `src/resources/extensions/gsd/workflow-plugins.ts`; `src/resources/extensions/gsd/workflow-templates.ts`; four runtime-owned dispatch special-cases currently living in workflow handlers / templates | Keep platform loader mandatory-only; do not introduce `taskTypeHint` into platform APIs; do not widen `getAgentsFiles()` return shape |
| **Extension-only** | `auto-prompts.ts`; `deriveTaskTypeHint`; `loadAgentsSection`; repo-authored `AGENTS.md` / `.gsd/docs-map/*.md` content; feature-private `src/resources/extensions/gsd/composed-lite/**` subtree (**current `main...HEAD` diff: 30 added files**) | Reuse existing budget / graph / memory primitives; no new knowledge store; no agent-written `AGENTS.md` |
| **Defer to v2** | Shared parsed-section platform view; tool-based section pull; L1 keyword-scoped extraction; per-thought promotion flag | No impact on the v1 contract matrix |

### E.2 Current state of the four host dispatch special-cases

Confirmed by direct `git diff main...HEAD`, the current branch introduces four host dispatch special-cases:

- `@/Users/l/tencent/gsd-2/src/resources/extensions/gsd/commands/handlers/workflow.ts:156-177` — `dispatchPluginByMode` runtime-owned early-return.
- `@/Users/l/tencent/gsd-2/src/resources/extensions/gsd/commands-workflow-templates.ts:237-260` — `handleStart` runtime-owned **resume** path.
- `@/Users/l/tencent/gsd-2/src/resources/extensions/gsd/commands-workflow-templates.ts:415-436` — `handleStart` runtime-owned **new-run** path.
- `@/Users/l/tencent/gsd-2/src/resources/extensions/gsd/commands-workflow-templates.ts:660-682` — `dispatchMarkdownPhasePlugin` runtime-owned early-return.

Each site contains a near-identical `if (… === "composed-lite") { import("./composed-lite/index.js")… }` block. A second runtime-owned workflow would require editing each site again.

### E.3 Current state of the `executor_extension` field

- Registry loader honours it: `workflow-plugins.ts:285`.
- Markdown plugin loader honours it: `workflow-plugins.ts:161` (via `<template_meta>` block).
- `workflow-templates.ts` extends `TemplateEntry` with `executor_extension?: string`, so template metadata itself participates in the runtime-owned workflow surface.
- **YAML plugin loader does not propagate it:** `workflow-plugins.ts:166-218`. Direct `git diff main...HEAD` confirms that `WorkflowPluginMeta` gained `executorExtension`, markdown / bundled loaders now set it, and YAML loader still does not. Any YAML workflow declaring `executor_extension` will silently fail to trigger runtime-owned dispatch.

The field is therefore **not yet a uniform platform extension point**, regardless of how it is advertised externally.

### E.4 Migration posture — **selected: (b) stabilise-first (§6.4 D1)**

**Posture (a) — "upstream as-is" — rejected.** Would have merged the feat branch with its current shape: 4 dispatcher special-cases, markdown + registry coverage for `executor_extension`, YAML gap documented. Lowest migration cost but carries tech debt that §8.3 would compound against.

**Posture (b) — "stabilise the extension point first" — selected.** The migration PR, in addition to the currently observed **30-file** feature-private `composed-lite/**` file set, will:

1. Consolidate the 4 dispatch special-cases into one `executorExtensionRegistry: Map<string, ExecutorRunner>` lookup. `composed-lite/index.ts` self-registers at load time.
2. Teach `loadYamlPlugin` to propagate `executor_extension` (symmetric coverage across md / yaml / registry loaders).
3. Keep the feature-private file set untouched except for the minimal `register(...)` call in `composed-lite/index.ts`.

Migration cost is expected to be modest relative to the straight port, but exact sizing belongs in migration-PR planning, not this contract document. After this PR lands, adding any subsequent runtime-owned workflow requires no host-file edits — the extension point is real.

This posture is locked by §6.4 D1. Risk 9 mitigation is promoted from "open" to "decided."

### E.5 Explicit scope guardrails

- Appendix E does **not** redesign `composed-lite` phases, artifacts, fuse rules, or audit chain.
- Appendix E does **not** require any of the §8.3 work. §8.3 can be deferred independently of the migration.
- Conversely, §8.3 does not require the registry refactor in posture (b). It only requires that §13 Step −1 records which posture won, so §8.3 does not accidentally cement the wrong extension-point shape.
