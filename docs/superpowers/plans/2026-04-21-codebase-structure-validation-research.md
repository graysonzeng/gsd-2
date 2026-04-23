# Codebase Structure Validation Research

**Requirement:** Fresh validation run. Do not resume prior run. Do not edit source files. Produce minimal plan artifacts for research, design, review, and split.

## Summary
This repository is a TypeScript/Node monorepo for the GSD coding agent, with a thin CLI bootstrap layer, vendored core agent packages, an extension-driven runtime, optional Rust native acceleration, and separate web/Electron surfaces.

The dominant architectural pattern is **small top-level boot files delegating into workspace packages and extension modules**. Most product behavior lives in `src/resources/extensions/**` and `packages/**`, not in the root CLI files.

## Key Entry Points
- `src/loader.ts`
  - Node shebang entry.
  - Fast-paths `--help`/`--version`.
  - Sets runtime env, resource paths, workspace package linking, then imports `src/cli.ts`.
- `src/cli.ts`
  - Main CLI orchestration.
  - Boots agent session, resource loader, onboarding, update checks, print/interactive/web/headless flows.
- `src/headless.ts`
  - Headless/auto execution path.
- `src/mcp-server.ts`
  - Exposes GSD tools over MCP stdio transport.

## Main Runtime Layers
1. **CLI bootstrap layer** — `src/*.ts`
2. **Vendored pi core packages** — `packages/pi-coding-agent`, `packages/pi-agent-core`, `packages/pi-ai`, `packages/pi-tui`
3. **GSD extensions** — `src/resources/extensions/**`
4. **Native engine** — `native/crates/**` + `packages/native`
5. **External integration packages** — `packages/mcp-server`, `packages/rpc-client`, `packages/daemon`
6. **Secondary UI surfaces** — `web/` (Next.js) and `studio/` (Electron)

## Notable Architectural Patterns
- **Extension-first behavior injection**
  - Tools and workflows are registered via extension manifests and loaders.
- **Workspace-vendored platform core**
  - Pi core is vendored into local packages and branded by root bootstrapping.
- **Thin boot, deep modules**
  - Root `src/loader.ts` and `src/cli.ts` mainly coordinate setup and dispatch.
- **Native acceleration behind JS package boundary**
  - Rust crates are exposed through `@gsd/native` exports.
- **Prompt/workflow-as-resource**
  - Agents, prompts, templates, and workflow markdown live under `src/resources/**`.
- **Test-heavy regression protection**
  - Unit/integration coverage is spread across root and workspace packages.

## High-value Modules for Further Validation
- `src/resources/extensions/gsd/**`
- `src/resources/extensions/browser-tools/**`
- `packages/pi-coding-agent/src/core/**`
- `packages/pi-ai/src/providers/**`
- `native/crates/engine/src/**`
- `packages/mcp-server/src/**`

## Constraint
This is a read-only validation pass. No source edits are planned or required.
