# PR-1 CLI Tool-Restriction Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the verified `--tools` restriction chain on current `main` so the shared non-interactive session path used by text / JSON / RPC CLI modes honours an exhaustive tool whitelist and does not silently re-enable the built-in `Skill` tool or auto-activated extension tools.

**Architecture:** This is a selective 4-file forward-port from the already-generated reference implementation currently visible in `dist-test/` (which itself came from the earlier feat-branch work), not a redesign, with **two explicit `main`-ahead deltas that must be preserved**: `packages/pi-coding-agent/src/core/agent-session.ts` keeps the #3731 `newSession(...abortSignal)` guard, and `src/cli.ts` keeps `printExtensionWarnings(...)` plus both call sites. Current live `src/` only carries part of the chain in `sdk.ts` (`extraActiveToolNames`), so this PR must **complete** the chain rather than blindly overwrite it. The CLI layer splits `--tools` into built-in names (`flags.tools`) and non-built-in passthrough names (`flags.extraToolNames`); `resolveCreateAgentSessionToolOptions(...)` returns the exact `createAgentSession(...)` option subset needed on `main` (`tools`, `extraActiveToolNames`, `includeBuiltInSkillTool`). `sdk.ts` exposes only `includeBuiltInSkillTool` publicly and derives `autoActivateNewExtensionTools` internally before constructing `AgentSession`. `AgentSession` honours restricted mode by gating `_getBuiltinTools()` and by preventing constructor / `newSession()` / `reload()` rebuild paths from silently re-activating built-in `Skill` or newly discovered extension tools. `setActiveToolsByName(...)` stays unchanged.

**Tech Stack:** TypeScript, root CLI (`src/cli.ts`, `src/cli-web-branch.ts`), `@gsd/pi-coding-agent` SDK/session core, Node test runner.

---

## Locked scope

### Files that must change

- Modify: `src/cli.ts` (print-mode `createAgentSession(...)` call only; preserve `printExtensionWarnings`)
- Modify: `src/cli-web-branch.ts` (imports, `CliFlags.extraToolNames`, `--tools` bucket split, helper)
- Modify: `packages/pi-coding-agent/src/core/sdk.ts` (public `includeBuiltInSkillTool`, internal `autoActivateNewExtensionTools` derivation)
- Modify: `packages/pi-coding-agent/src/core/agent-session.ts` (`AgentSessionConfig`, constructor fields, `_getBuiltinTools()`, `_refreshToolRegistry()`, `newSession()`, `reload()`; preserve `abortSignal`)
- Create: `src/tests/cli-web-branch-tools.test.ts`
- Create: `packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts`

### Files that must stay unchanged

- Do **not** modify `packages/pi-coding-agent/src/cli/args.ts`
- Do **not** modify interactive / web UI code
- Do **not** modify built-in tool definitions
- Do **not** modify composed-lite runtime files in this PR
- Do **not** rewrite `setActiveToolsByName(...)` in this PR

### Source of truth for the code delta

This PR is explicitly a **guided forward-port**. The authoritative implementation reference is the current `dist-test/` mirror for these four files, cross-checked against live `src/` and the two `main`-ahead safety deltas above. Use the earlier feat-branch diff only as a secondary provenance aid if needed; do not treat it as more authoritative than the code already materialised under `dist-test/`.

Run before coding:

```bash
diff -u dist-test/src/cli.ts src/cli.ts && diff -u dist-test/src/cli-web-branch.ts src/cli-web-branch.ts && diff -u dist-test/packages/pi-coding-agent/src/core/sdk.ts packages/pi-coding-agent/src/core/sdk.ts && diff -u dist-test/packages/pi-coding-agent/src/core/agent-session.ts packages/pi-coding-agent/src/core/agent-session.ts
```

Expected:

- The diff shows `resolveCreateAgentSessionToolOptions(...)` and `CliFlags.extraToolNames?: string[]` missing from live `src/cli-web-branch.ts`
- `sdk.ts` already has `extraActiveToolNames`; the missing live delta is the public `includeBuiltInSkillTool?: boolean` plus the internal derivation that passes extension auto-activation policy into `AgentSession`
- `agent-session.ts` adds built-in `Skill` gating and rebuild-path restriction handling without deleting `newSession.abortSignal`
- `src/cli.ts` wires print-mode tool options without deleting `printExtensionWarnings`
- The live-vs-reference difference is limited to the intended chain-completion surface; no fifth production file is needed

