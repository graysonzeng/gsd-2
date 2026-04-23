# PR-4 AGENTS.md Docs-Map v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add extension-side `AGENTS.md` docs-map v1 support so auto-mode prompt builders can attach compact L0 context and optional L1 docs-map content based on a deterministic `taskTypeHint`, without modifying the platform `resource-loader`.

**Architecture:** All docs-map logic lives under the GSD extension. A new loader parses v1 markers / mandatory sections / routing rules / optional task-type blocks, prompt builders call it at the approved attachment points, and a dedicated lint/check step enforces the v1 caps. The platform loader remains untouched, preserving the existing per-directory first-match order `AGENTS.md` then `CLAUDE.md` and ancestor-walk behaviour byte-for-byte. In other words, PR-4 **augments** the existing platform loader with extension-side task-prompt attachments; it does not replace or fork the platform ancestor-walk contract.

**Tech Stack:** TypeScript, `src/resources/extensions/gsd/auto-prompts.ts`, extension-side helper modules, Node test runner, CI workflow wiring.

---

## Post-review disposition (2026-04-23)

External review in `docs/superpowers/plans/2026-04-23-pr-4-agents-md-docs-map-v1-review.md` is technically sound overall and should be adopted selectively rather than wholesale.

Accepted for the current implementation round:

- `R1` — deduplicate docs-map bare resolution into one shared helper and reuse it from both `auto-prompts.ts` and `commands-extract-learnings.ts`
- `R2` — add a repository ceiling (`.git` / `.gsd`) to ancestor walking and reject Routing Rule L1 paths that escape the owning `AGENTS.md` directory
- `R3` — add runtime defense-in-depth caps with warnings so oversized docs-map content degrades safely before CI lint catches it

Explicitly deferred to v1.1 / backlog unless new evidence appears during implementation:

- `R4` — parsed docs-map cache keyed by file path + mtime
- `R5` — migrate loader internals from sync fs I/O to `fs/promises`
- `R6` — remove or redesign the hardcoded `testing` / `frontend` fallback policy in `deriveTaskTypeHint(...)`

This means the plan below remains directionally correct, but Task 1 / Task 2 / Task 3 must absorb the review-driven hardening work instead of shipping the first-pass implementation unchanged.

---

## Locked scope

### Files that must change

- Create: `src/resources/extensions/gsd/agents-md-loader.ts`
- Create: `src/resources/extensions/gsd/agents-md-lint.ts`
- Modify: `src/resources/extensions/gsd/auto-prompts.ts` (`buildPlanMilestonePrompt`, shared `renderSlicePrompt`, `buildExecuteTaskPrompt`, `buildCompleteSlicePrompt`, `buildCompleteMilestonePrompt`)
- Modify: `src/resources/extensions/gsd/commands-extract-learnings.ts`
- Modify: `src/resources/extensions/gsd/prompts/execute-task.md`
- Create: `src/resources/extensions/gsd/tests/agents-md-loader.test.ts`
- Create: `src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts`
- Create: `src/resources/extensions/gsd/tests/agents-md-lint.test.ts`
- Create: `scripts/check-agents-docs-map.mts`
- Modify: `.github/workflows/ci.yml:83-118`
- Create: `tests/fixtures/agents-docs-map/project-root/AGENTS.md`
- Create: `tests/fixtures/agents-docs-map/project-root/.docs-map/testing.md`
- Create: `tests/fixtures/agents-docs-map/project-root/.docs-map/frontend.md`
- Create: `tests/fixtures/agents-docs-map/markerless-root/AGENTS.md`
- Create: `tests/fixtures/agents-docs-map/ancestor-chain/root/AGENTS.md`
- Create: `tests/fixtures/agents-docs-map/ancestor-chain/root/workspace/project/AGENTS.md`
- Create: `tests/fixtures/agents-docs-map/mixed-chain/root/AGENTS.md`
- Create: `tests/fixtures/agents-docs-map/mixed-chain/root/workspace/project/AGENTS.md`

### Files that must stay unchanged

- Do **not** modify `packages/pi-coding-agent/src/core/resource-loader.ts`
- Do **not** modify `packages/pi-coding-agent/src/main.ts` or CLI `--bare` parsing; extension code may only consume the existing runtime flag
- Do **not** add `bare` to persisted `GSDPreferences` or preference files
- Do **not** add any tracked repo-root `.gsd/` directory
- Do **not** add a tracked repo-root `AGENTS.md`

### Reality corrections that must be respected

I followed two planning memories created during this session:

- `**PR-4 docs-map spec conflicts with repo ban on committed .gsd directory**`
- `**PR-4 docs-map plan must account for AGENTS.md also being gitignored in repo root**`

Concretely, current repo policy makes two spec bullets non-executable as written:

1. Spec §8 says to add `.gsd/docs-map/testing.md` to the repo
2. Spec §8 says to convert the repo's own `AGENTS.md` to v1

Current repo state contradicts both:

- `.gitignore` ignores `.gsd/`
- `.github/workflows/ci.yml` fails if a `.gsd/` directory exists in checkout
- `.gitignore` also ignores root `AGENTS.md`
- There is no tracked root `AGENTS.md` or `CLAUDE.md`

Therefore PR-4 v1 in **this repository** must ship as:

- extension code
- fixture-based docs-map examples under `tests/fixtures/agents-docs-map/`
- CI lint gate wired to fixture + repo scans
- a deferred policy gate for repo-root adoption

Reviewer-boundary rule that must stay true while implementing PR-4 and PR-3b in parallel:

- reviewer subagents still inherit platform-level `AGENTS.md` / `CLAUDE.md` context via the normal loader at subprocess start
- reviewer subagents must **not** automatically inherit an extension-built `## AGENTS.md Context` task block unless a caller explicitly re-attaches it for that subprocess

Additional code-reality note confirmed during plan review:

