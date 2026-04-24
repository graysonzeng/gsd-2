# Power User Mode Auto Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dual-terminal-first Power User Mode with a runtime-first Auto Mode Console that shows structured execution flow by default, while keeping manual consoles available as on-demand diagnostics.

**Architecture:** Keep `app-shell.tsx` and its existing milestone/recovery sidebar intact. Rebuild `web/components/gsd/dual-terminal.tsx` into a Power User Mode composition root with three local surfaces: top runtime context strip, central Auto Mode Console, and collapsible diagnostic consoles. Derive timeline items from `gsd-workspace-store` structured state first, then fall back to status/widget/runtime snapshots when the structured stream is sparse.

**Tech Stack:** Next.js / React, TypeScript, existing `gsd-workspace-store` state model, shadcn `Collapsible`, existing Power Mode badge primitives, existing xterm-based `MainSessionTerminal` and `ShellTerminal`.

---

## File map

### Existing files to modify

- `web/lib/power-mode-context.ts`
  - Expand from chip/pane mappings into runtime summary + timeline derivation helpers for Auto Mode Console.
- `web/lib/__tests__/power-mode-context.test.ts`
  - Add focused tests for timeline ordering, waiting-tail insertion, and runtime fallback summaries.
- `web/components/gsd/dual-terminal.tsx`
  - Replace dual-pane layout with Auto Mode Console + collapsible diagnostics.
- `web/components/gsd/power-mode-context.tsx`
  - Reuse `PowerModeChip`; add any lightweight console UI atoms that belong with Power Mode chrome.

### New files to create

- `web/components/gsd/auto-mode-console.tsx`
  - Main runtime-first console surface and timeline renderer.

### Existing files to keep unchanged in v1

- `web/components/gsd/app-shell.tsx`
  - Keep existing right milestone/recovery sidebar.
- `web/components/gsd/main-session-terminal.tsx`
  - Reuse as collapsible raw diagnostic console.
- `web/components/gsd/shell-terminal.tsx`
  - Reuse as collapsible interactive console.

---

### Task 1: Add timeline derivation helpers and tests

**Files:**
- Modify: `web/lib/power-mode-context.ts`
- Test: `web/lib/__tests__/power-mode-context.test.ts`

- [ ] **Step 1: Add failing tests for Auto Mode Console timeline derivation**

Add tests covering:

- ordered thinking/text/tool projection from `currentTurnSegments`
- active-tool projection
- waiting-tail when auto is active but stream is silent
- no waiting-tail when there is active tool or live streaming text
- fallback runtime summary using phase/unit/status text

- [ ] **Step 2: Run focused test file and confirm failures point to missing helpers**

Run: `node --experimental-strip-types --test web/lib/__tests__/power-mode-context.test.ts`

Expected: FAIL with missing exports or assertion failures for new timeline helper behavior.

- [ ] **Step 3: Implement minimal helper types and selector logic**

In `web/lib/power-mode-context.ts`, add:

- `AutoModeTimelineItem` union
- `deriveAutoModeRuntimeSummary(state)`
- `deriveAutoModeTimeline(state, now?)`
- helper functions for active tool labels, waiting-tail gating, and fallback status/widget items

Design constraints:

- Prefer structured stream content from `completedTurnSegments`, `currentTurnSegments`, `streamingThinkingText`, `streamingAssistantText`, and `activeToolExecution`
- Add `waiting-tail` only as a trailing item when stream is otherwise silent
- If structured stream is sparse, allow runtime fallback items sourced from `statusTexts`, `widgetContents`, `workspace.active.phase`, and visible error summary

- [ ] **Step 4: Re-run focused tests and make them pass**

Run: `node --experimental-strip-types --test web/lib/__tests__/power-mode-context.test.ts`

Expected: PASS, including the new timeline/fallback cases.

### Task 2: Build the Auto Mode Console component

**Files:**
- Create: `web/components/gsd/auto-mode-console.tsx`
- Modify: `web/components/gsd/power-mode-context.tsx`
- Test: `web/lib/__tests__/power-mode-context.test.ts`

- [ ] **Step 1: Add any small Power Mode atoms needed for console blocks**

In `web/components/gsd/power-mode-context.tsx`, add only tiny reusable atoms if they help multiple timeline items (for example: a compact section label or a shared tone class helper). Do not reintroduce pane-specific chrome.