## Pre-flight checks

- [ ] **Step 1: Verify the chain is only partially present and the two `main`-ahead safety deltas are still present**

Run:

```bash
node -e "const fs=require('node:fs'); const pairs=[['src/cli-web-branch.ts','resolveCreateAgentSessionToolOptions'],['packages/pi-coding-agent/src/core/sdk.ts','extraActiveToolNames'],['packages/pi-coding-agent/src/core/sdk.ts','includeBuiltInSkillTool'],['packages/pi-coding-agent/src/core/agent-session.ts','autoActivateNewExtensionTools']]; for (const [p,q] of pairs){const c=fs.readFileSync(p,'utf8'); console.log(p, c.includes(q)?'FOUND':'MISSING', q)}" && grep -n "abortSignal" packages/pi-coding-agent/src/core/agent-session.ts && grep -n "printExtensionWarnings" src/cli.ts
```

Expected:

- `src/cli-web-branch.ts` prints `MISSING resolveCreateAgentSessionToolOptions`
- `packages/pi-coding-agent/src/core/sdk.ts` prints `FOUND extraActiveToolNames`
- `packages/pi-coding-agent/src/core/sdk.ts` prints `MISSING includeBuiltInSkillTool`
- `packages/pi-coding-agent/src/core/agent-session.ts` prints `MISSING autoActivateNewExtensionTools`
- `grep` finds `abortSignal` inside `newSession(...)`
- `grep` finds `printExtensionWarnings` definition and both call sites in `src/cli.ts`
- This confirms the chain is only **partially** landed on `main`, and also locks the two deltas that must **not** be regressed while completing it

- [ ] **Step 2: Verify the reusable test anchors already exist**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/parse-cli-args.test.ts packages/pi-coding-agent/src/cli/args.test.ts packages/pi-coding-agent/src/core/skill-tool.test.ts
```

Expected:

- Exit code `0`
- Existing parser and Skill-tool tests are green before the PR starts

- [ ] **Step 3: Re-read the feat-branch delta before touching code**

Run:

```bash
git diff --unified=20 HEAD feat/composed-lite-runtime-owned -- src/cli.ts src/cli-web-branch.ts packages/pi-coding-agent/src/core/sdk.ts packages/pi-coding-agent/src/core/agent-session.ts
```

Expected:

- You can point to the exact parse split, helper signature, SDK public field count, and AgentSession gating points before implementation starts

### Task 1: Add failing tests for the restriction chain

**Files:**
- Create: `src/tests/cli-web-branch-tools.test.ts`
- Create: `packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts`
- Read for patterns: `src/tests/parse-cli-args.test.ts:1-155`
- Read for patterns: `packages/pi-coding-agent/src/core/skill-tool.test.ts:1-89`

- [ ] **Step 1: Write failing CLI parser/helper tests against the reference-compatible contract**

Create `src/tests/cli-web-branch-tools.test.ts` with these assertions:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, resolveCreateAgentSessionToolOptions } from "../cli-web-branch.ts";

function toolNames(result: ReturnType<typeof resolveCreateAgentSessionToolOptions>) {
  return result.tools?.map((tool) => tool.name);
}

test("no --tools preserves default createAgentSession behaviour", () => {
  const flags = parseCliArgs(["node", "gsd", "-p", "hello"]);
  assert.equal(flags.tools, undefined);
  assert.equal(flags.extraToolNames, undefined);
  const result = resolveCreateAgentSessionToolOptions(flags);
  assert.equal(result.tools, undefined);
  assert.equal(result.extraActiveToolNames, undefined);
  assert.equal(result.includeBuiltInSkillTool, undefined);
});

test("--tools read,grep stays in builtins and disables Skill", () => {
  const flags = parseCliArgs(["node", "gsd", "-p", "--tools", "read,grep"]);
  assert.deepEqual(flags.tools, ["read", "grep"]);
  assert.equal(flags.extraToolNames, undefined);
  const result = resolveCreateAgentSessionToolOptions(flags);
  assert.deepEqual(toolNames(result), ["read", "grep"]);
  assert.equal(result.extraActiveToolNames, undefined);
  assert.equal(result.includeBuiltInSkillTool, false);
});

test("explicit skill stays in extras path and keeps built-in Skill enabled", () => {
  const flags = parseCliArgs(["node", "gsd", "-p", "--tools", "read,skill"]);
  assert.deepEqual(flags.tools, ["read"]);
  assert.deepEqual(flags.extraToolNames, ["skill"]);
  const result = resolveCreateAgentSessionToolOptions(flags);
  assert.deepEqual(toolNames(result), ["read"]);
  assert.deepEqual(result.extraActiveToolNames, ["skill"]);
  assert.equal(result.includeBuiltInSkillTool, true);
});

test("unknown or extension tool names stay in extraToolNames", () => {
  const flags = parseCliArgs(["node", "gsd", "-p", "--tools", "read,gsd_complete_task,browser_navigate"]);
  assert.deepEqual(flags.tools, ["read"]);
  assert.deepEqual(flags.extraToolNames, ["gsd_complete_task", "browser_navigate"]);
  const result = resolveCreateAgentSessionToolOptions(flags);
  assert.deepEqual(toolNames(result), ["read"]);
  assert.deepEqual(result.extraActiveToolNames, ["gsd_complete_task", "browser_navigate"]);
  assert.equal(result.includeBuiltInSkillTool, false);
});

test("lsp currently travels through the extras path for feat parity", () => {
  const flags = parseCliArgs(["node", "gsd", "-p", "--tools", "read,lsp"]);
  assert.deepEqual(flags.tools, ["read"]);
  assert.deepEqual(flags.extraToolNames, ["lsp"]);
  const result = resolveCreateAgentSessionToolOptions(flags);
  assert.deepEqual(toolNames(result), ["read"]);
  assert.deepEqual(result.extraActiveToolNames, ["lsp"]);
  assert.equal(result.includeBuiltInSkillTool, false);
});

```

 - [ ] **Step 2: Write failing AgentSession tests**

