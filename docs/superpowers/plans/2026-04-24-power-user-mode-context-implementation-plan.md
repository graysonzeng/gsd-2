# Power User Mode Context Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Power User Mode understandable at a glance by adding context strip, pane chrome, and semantic status/empty states without changing runtime behavior.

**Architecture:** Keep `DualTerminal` as the composition root. Add small presentation helpers plus upward status callbacks from `MainSessionTerminal` and `ShellTerminal`. Reuse existing workspace-store selectors for global state, and add focused tests only for status mapping logic.

**Tech Stack:** Next.js, React, TypeScript, Tailwind/shadcn tokens, xterm.js, node:test

---

## File map

- Modify: `web/components/gsd/dual-terminal.tsx`
- Modify: `web/components/gsd/main-session-terminal.tsx`
- Modify: `web/components/gsd/shell-terminal.tsx`
- Create: `web/components/gsd/power-mode-context.tsx`
- Create: `web/lib/__tests__/power-mode-context.test.ts`
- Modify: `docs/superpowers/specs/2026-04-24-power-user-mode-context-design.md`

### Task 1: Add presentation helpers and mapping utilities

- [ ] Add `web/components/gsd/power-mode-context.tsx` with compact chips/badges/pane header helpers and pure mapping functions for auto status + error prioritization.
- [ ] Add focused tests in `web/lib/__tests__/power-mode-context.test.ts` for auto-state priority and error-dedupe logic.

### Task 2: Wire context strip into `DualTerminal`

- [ ] Replace the current header-only layout in `web/components/gsd/dual-terminal.tsx` with title row + context strip + pane chrome.
- [ ] Migrate the existing pending-command chip into the context strip while preserving `data-testid="power-mode-pending-command"`.
- [ ] Add `data-testid` and ARIA labels for the context strip and both panes.

### Task 3: Surface left-pane connection state

- [ ] Add a minimal upward status callback to `web/components/gsd/main-session-terminal.tsx` exposing `connecting|connected|error` plus `hasOutput`.
- [ ] Update empty overlays so left-pane waiting states are semantic (`Connecting`, `Reconnecting`, `Waiting for output`).

### Task 4: Surface right-pane status without parsing terminal output

- [ ] Add a minimal upward status callback to `web/components/gsd/shell-terminal.tsx` exposing active-tab connection and startup state.
- [ ] Keep the existing tab sidebar; do not parse PTY output into structured warnings.

### Task 5: Verify

- [ ] Run focused tests for the new mapping logic.
- [ ] Run a project typecheck or targeted test command if needed to catch TS regressions.
- [ ] Open the live Web UI and verify Power User Mode against real runtime state.
