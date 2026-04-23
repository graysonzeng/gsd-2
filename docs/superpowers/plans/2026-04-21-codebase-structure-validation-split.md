# Codebase Structure Validation Split

> Minimal split artifact for validation-only work.

## Recommended Split
If this validation needed to be divided later, split by architectural layer rather than by feature.

### Track A — Boot and core runtime
Files:
- `package.json`
- `src/loader.ts`
- `src/cli.ts`
- `src/headless.ts`
- `packages/pi-coding-agent/**`
- `packages/pi-agent-core/**`
- `packages/pi-ai/**`
- `packages/pi-tui/**`

Purpose:
- validate CLI entrypoints
- validate agent core ownership
- validate provider/runtime/TUI layering

### Track B — Extensions and platform edges
Files:
- `src/resources/extensions/**`
- `packages/mcp-server/**`
- `packages/rpc-client/**`
- `packages/daemon/**`
- `native/**`
- `web/**`
- `studio/**`

Purpose:
- validate extension-first architecture
- validate MCP/integration boundaries
- validate native/web/desktop technology surfaces

## Why this split
- Follows existing repo boundaries.
- Separates core runtime internals from external surfaces and adapters.
- Keeps validation read-only and avoids inventing new ownership lines.

## No-edit rule
Both tracks are review/verification only. No source-file edits are part of this split.