Create `packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts` with these cases:
```ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Agent } from "@gsd/pi-agent-core";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import { ModelRegistry } from "./model-registry.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

let testDir = "";

function exampleExtraTool() {
  return {
    name: "example_extra",
    label: "Example Extra",
    description: "Example extension-like SDK tool for restriction tests.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  };
}

async function createSession(options?: {
  initialActiveToolNames?: string[];
  includeBuiltInSkillTool?: boolean;
  autoActivateNewExtensionTools?: boolean;
  extraActiveToolNames?: string[];
  customTools?: ReturnType<typeof exampleExtraTool>[];
}) {
  const agentDir = join(testDir, "agent-home");
  mkdirSync(agentDir, { recursive: true });
  const authStorage = AuthStorage.inMemory({});
  const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: testDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();
  return new AgentSession({
    agent: new Agent(),
    sessionManager: SessionManager.inMemory(testDir),
    settingsManager,
    cwd: testDir,
    resourceLoader,
    modelRegistry,
    initialActiveToolNames: options?.initialActiveToolNames,
    includeBuiltInSkillTool: options?.includeBuiltInSkillTool,
    autoActivateNewExtensionTools: options?.autoActivateNewExtensionTools,
    extraActiveToolNames: options?.extraActiveToolNames,
    customTools: options?.customTools,
  });
}

describe("AgentSession tool restriction", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "agent-session-tool-restriction-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not auto-register Skill when includeBuiltInSkillTool=false", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read"],
      includeBuiltInSkillTool: false,
    });
    assert.deepEqual(session.getActiveToolNames(), ["read"]);
    assert.equal(session.getAllTools().some((tool) => tool.name === "Skill"), false);
  });

  it("does not auto-activate extension tools when autoActivateNewExtensionTools=false", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read"],
      autoActivateNewExtensionTools: false,
      customTools: [exampleExtraTool()],
    });
    assert.deepEqual(session.getActiveToolNames(), ["read"]);
    assert.equal(session.getAllTools().some((tool) => tool.name === "example_extra"), true);
  });

  it("default mode remains byte-identical when both flags are omitted", async () => {
    const session = await createSession({
      customTools: [exampleExtraTool()],
    });
    assert.equal(session.getActiveToolNames().includes("Skill"), true);
    assert.equal(session.getActiveToolNames().includes("example_extra"), true);
  });

  it("restricted-mode extraActiveToolNames: [\"lsp\"] still activates lsp via registry lookup", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read"],
      extraActiveToolNames: ["lsp"],
    });
    assert.deepEqual(session.getActiveToolNames(), ["read", "lsp"]);
  });
});

```

 - [ ] **Step 3: Run the two new files and confirm they fail**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/cli-web-branch-tools.test.ts packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts
```

Expected:

- Exit code non-zero
- Failures mention missing helper and/or Skill still being auto-enabled

- [ ] **Step 4: Keep the red tests local until Task 3 turns the suite green**

Do **not** create a red commit by default. If your workflow insists on TDD checkpoints, use a private WIP commit and squash it before publishing.

### Task 2: Forward-port the CLI helper and SDK option surface

**Files:**
- Modify: `src/cli-web-branch.ts:7-98`
- Modify: `src/cli.ts:559-574`
- Modify: `packages/pi-coding-agent/src/core/sdk.ts:79-124, 320-333`

- [ ] **Step 1: Forward-port the `--tools` parser split in `src/cli-web-branch.ts`**

Add the feat-compatible pieces together:

- imports from `@gsd/pi-coding-agent` for the built-in tool objects used by the helper
- `const builtInTools = { ... } as const`
- `type BuiltInToolName = keyof typeof builtInTools`
- `CliFlags.extraToolNames?: string[]`
- `parseCliArgs()` logic that lower-case normalises `--tools` entries, buckets built-ins into `flags.tools`, and buckets everything else into `flags.extraToolNames`

Implementation note:

- Preserve feat parity: `lsp` currently flows through the extras path, not the `builtInTools` map
- Do **not** move parsing into `packages/pi-coding-agent/src/cli/args.ts`

- [ ] **Step 2: Add the feat-compatible helper `resolveCreateAgentSessionToolOptions(...)`**

Implement the helper with this contract:

```ts
interface CreateAgentSessionToolOptions {
  tools?: CreateAgentSessionOptions['tools'];
  extraActiveToolNames?: CreateAgentSessionOptions['extraActiveToolNames'];
  includeBuiltInSkillTool?: boolean;
}

export function resolveCreateAgentSessionToolOptions(
  flags: Pick<CliFlags, 'tools' | 'extraToolNames'>,
): CreateAgentSessionToolOptions {
  const tools = flags.tools?.map((name) => builtInTools[name as BuiltInToolName]).filter(Boolean);
  const hasExplicitToolRestriction = !!flags.tools || !!flags.extraToolNames;
  const requestedSkill = (flags.extraToolNames ?? []).some((name) => name.toLowerCase() === 'skill');
  return {
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(flags.extraToolNames && flags.extraToolNames.length > 0
      ? { extraActiveToolNames: flags.extraToolNames }
      : {}),
    ...(hasExplicitToolRestriction ? { includeBuiltInSkillTool: requestedSkill } : {}),
  };
}
```

Implementation note:

- Keep the naming asymmetry: CLI layer uses `extraToolNames`, SDK layer uses `extraActiveToolNames`
- Do **not** rename either side for symmetry in PR-1; that would expand the forward-port surface beyond the verified feat diff

- [ ] **Step 3: Wire the helper into the non-interactive `createAgentSession(...)` call in `src/cli.ts`**

At `src/cli.ts:567-574`, resolve the helper result once and spread it into the existing call:

```ts
const printModeToolOptions = resolveCreateAgentSessionToolOptions(cliFlags);
const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
  authStorage,
  modelRegistry,
  settingsManager,
  sessionManager,
  resourceLoader,
  isClaudeCodeReady: () => modelRegistry.isProviderRequestReady('claude-code'),
  ...printModeToolOptions,
});
```

Constraint:

- Do **not** touch the interactive `createAgentSession(...)` call at `src/cli.ts:723-730`
- Do **not** delete `printExtensionWarnings(...)` or either of its call sites

- [ ] **Step 4: Widen `CreateAgentSessionOptions` in `sdk.ts` with the correct public surface**

Add **only** this public field to the interface:

```ts
includeBuiltInSkillTool?: boolean;
```

Then keep `autoActivateNewExtensionTools` as an internal derivation inside `createAgentSession(...)`:

```ts
const hasExplicitToolRestriction = options.tools !== undefined || options.extraActiveToolNames !== undefined;
// ...
new AgentSession({
  // ...
  initialActiveToolNames,
  includeBuiltInSkillTool: options.includeBuiltInSkillTool,
  autoActivateNewExtensionTools: !hasExplicitToolRestriction,
})
```

Constraint:

- `autoActivateNewExtensionTools` does **not** belong on the public `CreateAgentSessionOptions` interface in PR-1

- [ ] **Step 5: Run the focused tests again**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/cli-web-branch-tools.test.ts packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts
```