- `buildExecuteTaskPrompt(...)` does **not** currently use the shared `{{inlinedContext}}` path. It assembles multiple discrete prompt variables, and the builder already computes `inlinedTemplates` without the template consuming it.
- Therefore PR-4 may make **one minimal template change** in `src/resources/extensions/gsd/prompts/execute-task.md` to surface the already-computed `{{inlinedTemplates}}` block (or an equivalent dedicated docs-map slot) rather than forcing docs-map into `taskPlanInline` / `slicePlanExcerpt`.

### Spec alignment gates (must be resolved before Task 1)

- `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md` C11 wording must stay aligned with code reality. The current invariant in `packages/pi-coding-agent/src/core/resource-loader.ts` is byte-identical per-directory first-match `AGENTS.md` then `CLAUDE.md`, and the spec has been corrected to match it.
- C5 syntax must be implementation-safe. v1 fixtures keep the canonical form `- **testing** → .docs-map/testing.md`, while the loader/parser accepts both `**testing**` and `**[testing]**` during the migration window and normalizes the parsed phrase before matching.
- `--bare` must remain extension-local in PR-4. Current call sites into `auto-prompts.ts` do not yet receive a first-class parsed bare flag from the runtime, so the implementation may use a prompt-layer argv fallback bridge **only as a warned last resort** until a future runtime-plumbing change exists.

If a future edit regresses C11 wording away from the real loader invariant, stop before Task 1 and re-align the spec again.

## Pre-flight checks

- **Step 1: Confirm the platform loader is untouched and remains the authority for AGENTS/CLAUDE ancestor walk**

Run:

```bash
node -e 'const fs=require("node:fs"); const p="packages/pi-coding-agent/src/core/resource-loader.ts"; const c=fs.readFileSync(p,"utf8"); console.log(c.includes(`const candidates = ["AGENTS.md", "CLAUDE.md"]`)?"FOUND":"MISSING"); console.log(c.includes("loadProjectContextFiles")?"FOUND":"MISSING");'
```

Expected:

- Both probes print `FOUND`
- This is the hard rule from docs-map spec C11 / C13
- The preserved invariant is **first-match with `AGENTS.md` before `CLAUDE.md`**
- **Step 2: Confirm the repo-policy conflict is real before implementing fixtures**

Run:

```bash
node -e 'const fs=require("node:fs"); console.log(fs.readFileSync(".gitignore","utf8").includes(".gsd/")); console.log(fs.readFileSync(".gitignore","utf8").includes("AGENTS.md")); console.log(fs.readFileSync(".github/workflows/ci.yml","utf8").includes("if [ -d \".gsd\" ]"));'
```

Expected:

- Three `true` values
- This justifies the fixture path and the explicit policy gate
- **Step 3: Confirm `--bare` currently stops at the platform loader and has no docs-map bridge yet**

Run:

```bash
node -e 'const fs=require("node:fs"); const main=fs.readFileSync("packages/pi-coding-agent/src/main.ts","utf8"); const prompts=fs.readFileSync("src/resources/extensions/gsd/auto-prompts.ts","utf8"); console.log(main.includes("agentsFilesOverride")); console.log(prompts.includes("AGENTS.md Context"));'
```

Expected:

- First probe prints `true`
- Second probe prints `false` before implementation, proving PR-4 must add its own extension-side bypass to satisfy C14
- **Step 4: Confirm CI Node runtime already supports `--experimental-strip-types`**

Run:

```bash
node -v
```

Expected:

- CI currently runs Node `24.x` (`.github/workflows/ci.yml`), so the docs-map lint/test commands may continue to use `--experimental-strip-types`

### Task 1: Add failing loader / prompt-attachment / lint tests first

**Files:**

- Create: `src/resources/extensions/gsd/tests/agents-md-loader.test.ts`
- Create: `src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts`
- Create: `src/resources/extensions/gsd/tests/agents-md-lint.test.ts`
- Create fixtures under `tests/fixtures/agents-docs-map/`
- Read for patterns: `src/resources/extensions/gsd/tests/plan-slice-prompt.test.ts:1-220`
- Read for patterns: `src/resources/extensions/gsd/tests/commands-extract-learnings.test.ts:593-654`
- Read for patterns: `packages/pi-coding-agent/src/core/resource-loader-cache-reset.test.ts:1-43`
- **Step 1: Add fixture trees**

Create:

- `tests/fixtures/agents-docs-map/project-root/AGENTS.md` with the v1 marker and relative Routing Rules such as `- **testing** → .docs-map/testing.md`
- matching L1 files under `tests/fixtures/agents-docs-map/project-root/.docs-map/`
- `tests/fixtures/agents-docs-map/markerless-root/AGENTS.md` without the marker for C1 regression coverage
- `tests/fixtures/agents-docs-map/ancestor-chain/root/AGENTS.md` and `tests/fixtures/agents-docs-map/ancestor-chain/root/workspace/project/AGENTS.md` to prove root→leaf L0 aggregation and per-chain cap enforcement
- `tests/fixtures/agents-docs-map/mixed-chain/...` to prove marker-bearing and markerless ancestors can be interleaved without losing root→leaf aggregation for the participating marker files

Fixture rule:

- Use `.docs-map/` in tracked fixtures to respect current repo policy
- Runtime resolution must be **relative to the owning `AGENTS.md` file**, not hardcoded to `.gsd/docs-map/`
- Keep fixtures intentionally small: target `AGENTS.md <= 1500 chars` and each L1 fixture `<= 400 chars`
- **Step 2: Write the failing loader tests**

Cover these cases in `src/resources/extensions/gsd/tests/agents-md-loader.test.ts`:

