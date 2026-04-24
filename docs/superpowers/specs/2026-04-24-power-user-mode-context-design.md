# Power User Mode Context-First UI Refresh (v1.1)

> **Origin**
> - Requested on 2026-04-24 after validating the Web UI against `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`.
> - Problem observed in `web/components/gsd/dual-terminal.tsx`: the current Power User Mode renders as a bare split terminal with minimal identity and no first-class status/context summary, so users must infer state from terminal body text.
> - Revised to v1.1 on 2026-04-24 after internal design review to tighten error dedupe, pane-height constraints, status mapping priority, and implementation boundaries.

## 0. Summary & scope

### What we are building

A small, context-first visual refresh for Power User Mode that keeps the existing dual-terminal interaction model intact while making the page readable at a glance.

The refresh adds:

- A top-level context strip for project/run/auto status.
- Lightweight pane headers for the left and right terminals.
- Elevated summaries for recent errors and connection state.
- Semantic empty/connecting states so blank terminal space no longer looks broken.
- Explicit de-duplication rules so the new surface does not repeat status and error information already rendered elsewhere in the app shell.

### What v1.1 does NOT cover

- Replacing the dual-terminal layout.
- Reworking milestone sidebar information architecture.
- Changing phase-discipline runtime behavior.
- Replacing terminal content with custom timeline/dashboard widgets.
- Large responsive redesign beyond making the existing surface more legible.
- Parsing PTY/stdout content into structured warning cards.

### Rejected entirely for this round

- Hiding terminal output behind cards or tabs.
- Moving Power User Mode away from a terminal-first workflow.
- Mixing runtime fixes with UI readability fixes.

## 1. Problem statement

The current implementation in `web/components/gsd/dual-terminal.tsx` renders:

- a single top header (`Power User Mode` + `Left: Main Session TUI | Right: Interactive GSD`), and
- two raw terminal panes separated by a draggable divider.

This causes four usability problems:

1. Users cannot quickly determine the global run context.
2. Users cannot easily distinguish pane identity from pane content.
3. Error/warning semantics are buried inside terminal output, so the UI itself appears broken.
4. Large blank areas in terminals look like rendering failure instead of legitimate idle/connecting states.

## 2. Design goals

### Primary goals

- Make Power User Mode understandable within 2-3 seconds.
- Separate UI state from terminal body content.
- Preserve existing terminal workflows and server APIs.
- Keep implementation local to the web UI layer.

### Secondary goals

- Reuse already-available workspace/bridge/auto state instead of inventing new APIs.
- Make provider/runtime failures visually legible without over-alerting.
- Improve confidence when no active auto run exists.
- Preserve current xterm attach behavior by keeping pane chrome compact and stable.

## 3. Proposed UX

## 3.1 Global context strip

A new strip appears under the Power User Mode title row and above the split panes.

It shows compact badges/chips for:

- Project name
- Auto state (`active`, `paused`, `complete`, `inactive`)
- Current phase
- Current unit (if any)
- Pending command (if any)
- Most recent error summary (if any)

Rules:

- If `workspace.commandInFlight` is set, show a highlighted pending-command chip.
- If there is a recent bridge/client error, show a red-tinted error chip with a short summary.
- If no current unit exists, omit the chip instead of rendering placeholder noise.
- The existing pending-command badge in the title row is migrated into the context strip rather than duplicated; the migrated element keeps the existing `data-testid="power-mode-pending-command"` hook.
- The context strip uses existing theme tokens and wraps instead of horizontally overflowing.

### Auto state mapping priority

The auto-status badge must use explicit priority rules:

1. `auto.active === true` → `Active`
2. `auto.paused === true` → `Paused`
3. `workspace.active.phase === "complete"` → `Complete`
4. otherwise → `Inactive`

`Paused` must outrank `Inactive` to avoid repeating the current dashboard ambiguity.

### Error/status de-duplication rules

The Power User Mode refresh must not blindly repeat every existing app-level status surface.

Rules:

- If `getVisibleWorkspaceError()` is already shown by the surrounding app shell banner, the context strip should either omit the duplicate error chip or render a shorter label derived from the same source without repeating the full message.
- Pane summaries should show pane-local state first, not the full global workspace error.
- The right pane must not promote arbitrary terminal stdout warnings into structured UI summaries.

## 3.2 Pane headers

Each terminal pane gets its own lightweight header.

### Left pane header

For `MainSessionTerminal`:

- Title: `Main Session TUI`
- Subtitle: `Primary auto session output`
- Status badge: `Connecting`, `Connected`, or `Error`
- Optional short run/session hint if available

### Right pane header

For `ShellTerminal` in interactive GSD mode:

- Title: `Interactive GSD`
- Subtitle: `Manual recovery and command input`
- Status badge derived from terminal/tab connection state
- Optional current command label when relevant

These headers clarify identity before the user reads terminal text.

## 3.3 Elevated status messaging

Terminal content remains unchanged, but the UI surfaces a short status summary above it.

Examples:

- `Recent error: provider temporarily unavailable`
- `Environment warning: optional search integration unavailable`
- `Ready for manual commands`

Rules:

- These are summaries, not replacements for terminal logs.
- Only one top summary per pane at a time.
- Prefer the highest-signal message: error > reconnecting > warning > idle info.

## 3.4 Semantic empty states

When a pane has no visible output yet, it should not look like a broken black rectangle.

### Left pane

Replace the current spinner-only overlay with contextual copy such as:

- `Connecting to main session…`
- `Reconnecting to main session…`
- `Main session connected — waiting for output…`