Expected:

- The parser/helper tests now pass
- AgentSession tests still fail because runtime honouring is not implemented yet

- [ ] **Step 6: Keep the branch unpublished until Task 3 turns the suite green**

No red public commit by default. If you checkpoint locally, it must be squashed before the final PR branch is published.

### Task 3: Honour restricted mode inside `AgentSession`

**Files:**
- Modify: `packages/pi-coding-agent/src/core/agent-session.ts:150-172, 302-320, 1267-1273, 1568+, 2144+, 2268+`
- Test: `packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts`

- [ ] **Step 1: Add the two config booleans to `AgentSessionConfig` and constructor state**

Mirror the verified feat-branch shape:

```ts
includeBuiltInSkillTool?: boolean;
autoActivateNewExtensionTools?: boolean;
```

and store them as private fields:

```ts
private _autoActivateNewExtensionTools: boolean;
private _includeBuiltInSkillTool: boolean;
```

with constructor defaults:

```ts
this._autoActivateNewExtensionTools = config.autoActivateNewExtensionTools ?? (config.initialActiveToolNames === undefined);
this._includeBuiltInSkillTool = config.includeBuiltInSkillTool ?? true;
```

- [ ] **Step 2: Gate Skill registration in `_getBuiltinTools()` and leave `setActiveToolsByName(...)` alone**

The feat-compatible change is localised here:

```ts
private _getBuiltinTools(): AgentTool[] {
  return this._includeBuiltInSkillTool ? [this._createBuiltInSkillTool()] : [];
}
```

Do **not** rewrite `setActiveToolsByName(...)`. Once `_getBuiltinToolNames()` returns `[]`, the existing merge logic naturally stops re-adding `Skill`.

The important invariant after the edit remains:

```ts
setActiveToolsByName(["read", "grep"])
```

must **not** silently add `Skill` when `includeBuiltInSkillTool=false`.

- [ ] **Step 3: Gate runtime build / refresh paths with `_autoActivateNewExtensionTools`**

Current call-site anchors to update:

- `newSession(...)` cwd-change rebuild at `agent-session.ts:1619-1623`
- `newSession(...)` same-cwd refresh at `agent-session.ts:1630-1633`
- `reload()` rebuild at `agent-session.ts:2274-2278`

Implement the feat-compatible behaviour in all of these places:

- `_refreshToolRegistry(...)`: derive `const shouldAutoIncludeExtensionTools = options?.includeAllExtensionTools ?? this._autoActivateNewExtensionTools`
- `newSession(...)`: replace hardcoded `includeAllExtensionTools: true` with `this._autoActivateNewExtensionTools`
- `reload()`: replace hardcoded `includeAllExtensionTools: true` with `this._autoActivateNewExtensionTools`

Where runtime rebuild paths currently include all extension tools by default, use:

```ts
includeAllExtensionTools: this._autoActivateNewExtensionTools,
```

Constraints:

- Preserve the existing #3731 `abortSignal` signature and aborted guard in `newSession(...)`
- Do not make unrelated changes to session switching or retry behaviour

- [ ] **Step 4: Flesh out the AgentSession regression tests and make them pass**

The finished assertions must cover:

- `includeBuiltInSkillTool=false` removes `Skill`
- `autoActivateNewExtensionTools=false` prevents extension tool reactivation
- Omitted flags preserve the current default tool set
- `example_extra` is still present in the registry even when it is not auto-activated
- Restricted-mode `extraActiveToolNames: ["lsp"]` still activates `lsp` via registry lookup