- marker present → `docs-map-v1` mode with parsed L0
- markerless fixture → returns `null`
- `testing` task metadata loads L0 plus additive testing L1
- malformed Routing Rule syntax → warning + L0-only fallback (R-2)
- `bare=true` → returns `null`
- ancestor-chain fixture aggregates L0 in **root→leaf** order and applies the nearest matching rule if more than one level defines the same phrase
- mixed-chain fixture proves markerless ancestors are skipped while marker-bearing ancestors still participate in root→leaf aggregation
- ancestor walking stops at the nearest repo ceiling sentinel (`.git` / `.gsd`) instead of traversing to filesystem root
- Routing Rule L1 paths that escape the owning directory emit a warning and are ignored
- oversized runtime docs-map content emits warnings and is truncated / clipped instead of entering prompts unbounded
- **Step 3: Write the failing prompt-attachment tests**

Cover these assertions in `src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts`:

- `auto-prompts.ts` imports the docs-map helper and consumes an extension-side runtime bare-bypass helper
- `src/resources/extensions/gsd/prompts/execute-task.md` renders the builder-owned attachment slot (`{{inlinedTemplates}}` or the equivalent dedicated docs-map placeholder) so execute-task has a real injection point
- `buildPlanMilestonePrompt(...)`, the shared `renderSlicePrompt(...)` path, `buildExecuteTaskPrompt(...)`, `buildCompleteSlicePrompt(...)`, and `buildCompleteMilestonePrompt(...)` attach docs-map blocks only at the approved attachment points
- `commands-extract-learnings.ts` attaches L0-only docs-map context to the manual `extract-learnings` path
- `bare=true` suppresses `## AGENTS.md Context`
- markerless fixture produces no extra docs-map block
- marker present + `hint=null` produces `## AGENTS.md Context` without `## Docs-Map Addendum`
- `buildCompleteMilestonePrompt(...)` remains additive and preserves `buildExtractionStepsBlock(...)`
- `buildCompleteMilestonePrompt(...)` contains `## AGENTS.md Context` at most once
- **Step 4: Write the failing lint tests**

Cover these cases in `src/resources/extensions/gsd/tests/agents-md-lint.test.ts`:

- the valid fixture tree passes
- whole-file and optional-section caps enforce C3
- ancestor-chain fixture enforces C4 per chain (not across unrelated roots)
- any L1 entry whose basename is `AGENTS.md` or `CLAUDE.md` fails
- a marker-bearing `AGENTS.md` that coexists with sibling `CLAUDE.md` emits a warning, not an error (R-5)
- **Step 5: Run the new tests and confirm they fail**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/agents-md-loader.test.ts src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts src/resources/extensions/gsd/tests/agents-md-lint.test.ts
```

Expected:

- Exit code non-zero
- Failures mention missing `agents-md-loader.ts` / `agents-md-lint.ts` / prompt attachment wiring
- **Step 6: Commit the failing tests and fixtures**

```bash
git add tests/fixtures/agents-docs-map src/resources/extensions/gsd/tests/agents-md-loader.test.ts src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts src/resources/extensions/gsd/tests/agents-md-lint.test.ts
git commit -m "test: add failing coverage for agents docs-map v1"
```

### Task 2: Implement the extension-side docs-map loader and lint helper

**Files:**

- Create: `src/resources/extensions/gsd/agents-md-loader.ts`
- Create: `src/resources/extensions/gsd/agents-md-lint.ts`
- **Step 1: Implement `deriveTaskTypeHint(...)` as a deterministic pure function**

Use this public shape in `agents-md-loader.ts`:

```ts
export interface TaskTypeHintInput {
  unitType: string;
  title?: string;
  filePaths?: string[];
  routingPhrases?: string[];
}