- [ ] **Step 2: Implement `AutoModeConsole` using the new selector**

Create `web/components/gsd/auto-mode-console.tsx` with:

- header: `Auto Mode Console` + `Live auto-mode execution stream`
- auto-follow scroll container
- rendering for timeline item kinds:
  - `thinking`
  - `message`
  - `tool`
  - `active-tool`
  - `ui-request`
  - `status`
  - `error`
  - `waiting-tail`
- empty/idle placeholders

Reuse styling ideas from `chat-mode.tsx` tool blocks, but avoid chat-bubble framing.

- [ ] **Step 3: Keep the console read-only**

Do not include chat input, prompt submission, or terminal keystroke interactions in the new component.

- [ ] **Step 4: Smoke-check types**

Run: `npx tsc --noEmit --project web/tsconfig.json`

Expected: PASS.

### Task 3: Replace dual-pane Power User Mode with runtime-first layout

**Files:**
- Modify: `web/components/gsd/dual-terminal.tsx`
- Reuse: `web/components/gsd/main-session-terminal.tsx`
- Reuse: `web/components/gsd/shell-terminal.tsx`

- [ ] **Step 1: Remove the split-pane drag layout**

Delete the left/right terminal parity layout from `dual-terminal.tsx`.

- [ ] **Step 2: Rebuild `DualTerminal` as the Power User Mode composition root**

The new layout should contain:

- title row: `Power User Mode`
- runtime context strip with `Project`, `Auto`, `Bridge`, `Phase`, `Unit`, optional `Tool`, optional `Issue`
- central `AutoModeConsole`
- local action row for diagnostics
- collapsible `Interactive Console`
- collapsible `Raw Main Session TUI`

The main content priority should be:

1. Auto console
2. Intervention actions
3. Diagnostic consoles only when opened

- [ ] **Step 3: Make diagnostics hidden by default**

Use existing `Collapsible` UI primitives so:

- `Interactive Console` is closed by default
- `Raw Main Session TUI` is closed by default
- both can be opened independently

- [ ] **Step 4: Preserve terminal stability**

Keep stable `key` handling for project-scoped terminal remounts, and pass the existing status callbacks through unchanged.

- [ ] **Step 5: Run typecheck again**

Run: `npx tsc --noEmit --project web/tsconfig.json`

Expected: PASS.

### Task 4: Verify and polish the v1 fallback behavior

**Files:**
- Modify: `web/components/gsd/auto-mode-console.tsx`
- Modify: `web/components/gsd/dual-terminal.tsx`
- Test: `web/lib/__tests__/power-mode-context.test.ts`

- [ ] **Step 1: Ensure sparse-structured-stream runs still show useful runtime state**

If timeline has no structured items, the console must still render phase/unit/status/error context derived from runtime snapshots, not an empty black area.

- [ ] **Step 2: Ensure active-tool duplication is controlled**

Timeline should remain the primary tool surface. The top strip may show a short ambient tool chip, but should not repeat long summaries already visible in the console.

- [ ] **Step 3: Re-run focused tests**

Run: `node --experimental-strip-types --test web/lib/__tests__/power-mode-context.test.ts`

Expected: PASS.

- [ ] **Step 4: Run targeted ESLint + typecheck**

Run:

`npx eslint web/components/gsd/dual-terminal.tsx web/components/gsd/auto-mode-console.tsx web/components/gsd/power-mode-context.tsx web/lib/power-mode-context.ts web/lib/__tests__/power-mode-context.test.ts`

`npx tsc --noEmit --project web/tsconfig.json`

Expected: both PASS.

### Task 5: Manual runtime verification against the live isolated project

**Files:**
- No code changes required unless issues are found.

- [ ] **Step 1: Restart the standalone web host if needed**

Run the existing local web flow against `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`.

- [ ] **Step 2: Verify Power User Mode default view**

Confirm that the page now shows:

- runtime context strip
- Auto Mode Console as the dominant surface
- no default side-by-side terminals
- collapsible intervention/diagnostic consoles closed by default

- [ ] **Step 3: Verify sparse-stream fallback**

During a run or paused state, confirm the page still shows meaningful runtime state (`phase`, `unit`, waiting/error/status text) even if no structured tool/message stream is visible.

- [ ] **Step 4: Verify diagnostics**

Open both:

- `Interactive Console`
- `Raw Main Session TUI`

Confirm they still attach and render when manually opened.