- [ ] **Step 5: Run focused package tests**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts packages/pi-coding-agent/src/core/skill-tool.test.ts packages/pi-coding-agent/src/cli/args.test.ts src/tests/cli-web-branch-tools.test.ts
```

Expected:

- Exit code `0`
- New restriction tests pass
- Existing `skill-tool.test.ts` still passes in default mode

- [ ] **Step 6: Optional local green checkpoint**

Only after Step 5 is green, you may create a local checkpoint commit. Final PR history is assembled in Task 4.

### Task 4: Final verification against the forward-port target

**Files:**
- Verify only: `src/cli.ts`
- Verify only: `src/cli-web-branch.ts`
- Verify only: `packages/pi-coding-agent/src/core/sdk.ts`
- Verify only: `packages/pi-coding-agent/src/core/agent-session.ts`
- Verify only: `src/tests/cli-web-branch-tools.test.ts`
- Verify only: `packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts`

- [ ] **Step 1: Run the exact focused validation set**

Run:

```bash
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/cli-web-branch-tools.test.ts packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts packages/pi-coding-agent/src/core/skill-tool.test.ts packages/pi-coding-agent/src/cli/args.test.ts && npx tsc --noEmit --project tsconfig.json
```

Expected:

- All tests pass
- `tsc --noEmit --project tsconfig.json` exits `0`, covering the `src/cli*` and `packages/pi-coding-agent/*` files that PR-1 actually edits

- [ ] **Step 2: Compare the final code against the feat-branch reference and filter the known `main`-ahead deltas**

Run:

```bash
git diff --unified=5 HEAD feat/composed-lite-runtime-owned -- src/cli.ts src/cli-web-branch.ts packages/pi-coding-agent/src/core/sdk.ts packages/pi-coding-agent/src/core/agent-session.ts
```

Expected:

- Diff is empty **except** for the two deliberate `main`-ahead deltas listed below (and, at most, trivial local naming/test-only differences):
  - `packages/pi-coding-agent/src/core/agent-session.ts` keeps `newSession.abortSignal` and the aborted guard
  - `src/cli.ts` keeps `printExtensionWarnings(...)` and both call sites
- No fifth production file appears

- [ ] **Step 3: Create the final implementation commit**

```bash
git add src/cli.ts src/cli-web-branch.ts packages/pi-coding-agent/src/core/sdk.ts packages/pi-coding-agent/src/core/agent-session.ts src/tests/cli-web-branch-tools.test.ts packages/pi-coding-agent/src/core/agent-session-tool-restriction.test.ts
git commit -m "feat: enforce cli tool restriction chain"
```

## Self-review

### Spec coverage

- `src/cli-web-branch.ts` gets the feat-compatible parser split plus the normalising helper
- `src/cli.ts` forwards the resolved options into the shared non-interactive `createAgentSession(...)` path while preserving `printExtensionWarnings`
- `sdk.ts` widens the public contract with `includeBuiltInSkillTool` only, while deriving `autoActivateNewExtensionTools` internally
- `agent-session.ts` stops re-enabling Skill / extension tools in restricted mode without touching `setActiveToolsByName(...)`
- Focused tests cover default mode, `skill` exclusion, explicit `skill` inclusion, extension-tool exhaustiveness, and the current `lsp` feat-parity asymmetry

### Non-goals / preserved semantics

- Interactive (`gsd`) mode remains unchanged in this PR
- Web (`--web`) mode remains unchanged in this PR
- `--mode mcp` remains unchanged in this PR: after session creation, `src/cli.ts` intentionally re-activates `allToolNames` before starting the MCP transport, so exhaustive restriction for MCP is a separate follow-up rather than part of this forward-port
- The shared non-interactive path covered by this PR is text / json / rpc via the print-mode `createAgentSession(...)` call
- `lsp` continues to flow through the extras path in PR-1 for feat parity; do not "clean it up" here

### Placeholder scan

- No `TBD`
- No `TODO`
- No unnamed files
- No “similar to feat branch” without an explicit diff command

### Type consistency

- `resolveCreateAgentSessionToolOptions(...)`
- `CliFlags.extraToolNames`
- `includeBuiltInSkillTool` (public)
- `autoActivateNewExtensionTools` (internal `sdk.ts` → `AgentSessionConfig` only)
- `extraToolNames` at CLI layer / `extraActiveToolNames` at SDK layer
- `builtInTools` / `BuiltInToolName`

Plan revised and ready for execution.