export function deriveTaskTypeHint(input: TaskTypeHintInput): string | null {
  const phrases = (input.routingPhrases ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const haystack = [input.unitType, input.title ?? "", ...(input.filePaths ?? [])].join("\n").toLowerCase();
  for (const phrase of phrases) {
    if (haystack.includes(phrase)) return phrase;
  }
  const fallbacks = [
    { phrase: "testing", re: /test|spec|assert|vitest|jest|playwright/ },
    { phrase: "frontend", re: /react|tsx|css|tailwind|component|frontend/ },
  ];
  for (const { phrase, re } of fallbacks) {
    if (phrases.includes(phrase) && re.test(haystack)) return phrase;
  }
  return null;
}
```

Constraint:

- Pure function only
- No env reads
- No model calls
- No agent-authored overrides
- Parsed Routing Rule phrases are the primary matching surface; hardcoded aliases are fallback only when that phrase already exists in the file
- **Step 2: Implement `loadAgentsSection(...)`**

Export a loader with this shape:

```ts
export interface LoadAgentsSectionOptions {
  cwd: string;
  unitType: string;
  title?: string;
  filePaths?: string[];
  bare: boolean;
}

export interface LoadAgentsSectionResult {
  mode: "docs-map-v1";
  l0: string;
  l1: string | null;
  matchedRule: string | null;
  warnings: string[];
  sources: string[];
}

export function loadAgentsSection(
  options: LoadAgentsSectionOptions,
): Promise<LoadAgentsSectionResult | null>;
```

Required behaviour:

- `bare=true` → return `null`
- `cwd` is required and never defaulted from `process.cwd()`
- prompt-builder call sites pass the existing `base` / `basePath` as the start directory; the loader itself still walks ancestors upward in the same order as `loadProjectContextFiles()`
- walk ancestors using the same directory order as `loadProjectContextFiles()`
- stop the walk at the nearest repo ceiling sentinel (`.git` or `.gsd`) when one exists; do not continue scanning parent directories beyond that ceiling
- per directory, preserve the platform first-match invariant `AGENTS.md` then `CLAUDE.md`; only marker-bearing `AGENTS.md` files participate in docs-map parsing
- no marker anywhere on the ancestor chain → return `null`
- parse mandatory sections and `Routing Rules`; accept both `- **phrase** → path` and `- **[phrase]** → path`, then normalize the phrase by stripping one optional surrounding bracket pair, trimming, and lowercasing
- concatenate L0 in **root→leaf** order
- resolve L1 paths **relative to the owning `AGENTS.md` file**
- reject any L1 resolution that escapes the owning `AGENTS.md` directory subtree; degrade with warning instead of reading arbitrary filesystem paths
- derive the hint against the parsed phrases; when multiple ancestor levels define the same phrase, the nearest matching rule wins
- malformed rules emit warnings and degrade to L0-only instead of failing dispatch (R-2)
- apply runtime defense-in-depth caps before returning prompt content: oversize marker files / optional sections / combined chain must warn and clip instead of entering prompts unbounded
- v1 uses no process-level docs-map cache; each call re-reads participating files and relies on OS page cache. A future cache must come with explicit invalidation semantics and tests
- never modify or call platform `resource-loader.ts`
- export a shared `resolveDocsMapBare(...)` helper from the loader module so prompt builders and manual `extract-learnings` do not re-implement argv fallback logic differently
- **Step 3: Implement the lint helper in `agents-md-lint.ts`**

Export:

```ts
export interface LintResult {
  errors: string[];
  warnings: string[];
}

export async function lintAgentsDocsMap(input: { roots: string[] }): Promise<LintResult>
export function validateDocsMapEntry(input: { relativePath: string; kind: "agents-md-file" | "optional-section" | "l1-file"; chars: number }): LintResult
```

Enforce:

- marker file total char cap <= 4000
- optional section cap <= 1000
- cumulative chain cap <= 10000 **per walked ancestor chain**
- forbid any L1 entry whose basename is `AGENTS.md` or `CLAUDE.md`
- warn when a marker-bearing `AGENTS.md` coexists with sibling `CLAUDE.md`

Repository adaptation note:

- Runtime resolution is path-relative, not prefix-hardcoded
- Production repos may still choose `.gsd/docs-map/...` in their Routing Rules
- Tracked test fixtures use `.docs-map/...` because this repository forbids committed `.gsd/`

### Task 3: Wire docs-map into prompt builders and CI

**Files:**

- Modify: `src/resources/extensions/gsd/auto-prompts.ts`
- Modify: `src/resources/extensions/gsd/commands-extract-learnings.ts`
- Modify: `src/resources/extensions/gsd/prompts/execute-task.md`
- Create: `scripts/check-agents-docs-map.mts`
- Modify: `.github/workflows/ci.yml`
- Test: `src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts`
- **Step 1: Import the docs-map helper into prompt builders**

Add the loader import(s) to the prompt-building modules that need them:

```ts
import { loadAgentsSection, resolveDocsMapBare } from "./agents-md-loader.js";
```

- **Step 2: Attach docs-map content at the approved prompt builders**

Wire these builders:

- `buildPlanMilestonePrompt(...)` → L0 only
- shared `renderSlicePrompt(...)` path (`plan-slice` / `refine-slice`) → L0 + optional L1 via hint
- `buildExecuteTaskPrompt(...)` → L0 + optional L1 via hint derived from task title + `getTask(mid, sid, tid)?.files ?? []`
- `buildCompleteSlicePrompt(...)` → L0 only
- `buildCompleteMilestonePrompt(...)` → L0 only, additive before or inside `inlinedContext`, without disturbing `extractLearningsSteps`
- manual `buildExtractLearningsPrompt(...)` path in `commands-extract-learnings.ts` → L0 only

Execute-task-specific constraint:

- because `execute-task` does not currently use the shared `inlinedContext` path, attach docs-map there through the builder-owned template slot (`inlinedTemplates` or an equivalent minimal dedicated placeholder), not by mutating `taskPlanInline` or `slicePlanExcerpt`
- if using `inlinedTemplates`, place the docs-map block at the **front** of that block so it stays before knowledge / graph supplements derived in the same builder

Use a helper shaped like:

```ts
interface BuildAgentsDocsMapBlockArgs {
  cwd: string;
  unitType: string;
  title?: string;
  filePaths?: string[];
  bare?: boolean;
}

function resolveDocsMapBareBypass(explicitBare?: boolean): boolean {
  if (typeof explicitBare === "boolean") return explicitBare;
  const argvBare = process.argv.includes("--bare");
  if (argvBare) {
    logWarning("prompt", "docs-map bare flag resolved from argv fallback; prefer explicit runtime plumbing when available");
  }
  return argvBare;
}

async function buildAgentsDocsMapBlock(args: BuildAgentsDocsMapBlockArgs): Promise<string> {
  const loaded = await loadAgentsSection({
    cwd: args.cwd,
    unitType: args.unitType,
    title: args.title,
    filePaths: args.filePaths,
    bare: resolveDocsMapBareBypass(args.bare),
  });
  if (!loaded) return "";
  return [
    "## AGENTS.md Context",
    "",
    loaded.l0,
    loaded.l1 ? `\n## Docs-Map Addendum\n\n${loaded.l1}` : "",
  ].join("\n").trim();
}
```

Constraints:

- additive only
- never replace existing inline context
- `bare` remains an explicit loader option; argv inspection is allowed only inside the shared helper as a fallback bridge, not as a new persisted preference or core CLI contract
- current code reality means some call sites will pass `bare: undefined` in v1; `resolveDocsMapBare(...)` must prefer explicit caller input and only then fall back to argv with a warning callback when one is provided
- do **not** attach docs-map content to `research-slice`
- at `execute-task`, inject `## AGENTS.md Context` before graph / knowledge / memory-derived supplements so the prompt order stays aligned with `docs/superpowers/specs/README.md`
- `buildExtractionStepsBlock(...)` remains docs-map-agnostic; docs-map injection happens only in the outer prompt builders so `complete-milestone` cannot double-inject it
- preserve `buildExtractionStepsBlock(...)` placement in `buildCompleteMilestonePrompt(...)`
- D5 batch Routing-Rule promotion inside `extract-learnings` is **explicitly deferred out of PR-4**; this PR only injects L0 context there and must record the defer in Self-review / handoff
- do **not** wrap the docs-map block itself in `capPreamble(...)`; character ceilings are enforced by docs-map lint (C3/C4), and prompt-layer truncation would risk cutting the addendum header/body boundary mid-block
- **Step 3: Add CI wiring for docs-map lint**

Create `scripts/check-agents-docs-map.mts` and add one extra lint step under the existing `lint` job:

```yaml
      - name: Validate AGENTS docs-map fixtures and caps
        run: node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types scripts/check-agents-docs-map.mts
```

Script rule:

- Do not recurse the whole repository by default in v1
- Future policy-gated adoption may add the repo root later.

```ts
const roots = [
  "tests/fixtures/agents-docs-map",
];
```

- **Step 4: Make the prompt-attachment tests pass**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts src/resources/extensions/gsd/tests/plan-slice-prompt.test.ts src/resources/extensions/gsd/tests/commands-extract-learnings.test.ts
```

Expected:

- Exit code `0`
- docs-map prompt tests pass
- `commands-extract-learnings.test.ts` remains green, proving both manual extract-learnings wiring and complete-milestone additive wiring stayed intact
- prompt tests prove the manual `extract-learnings` path and `complete-milestone` path each inject docs-map at most once
- reviewer non-inheritance of docs-map L0/L1 remains a cross-PR contract owned by PR-3b; PR-4 documents the boundary but does not add a fake reviewer builder here
- **Step 5: Commit prompt + CI wiring**

```bash
git add src/resources/extensions/gsd/auto-prompts.ts src/resources/extensions/gsd/commands-extract-learnings.ts scripts/check-agents-docs-map.mts .github/workflows/ci.yml src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts
git commit -m "feat: wire agents docs-map into auto prompts"
```

### Task 4: Policy gate and final verification

**Files:**

- Verify only: all files above
- Optional doc note: add a short comment block in the plan execution session, not in source, recording that repo-root adoption is deferred by policy
- **Step 1: Verify repo policy remains unchanged**

Run:

```bash
node -e 'const fs=require("node:fs"); const gi=fs.readFileSync(".gitignore","utf8"); const ci=fs.readFileSync(".github/workflows/ci.yml","utf8"); console.log("ignore AGENTS",gi.includes("AGENTS.md")); console.log("ignore .gsd",gi.includes(".gsd/")); console.log("ci bans .gsd",ci.includes("if [ -d \".gsd\" ]"));'
```

Expected:

- The three protections are still in place
- PR-4 ships without weakening repo hygiene
- **Step 2: Run the full focused validation set**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types scripts/check-agents-docs-map.mts && node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/agents-md-loader.test.ts src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts src/resources/extensions/gsd/tests/agents-md-lint.test.ts src/resources/extensions/gsd/tests/plan-slice-prompt.test.ts src/resources/extensions/gsd/tests/commands-extract-learnings.test.ts packages/pi-coding-agent/src/core/resource-loader-cache-reset.test.ts && npm run typecheck:extensions
```

Expected:

- docs-map lint script exits `0`
- All focused docs-map tests pass
- `resource-loader-cache-reset.test.ts` still passes, proving platform loader remained untouched
- Typecheck exits `0`
- **Step 3: Record the deferred repo-adoption gate in the PR description / handoff**

Use this exact note in the implementation session handoff:

```text
PR-4 ships the extension-side docs-map runtime, fixtures, and CI lint gate. Converting this repository's own root AGENTS.md and adding a tracked .gsd/docs-map example remain blocked by current repo policy: root AGENTS.md is gitignored and CI rejects committed .gsd/. A separate policy PR is required for repo-root adoption.

Deferred to v1.1:

- D5 batch Routing-Rule promotion inside extract-learnings
- Replacing the prompt-layer argv fallback with first-class runtime plumbing for the parsed `bare` flag when that context becomes available without widening the core CLI contract
```

- **Step 4: Create the final implementation commit**

```bash
git add src/resources/extensions/gsd/agents-md-loader.ts src/resources/extensions/gsd/agents-md-lint.ts src/resources/extensions/gsd/auto-prompts.ts src/resources/extensions/gsd/commands-extract-learnings.ts scripts/check-agents-docs-map.mts src/resources/extensions/gsd/tests/agents-md-loader.test.ts src/resources/extensions/gsd/tests/agents-md-prompt-attachment.test.ts src/resources/extensions/gsd/tests/agents-md-lint.test.ts tests/fixtures/agents-docs-map .github/workflows/ci.yml
git commit -m "feat: add agents docs-map v1"
```

## Self-review

### Spec coverage

- Implements extension-only loader per C11 / C13 while preserving the exact platform first-match invariant `AGENTS.md` → `CLAUDE.md`
- Adds deterministic `deriveTaskTypeHint(..., routingPhrases)` per C5 / C9 / C10 without hardcoding v1 to exactly two hints and keeps the match surface anchored to parsed Routing Rules
- Wires the approved prompt attachment points, including the manual `extract-learnings` L0 path, while leaving `research-slice` untouched
- Adds lint / CI enforcement for C3 / C4 / C12 / C15, including per-chain accumulation and CLAUDE coexistence warning coverage
- Preserves additive semantics, resolves L1 paths relative to the owning `AGENTS.md`, keeps `cwd` explicit, and uses `.docs-map/` only as a tracked-fixture adaptation
- Replaces impossible repo-root adoption steps with explicit fixture-driven coverage plus a policy gate

### Deferred / spec follow-up

- D5 batch Routing-Rule promotion inside `extract-learnings` is **not** implemented in PR-4; this plan defers it explicitly instead of claiming full coverage
- Review items `R1` / `R2` / `R3` are accepted into the current PR scope; only `R4` / `R5` / `R6` stay deferred to v1.1
- Keep C11 locked to **byte-identical AGENTS.md-then-CLAUDE.md first-match per directory preserved**; this is now aligned and should not regress in later spec edits
- Reviewer non-inheritance of docs-map L0/L1 is a cross-PR boundary owned by PR-3b; PR-4 documents the contract but does not add a fake consumer just to assert it
- v1 intentionally uses no process-level docs-map cache; only introduce one later with explicit invalidation semantics and tests

### Type consistency

- `deriveTaskTypeHint(...)`
- `loadAgentsSection(...)`
- `Promise<LoadAgentsSectionResult | null>` return type
- `validateDocsMapEntry(... kind ...)`
- additive `AGENTS.md Context` / `Docs-Map Addendum` prompt blocks
- prompt-layer `resolveDocsMapBareBypass(...)` bridge consuming the existing CLI flag only as a fallback without expanding persisted preferences

Plan complete and saved to `docs/superpowers/plans/2026-04-23-pr-4-agents-md-docs-map-v1.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

## Review Findings (2026-04-23, by Claude Opus 4.7)

> **Scope of this review:** 对照 `docs/superpowers/specs/2026-04-23-agents-md-docs-map-v1.md`（v1, Candidate B）、`docs/superpowers/specs/phase-discipline-preset.md`（v7.1 §4.5）、`docs/superpowers/specs/README.md` 的跨 spec 约束，以及 `packages/pi-coding-agent/src/core/resource-loader.ts:57-112`、`packages/pi-coding-agent/src/main.ts:426-432`、`packages/pi-coding-agent/src/cli/args.ts:189-190`、`src/resources/extensions/gsd/auto-prompts.ts`（Build*Prompt 族）、`src/resources/extensions/gsd/commands-extract-learnings.ts`（buildExtractionStepsBlock / buildExtractLearningsPrompt）、`src/resources/extensions/gsd/gsd-db.ts:2262`（getTask + TaskRow.files）、`.gitignore:65,74`、`.github/workflows/ci.yml:100-102` 实际代码，验证 plan 声明的契约是否成立，并列出实施前必须消歧的点。

### A. 方向与整体评价

- **方向正确且可实施性高。** Plan 的核心判断——"extension-only、loader 不改、fixture 化、policy gate 延迟"——与 spec C11/C13/C14 一致，也与本仓库 `.gitignore` + CI 事实相符。对两条 reality-correction memo（root AGENTS.md 被 gitignore / CI 拒绝 `.gsd/`）的落地处理非常干净。
- **Locked scope 粒度恰当。** Files-to-change 与 Files-to-stay-unchanged 分离清晰；pre-flight check 是可执行脚本而非口头断言；deferred 项（D5 batch routing / C4 cross-chain / R-2 / R-5）都有显式 "v1.1" 落脚。
- **TDD-first 顺序到位。** Task 1 先失败测试再实现，Task 2 才写 loader/lint，符合仓库 `superpowers:test-driven-development` 惯例。

下面按优先级列出**必须在实施前消歧 / 已在 plan 中被低估**的 issue。

### B. High 级问题（必须在 Task 1 开始前收敛）

#### H1. `isBareDocsMapBypassed()` 用 `process.argv.includes("--bare")` 过于脆弱

Plan Task 3 Step 2 的示例：

```ts
function isBareDocsMapBypassed(): boolean {
  return process.argv.includes("--bare");
}
```

问题：

1. prompt builder 是可被测试/子进程/工具复用的纯函数路径；任何一个调用者不透传 argv 就会行为漂移。
2. 无法识别 `--bare=true` / 未来的长格式变体。
3. `firstPass.bare` 已经在 `packages/pi-coding-agent/src/main.ts:432` 被权威解析，再去 re-grep argv 是把已分辨好的语义又抹掉。
4. 与 phase-discipline §4.5 定义的 reviewer 子代理上下文契约冲突——子代理另起进程时 argv 不含 `--bare` 但期望仍绕过 docs-map（因为已经拿不到 owning AGENTS.md）。

**建议**：`LoadAgentsSectionOptions.bare` 必须由调用方显式传入；在 `buildAgentsDocsMapBlock` 外层从已解析的 CLI/session context 读取（或由 auto-dispatch 注入）。删除 argv-grep helper 或只作为 **last-resort fallback**（并在内部 `logWarning` 提示这是降级路径）。

#### H2. C11 的语义矛盾在 plan 引用前就必须修

- `resource-loader.ts:57-71` 的真实行为：**per-directory AGENTS.md → CLAUDE.md 先找先用，AGENTS.md 优先**。
- Spec C11 的字面文字：**CLAUDE.md precedence preserved byte-identically**。
- Plan pre-flight §Step 1 表达的 invariant："first-match with AGENTS.md before CLAUDE.md"。

三处不一致。Plan 的 Self-review 已标了这条为 "spec follow-up"，但 plan 在 locked scope 里又依赖 C11 作为硬约束（`Files that must stay unchanged` 第 1 条）。

**建议**：在 PR-4 拉分支前先提一个纯文档修订 PR（或在本 PR 同时修 spec），把 C11 改成 "byte-identical AGENTS.md-then-CLAUDE.md first-match per directory preserved"；否则实施者会把 `AGENTS.md Context` 接到错的优先级语义上，review 阶段会被打回。

#### H3. Fixture 里 Routing Rule 语法与 spec C5 不一致

- Spec C5：`- **[when phrase]** → [L1 path under \`.gsd/docs-map/]`（含方括号）
- Plan Task 1 Step 1 的 fixture 示例：`- **testing** → .docs-map/testing.md`（**无方括号**）
- Plan `deriveTaskTypeHint` 实现里也没定义 parser 对 `**[phrase]`** vs `**phrase**` 的容忍策略。

这是硬冲突：loader parser 若严格按 C5 实现，fixture 全挂；若按 fixture 实现，spec 里每个使用 C5 语法的客户端 AGENTS.md 都得被改。

**建议**：

- 选定"**宽松 parser，两种都接受**"或者"**严格 parser，以 fixture 为准（phrase 不带方括号）**"。后者成本更低，也更符合 Markdown 列表/粗体惯例。
- 在 plan 的 Task 2 Step 2 下明确："Routing Rule regex = `/^\s*-\s+\*\*(.+?)\*\*\s*(?:→|->)\s*(.+?)\s*$/`，phrase 在匹配时做 `.trim().toLowerCase()` 归一（与 `deriveTaskTypeHint` 对齐）。"
- 同步更新 spec C5 的语法示例或增加"方括号可选"的注脚。

### C. Medium 级问题（强烈建议在 Task 1 前补齐）

#### M1. `loadAgentsSection(cwd)` 的 cwd 契约未定义

当前 plan：

```ts
export interface LoadAgentsSectionOptions { cwd: string; ... }
```

但没说调用侧传什么：

- 传 `process.cwd()` → reviewer 子代理 cwd 可能与主进程不同，ancestor walk 漂移；fixture 测试也要 `process.chdir` 污染全局状态。
- 传 `base`（工程根，`auto-prompts.ts` 的 builder 几乎都有这个参数）→ 不会往 base 之上走，与平台 loader 的 ancestor-walk 语义偏离。
- 不传，fallback 到 `process.cwd()` → 隐式耦合调用环境。

**建议**：plan 在 Task 2 Step 2 明确：

- cwd **必传**，不接受默认值；
- 对 builder 调用，注入 `base`；对 reviewer 子代理，注入 `base`（或 session 持有的 project root），不使用 `process.cwd()`；
- 如果要支持 ancestor walk 超过 `base`（真多仓库场景），那是 v2（candidate A）范畴，v1 在 base 命中第一个 marker 即停。

这条和 spec §5 §8 没冲突，但 plan 必须把它写下来，否则实现者会自由选择。

#### M2. 与 phase-discipline §4.5 的 reviewer 子代理上下文契约缺少回归测试

spec §4.5 明文：reviewer 子代理**继承**平台 loader 的 AGENTS.md（系统提示），**不继承**扩展 loader 的 L0/L1（任务提示）。PR-4 把 `## AGENTS.md Context` 写进 task prompt；如果 phase-discipline preset（PR-3b）把 task prompt 原样转发给 reviewer，就会静默违约。

**建议**：

- Plan 承认这是"PR-4 + PR-3b 的跨 PR 契约"，在 Task 3 的 prompt-attachment 测试里增加一条负向断言："reviewer 子代理的入参 prompt（由 phase-discipline 构造的降级版本）**不**包含 `## AGENTS.md Context` 块"——即便 PR-3b 还没 land，也可以 mock 一个 reviewer-prompt builder 来断言这个边界。
- 或者在 Self-review 的 "Deferred" 里显式记录："此回归由 PR-3b 拥有；PR-4 提供测试 hook 但不执行断言。"

不做这个选择，未来 PR-3b 的 review 会不得不回头动 PR-4 代码。

#### M3. Loader 的缓存策略未定义

平台 loader 配套有 `resource-loader-cache-reset.test.ts`，暗示有 per-session 缓存。PR-4 loader 每次调用都会：

1. walk ancestors（最多 N 层 `existsSync`）
2. readFileSync 所有命中的 AGENTS.md
3. 解析 markdown + routing rules
4. readFileSync L1（若命中）

在一个 milestone 内 auto-mode 的 builder 会被反复调用（plan-slice、refine-slice、execute-task、complete-slice、complete-milestone、extract-learnings 全都接入），每次都重新 IO + 解析很浪费，也会让 fixture 测试结果受 fs 状态影响（比如并行测试改 fixture）。

**建议**：

- 如果 v1 接受"每次重新读"，plan 里显式写明"无 process 级缓存；依赖 OS page cache"。
- 如果要缓存，plan 需定义：cache key（绝对路径 + mtime）、reset 钩子、测试如何绕过。
- 建议 v1 无缓存但 `LoadAgentsSectionOptions` 预留 `cache?: DocsMapCache` 可选字段，为 v1.1 留空间。

#### M4. `buildCompleteMilestonePrompt` 的注入点与 `buildExtractionStepsBlock` 的调用关系

- Plan Task 3 Step 2 要求 `buildCompleteMilestonePrompt` → L0 only，additive，不干扰 `extractLearningsSteps`。
- `commands-extract-learnings.ts:buildExtractionStepsBlock` 被 `buildCompleteMilestonePrompt` 内嵌（通过 `extractLearningsSteps`）。同时 `buildExtractLearningsPrompt` 也会走这个 block + L0。
- 如果 `buildExtractionStepsBlock` 内部再自己注入一次 L0（或 plan 让 manual path 和 complete-milestone path 各自注入一次），complete-milestone 的 prompt 里会出现重复 `## AGENTS.md Context`。

**建议**：plan 明确"`buildExtractionStepsBlock` 不注入 docs-map；L0 注入在两个外层 builder 各自完成一次，且使用唯一 section header 保证 dedupe"。Task 3 的 prompt-attachment 测试加一条"complete-milestone prompt 中 `## AGENTS.md Context` 出现次数 = 1"。

#### M5. `execute-task` 的 hint fallback 行为

- `deriveTaskTypeHint` 在 phrase 空 / 未命中时返回 `null`。
- 当前 `buildAgentsDocsMapBlock` 示例：`loaded.l1 ? \`\n## Docs-Map Addendum\n\n${loaded.l1} : ""`。但` loaded`本身在`bare=true`或 markerless 时为`null`，整个 header` ## AGENTS.md Context` 也不应出现。

Plan 的示例**没有显式测试**：

- hint=null + marker 存在 → 只出 `## AGENTS.md Context`（L0），**不出** `## Docs-Map Addendum`（含 header）
- marker 缺失 → **不出** `## AGENTS.md Context`

**建议**：Task 3 Step 4 的测试覆盖这两种边界。

#### M6. Mixed ancestor chain（有 marker 与 markerless 混合）缺 fixture

Plan Task 2 Step 2 写 "only marker-bearing AGENTS.md files participate in docs-map parsing"，但 fixture 只有 markerless 单文件 / 全 marker 的 ancestor chain，没有"中间有 markerless、叶子有 marker"或反向情况。

**建议**：fixture 增加 `tests/fixtures/agents-docs-map/mixed-chain/...` 覆盖这两种交错。

#### M7. `scripts/check-agents-docs-map.mts` 的扫描 roots 没在 plan 里锁定

Plan 只说"CI lint gate wired to fixture + repo scans"，但脚本在 plan 里没有明确的 `roots` 常量。若默认递归全 repo，会扫到 `docs/`**、`dist/**`、`packages/**` 里可能存在的 README/AGENTS.md 结构，产生误报；若只扫 fixture，repo 层面没有任何实时保护。

**建议**：plan 里把脚本的 roots 固化：

```ts
const roots = [
  "tests/fixtures/agents-docs-map",
  // 未来 policy gate 通过后补: "." (repo root AGENTS.md)
];
```

并在 plan 里注明"仓库 policy 改动后才把 repo root 加入 roots，本 PR 不加"。

### D. Low 级问题（建议顺手修，不阻塞）

#### L1. `LoadAgentsSectionResult` 缺 null 分支的类型签名

Plan 示例：`export interface LoadAgentsSectionResult { mode: "docs-map-v1"; ... }`。但 `bare=true` / markerless 都 return `null`。返回类型必须是 `Promise<LoadAgentsSectionResult | null>`，plan 显式写出这点避免实现者分歧。

#### L2. 测试命令依赖 `--experimental-strip-types`（Node 22.6+）

Plan 的 CI 片段：

```yaml
run: node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types scripts/check-agents-docs-map.mts
```

仓库现有其它 CI 步骤已在用该模式，但 plan 没在 pre-flight 验证 CI 所用 Node >= 22.6。建议 pre-flight 新增 Step 4 `node -v` 锁版本。

#### L3. Fixture 文件大小未约束

`testing.md` / `frontend.md` fixture 大小不受限，可能将来被无意写超 1000 chars（C3 optional section cap），导致自己的 lint fixture self-conflict。建议 plan 声明 fixture 总量约束（如 `AGENTS.md ≤ 1500 chars`、`testing.md ≤ 400 chars`）。

#### L4. `capPreamble` 包裹整个合并块的语义风险

Plan 的 helper：

```ts
return capPreamble([
  "## AGENTS.md Context", "", loaded.l0,
  loaded.l1 ? `\n## Docs-Map Addendum\n\n${loaded.l1}` : "",
].join("\n").trim());
```

`capPreamble`（auto-prompts.ts:80）是对 preamble 做尾部截断；若 L0+L1 总长接近上限，L1 可能被截一半导致语义泄漏。C3/C4 已经在 lint 层保护，所以这里 cap 的价值有限，反而引入被截断风险。

**建议**：去掉这里的 `capPreamble`，把字符预算交给 lint；或者 L0 与 L1 各自独立走 `capPreamble`，避免越界截掉 L1 header。

#### L5. `dispatch-rules` / `phase-discipline` 相关 cross-spec 引用

README.md "Context-flow at execute-task" 定义了执行期上下文注入顺序（步骤 2 = `loadAgentsSection`）。Plan 应在实现里记录这个顺序（在 `buildExecuteTaskPrompt` 里 `## AGENTS.md Context` 出现位置应在 `inlineGraphSubgraph` + `queryKnowledge` + `loadMemoryBlock` **之前**，符合 README 顺序约定）。plan 当前没定相对位置。