### Right pane

If the interactive terminal is connected but idle, the pane header/context should make that state explicit.

The goal is that empty space reads as intentional waiting, not failed rendering.

Layout constraints:

- The pane header + summary stack must stay compact enough that the remaining terminal body still comfortably exceeds the current xterm minimum attach size.
- Implementations should avoid variable-height stacks that can cause repeated `fit()` churn at narrow sizes.

## 4. Data sources and state mapping

No new backend APIs are required.

## 4.1 Global strip data

Use existing state from `useGSDWorkspaceState()`:

- `boot.project.cwd`
- `live.auto` / `boot.auto`
- `live.workspace.active` or boot fallback where relevant
- `commandInFlight`
- `lastBridgeError`
- `lastClientError`
- `terminalLines` for short fallback command labels (existing helper already does this)

## 4.2 Left pane status

Expose a small status surface from `MainSessionTerminal` to its parent, or derive a compact local summary in-place if the component owns the state.

Minimum state needed:

- `connecting`
- `connected`
- `error`
- `hasOutput`

## 4.3 Right pane status

Expose a lightweight status surface from `ShellTerminal` to its parent, or render an internal header in `ShellTerminal` itself.

Minimum state needed:

- whether the active tab is connected
- whether a command/session is initializing
- optional warning/info message if available

## 5. Component changes

## 5.1 `web/components/gsd/dual-terminal.tsx`

Primary container changes:

- Add a second-row global context strip beneath the title row.
- Replace raw terminal-only pane wrappers with pane chrome:
  - pane header
  - optional pane summary slot
  - terminal body
- Keep existing draggable divider and split behavior.
- Preserve or migrate the existing `power-mode-pending-command` test hook.
- Add stable test hooks for the new global strip and pane wrappers.

## 5.2 `web/components/gsd/main-session-terminal.tsx`

Add support for context-aware presentation:

- Promote current connection/empty state into clearer UI copy.
- Report connection state upward through props callback so `DualTerminal` can own the pane chrome.
- Preserve existing xterm attach/resize/input behavior unchanged.
- Keep overlays compact enough to avoid shrinking the terminal below current attach thresholds.

## 5.3 `web/components/gsd/shell-terminal.tsx`

Add minimal status surfacing for the active interactive terminal:

- current active tab connected/not connected
- header compatibility for Power User Mode embedding
- no redesign of terminal tabs or terminal instance lifecycle
- no parsing of terminal stdout/stderr into structured warnings

## 5.4 Optional shared helper

If repeated chip/status logic emerges, introduce a small local helper component in `web/components/gsd/` for:

- status badges
- context chips
- pane summaries

This helper must stay presentation-only.
It must also be theme-token-only and avoid hard-coded hex colors.

## 6. Error handling and edge cases

### No active auto run

Show:

- Auto badge as `Complete` or `Inactive` based on current workspace state.
- No current-unit chip.
- Pane summaries should remain useful even when the terminals are idle.

### Stale/partial bridge state

If bridge state exists but lacks detailed session metadata:

- Keep the UI terse.
- Do not invent placeholder identifiers.
- Prefer generic labels like `Connected` or `Waiting for output`.
- Fall back to pane-local connection state rather than exposing unknown bridge metadata.

### Long error messages

Truncate in chips/summaries to a short human-readable line.
Detailed logs remain in the terminal body.

### Narrow widths

The top context strip should wrap cleanly rather than forcing overflow.
Pane headers must remain single responsibility and avoid tall stacked layouts.

Additional narrow-width rules:

- Hide subtitles before hiding titles.
- Reduce verbose badge text before removing the underlying status indicator.
- Avoid any layout that would make the terminal body look collapsed or broken when the split is near its minimum width.

### Accessibility and observability

- Add clear `data-testid` hooks for the context strip and both pane wrappers.
- Add ARIA labels or regions for the overall context strip and each pane header.
- Preserve existing terminal focus behavior.

## 7. Testing strategy

### Manual verification

Verify in Power User Mode for at least these states:

- main terminal connecting with no output yet
- main terminal connected with output
- main terminal error/reconnect state
- interactive terminal connected and idle
- pending command in flight
- auto active
- auto paused/complete/inactive
- recent error present

### Automated verification

Add or update focused component/store tests only where they protect the new mapping logic, especially:

- auto-state label mapping
- error/summary prioritization
- pending command chip rendering conditions
- narrow-state rendering where subtitles collapse but core status remains visible

Avoid brittle snapshot-heavy tests for full terminal markup.

## 8. Implementation boundaries

This work must remain in the web presentation layer.

It must not:

- modify phase-discipline runtime behavior,
- change terminal transport APIs,
- change auth behavior,
- introduce new persisted project state,
- or hard-code colors that bypass existing theme tokens.

## 9. Recommendation

Implement the refresh as a small, complete pass centered on `DualTerminal`, with minimal supporting changes in `MainSessionTerminal` and `ShellTerminal`.

The product goal is not “make it prettier.”
The product goal is “make the runtime state legible before the user starts reading terminal text.”

## 10. Change log

| Version | Date | Notes |
|---|---|---|
| v1 | 2026-04-24 | Initial spec for context-first Power User Mode refresh: global context strip, pane headers, elevated summaries, semantic empty states. |
| v1.1 | 2026-04-24 | Tightened after internal review: explicit auto-state priority, error de-duplication, pane-height constraints, DualTerminal-owned chrome, no stdout parsing, theme/accessibility/test constraints. |
