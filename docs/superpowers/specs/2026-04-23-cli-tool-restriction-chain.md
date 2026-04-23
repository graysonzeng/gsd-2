# CLI Tool-Restriction Chain (M0)

> **Origin** — extracted from `docs/superpowers/specs/phase-discipline-preset.md` (formerly `composed-lite-harness-brainstorm.md`) v5 §4.6 / §8 PR-1 during the v6 rewrite on 2026-04-23. This PR is orthogonal to phase-discipline preset and to AGENTS.md docs-map v1; it can be landed independently and benefits every `--tools`-restricted subagent regardless of other opt-in features.

## 0. Summary & scope

**What we are shipping:** make the CLI `--tools` flag actually restrictive when passed to `createAgentSession(...)` in print / JSON modes, by threading a normalised tool-restriction option end-to-end through 4 files:

1. `@/Users/sheng/tencent/gsd-2/src/cli.ts` — call the option helper; pass resolved tool options to `createAgentSession`
2. `@/Users/sheng/tencent/gsd-2/src/cli-web-branch.ts` — add `resolveCreateAgentSessionToolOptions(...)` helper + `--tools` parser
3. `@/Users/sheng/tencent/gsd-2/packages/pi-coding-agent/src/core/sdk.ts` — accept `includeBuiltInSkillTool` option; derive `autoActivateNewExtensionTools`
4. `@/Users/sheng/tencent/gsd-2/packages/pi-coding-agent/src/core/agent-session.ts` — honour restricted mode; do not auto-reactivate extension / built-in Skill tools

**Out of scope:**

- Interactive / REPL session mode (already path-gated by different code)
- Any UI-layer tool-picker changes
- Changes to the set of built-in tools themselves
- Phase-discipline preset / AGENTS.md docs-map work (separate specs)

## 1. Context & problem

Composed-lite scout subagents observed in real runs (`cl-20260422-*`) were invoking the `Skill` tool despite being spawned with a restricted `--tools read,grep,find,ls,bash` whitelist. Root cause: the CLI `--tools` parsing happened at the CLI layer, but `createAgentSession(...)` internally auto-activated:

- Built-in `Skill` tool (hardcoded always-on)
- Any extension tool whose extension had declared `autoActivate`

Even when the caller explicitly restricted the tool list, these two auto-activation paths added back tools the caller had tried to exclude. The symptom is most visible in `phase-discipline` reviewers and in `composed-lite` scout/design/reviewer subagents, but affects every `--tools`-restricted subagent user in the codebase.

## 2. Design

### 2.1 Contract changes

**New option on `CreateAgentSessionOptions`:**

```ts
interface CreateAgentSessionOptions {
  // ... existing fields
  includeBuiltInSkillTool?: boolean;          // default: true (preserves current behaviour)
  autoActivateNewExtensionTools?: boolean;    // default: true (preserves current behaviour)
}
```

When both are set to `false`, the created session:

- Does not expose the built-in `Skill` tool
- Does not auto-activate any extension tool not in the explicit `tools` list
- Honours the exact `tools` array passed by the caller

**Derivation at CLI layer:**

`resolveCreateAgentSessionToolOptions(argv)` in `cli-web-branch.ts` parses `--tools` and returns:

```ts
{
  tools: string[] | undefined;                // built-in tool names (read, grep, find, ls, bash, edit, write, skill, …)
  extraToolNames: string[];                   // extension tool identifiers (extension:tool-name form)
  includeBuiltInSkillTool: boolean;           // false if --tools is set AND "skill" is not in the list
  autoActivateNewExtensionTools: boolean;     // false if --tools is set (caller knows what they want)
}
```

When `--tools` is **not** passed, the helper returns `undefined` for `tools`/`extraToolNames` and `true` for both boolean flags — byte-identical to current behaviour.

### 2.2 File-by-file changes (diff sizes confirmed 2026-04-23 against `feat/composed-lite-runtime-owned`)