### E. 完整性判断


| 维度                                     | 判断                  |
| -------------------------------------- | ------------------- |
| 目标明确                                   | ✅                   |
| Scope 锁定                               | ✅（H1/H2/H3 消歧后即可执行） |
| Pre-flight 可执行                         | ✅                   |
| TDD 次序                                 | ✅                   |
| Reality-correction 落地                  | ✅ 优秀                |
| 跨 spec 契约（§4.5 / README §Context-flow） | ⚠️ 部分覆盖（M2 / L5）    |
| 边界用例覆盖                                 | ⚠️ M5 / M6 需补       |
| 性能 / 并发 / 缓存                           | ⚠️ M3 未定义           |
| 契约级歧义（H1-H3）                           | ❌ 必须先修              |


### F. 结论

**方案总体可以进入实施，但建议在切分支前先完成以下 3 项（约 30 分钟即可）：**

1. **修 H1**：把 `isBareDocsMapBypassed()` 换成"从调用方显式接收 `bare: boolean`"；保留 argv-grep 仅作为 fallback 并打 warning。
2. **修 H2**：spec `2026-04-23-agents-md-docs-map-v1.md` 的 C11 条目重写为 "byte-identical AGENTS.md-then-CLAUDE.md first-match per directory preserved"。
3. **修 H3**：在 plan Task 2 Step 2 里锁定 Routing Rule 正则（无方括号，箭头兼容 `→` / `->`），同步 fixture 示例。

**随后建议在 Task 1 Step 1 之前把 M1-M7 写进 plan（大部分是一行约束）。** M3 的缓存即使选择"v1 无缓存"也必须显式声明，避免实施过程中被 code-reviewer 要求返工补。

达成上述 3 高 + 7 中级修补后，plan 就足够完整支持按 TDD-first 顺序进入 Task 1，无需再做结构性重写。

### G. 实施建议的切入点

- **先拉两个分支**：`docs/fix-docs-map-c11-and-c5` 快速消歧 spec；`feat/agents-md-docs-map-v1` 正文。前者是 docs-only，可与 PR-1 / PR-2 / PR-3a 并行 review。
- **Task 1 Step 2 的 loader 测试**优先覆盖 H3 敲定后的 Routing Rule 语法 + M1 的 cwd 契约，这两条是所有后续测试的底座。
- **Task 3 Step 2 的 `buildAgentsDocsMapBlock`** 接收 `{ cwd, unitType, title, filePaths, bare }` 五元组显式参数，不自取 argv / process.cwd，可让 prompt-attachment 测试无需 `process.chdir` 污染。

— 评审结论到此为止；plan 在消歧 H1–H3、补齐 M1–M7 之后可直接进入 Task 1 TDD 实施。