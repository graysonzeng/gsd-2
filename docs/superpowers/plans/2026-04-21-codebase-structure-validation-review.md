# Codebase Structure Validation Review Checklist

> Validation-only artifact. No source edits planned.

## Review Targets
- `package.json`
- `src/loader.ts`
- `src/cli.ts`
- `src/headless.ts`
- `src/mcp-server.ts`
- `packages/pi-coding-agent/package.json`
- `packages/pi-agent-core/package.json`
- `packages/pi-ai/package.json`
- `packages/pi-tui/package.json`
- `packages/native/package.json`
- `packages/mcp-server/package.json`
- `packages/rpc-client/package.json`
- `packages/daemon/package.json`
- `web/package.json`
- `studio/package.json`
- `native/Cargo.toml`

## Checklist

### Entrypoints
- [ ] CLI entry is rooted at `src/loader.ts` via root `package.json#bin`.
- [ ] Main command dispatch continues in `src/cli.ts`.
- [ ] Headless and MCP modes have distinct entry modules.

### Monorepo structure
- [ ] Root npm workspaces include `packages/*` and `studio`.
- [ ] Core agent logic is split across `pi-coding-agent`, `pi-agent-core`, `pi-ai`, and `pi-tui`.
- [ ] Native functionality is isolated behind `@gsd/native`.

### Extension architecture
- [ ] Product-specific behavior is concentrated under `src/resources/extensions/**`.
- [ ] GSD workflow logic lives primarily in `src/resources/extensions/gsd/**`.
- [ ] Browser automation is isolated in `src/resources/extensions/browser-tools/**`.

### Platform surfaces
- [ ] MCP server is published separately from the main CLI.
- [ ] Web UI and Electron studio are separate applications.
- [ ] Rust crates provide performance-sensitive capabilities.

### Dependency / stack mapping
- [ ] Node 22+ and TypeScript are required.
- [ ] AI providers include Anthropic, OpenAI, Google, Bedrock, and Mistral SDKs.
- [ ] Browser automation uses Playwright.
- [ ] Web app uses Next.js + React.
- [ ] Desktop app uses Electron + React.

## Decision Rule
If all checklist items are confirmed by manifests and file layout, the structure scan is complete with no code changes.
