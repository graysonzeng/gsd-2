# Codebase Structure Validation Design Note

> Validation-only artifact. No source edits planned.

## Goal
Capture the minimum architecture model needed to review the repository structure, entry points, module boundaries, and stack.

## Design
Treat the codebase itself as the source of truth and validate structure at four levels:

1. **Boot and entrypoints**
   - `src/loader.ts`
   - `src/cli.ts`
   - `src/headless.ts`
   - `src/mcp-server.ts`
2. **Core runtime packages**
   - `packages/pi-coding-agent`
   - `packages/pi-agent-core`
   - `packages/pi-ai`
   - `packages/pi-tui`
3. **Extension runtime**
   - `src/resources/extensions/gsd`
   - `src/resources/extensions/browser-tools`
   - adjacent extension packages
4. **Platform edges**
   - `packages/mcp-server`
   - `packages/rpc-client`
   - `packages/daemon`
   - `native/`
   - `web/`
   - `studio/`

## Review Method
- Use `package.json` and workspace manifests for dependency and technology mapping.
- Use top-level source files to identify runtime dispatch.
- Use directory structure to infer subsystem boundaries.
- Prefer existing file boundaries over speculative architecture diagrams.

## Expected Outcome
A reviewer should be able to answer:
- where the product starts
- which packages own core agent behavior
- where tool/runtime extensions live
- which technologies are used for CLI, AI providers, native acceleration, web, and desktop surfaces
- how the repo is split across boundaries without changing code