| File | Role | Rough size |
|---|---|---|
| `@/Users/sheng/tencent/gsd-2/src/cli.ts` | Call helper in print mode; spread resolved options into `createAgentSession(...)` | ~18 lines net |
| `@/Users/sheng/tencent/gsd-2/src/cli-web-branch.ts` | Add `resolveCreateAgentSessionToolOptions` + `--tools` parser; normalise built-in vs extension tool names | ~65 lines net |
| `@/Users/sheng/tencent/gsd-2/packages/pi-coding-agent/src/core/sdk.ts` | Accept new options on `CreateAgentSessionOptions`; thread to `AgentSessionConfig` | ~5 lines net |
| `@/Users/sheng/tencent/gsd-2/packages/pi-coding-agent/src/core/agent-session.ts` | Honour `includeBuiltInSkillTool=false` and `autoActivateNewExtensionTools=false`; skip auto-reactivation | ~34 lines net |

The `feat/composed-lite-runtime-owned` branch already has the exact code for all four files; this spec is the contract layer underneath that existing implementation. PR-1 is the forward port.

### 2.3 Default behaviour preservation

The two new options default to `true`. Every existing caller that does not pass them observes byte-identical behaviour. Only the CLI `--tools` path (which itself is opt-in) triggers the restricted mode.

## 3. Testing strategy

| Layer | Coverage |
|---|---|
| Unit — `cli-web-branch.ts` | `resolveCreateAgentSessionToolOptions` covers: no `--tools` → both flags true; `--tools read,grep` → both flags false, skill excluded; `--tools read,grep,skill` → `includeBuiltInSkillTool=true`, `autoActivateNewExtensionTools=false`; extension-qualified tool names parsed correctly |
| Unit — `sdk.ts` | Passing `includeBuiltInSkillTool=false` disables Skill tool in the resulting session config |
| Unit — `agent-session.ts` | Restricted mode does not re-activate extension tools during session setup |
| Integration — print mode | `gsd --tools read,grep,find,ls,bash -p "..."` does not expose Skill; verified by inspecting agent session's enabled tool list |
| Regression | Every existing test that exercises default mode passes unchanged |

## 4. Migration plan — 1 PR

Single PR because the change is mechanical and localised to 4 files. No schema changes, no config changes, no public-API breaking changes.

**Rollout order:**

1. Land `sdk.ts` + `agent-session.ts` changes together (the SDK contract extension)
2. Wire `cli-web-branch.ts` helper
3. Wire `cli.ts` to call the helper
4. Add unit + integration tests

All 4 files land atomically in one PR because they are tightly coupled (no intermediate state is useful).

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | Adding fields to `CreateAgentSessionOptions` breaks downstream consumers that treat the type as closed | Fields are optional with permissive defaults; type widens only |
| **R-2** | `--tools` parser misclassifies an extension tool as built-in (or vice versa) | Normalise explicitly: names without `:` are built-in; names with `:` are extension-qualified. Covered by unit tests |
| **R-3** | An extension that relied on auto-activation silently loses its tool when a caller uses `--tools` | This is the intended behaviour; `--tools` is an opt-in restrictive flag. Document in help text that `--tools` is exhaustive when set |
| **R-4** | Skill tool hardcoded always-on elsewhere in the codebase | Grep confirms the only always-on path is inside `agent-session.ts`; fix is localised. No other hardcoded `enable("skill")` path exists on `main` |

## 6. Open questions (none blocking v1)

- Whether `--tools` should also accept `all` / `default` as explicit mode selectors (v1 treats missing `--tools` as "default"; `all` is equivalent to no flag)
- Whether extension tool names should support wildcard matching (e.g. `gsd:*`) — defer to v1.1 based on user feedback

## 7. Change log

| Version | Date | Summary |
|---|---|---|
| **v1** | 2026-04-23 | Extracted from v5 composed-lite-harness-brainstorm §4.6 / §8 PR-1 during v6 rewrite. 4-file chain verified on `main` (all partial or absent); reference implementation exists on `feat/composed-lite-runtime-owned` |
