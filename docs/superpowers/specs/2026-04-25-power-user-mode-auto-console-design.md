# Power User Mode Auto Console Redesign (v1.0)

> **Origin**
> - Requested on 2026-04-25 after validating the current Power User Mode against `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`.
> - The previous v1.1 context-first refresh improved status readability, but the user clarified that their real need is not a better dual-terminal layout. They want a first-class, default-on surface that shows what auto-mode is actually doing: phases, thinking, tool calls, streaming assistant output, waits, and failures.
> - The user explicitly stated they rarely intervene manually and only need interactive controls during exceptional situations. This redesign therefore repositions Power User Mode from a terminal-first split view to an auto-mode-first execution console with secondary recovery surfaces.

## 0. Summary & scope

### What we are building

A redesigned `Power User Mode` that defaults to a structured **Auto Mode Console** rather than two peer terminals.

The redesigned page will present:

- a top-level auto runtime context strip,
- a central live execution stream that reads like a structured TUI pipeline,
- reuse of the existing app-shell milestone/recovery sidebar as the primary recovery/intervention surface in v1,
- and on-demand access to the raw main-session TUI and interactive console only when needed.

The central promise of this redesign is:

- **default view answers “what auto-mode is doing now”**,
- **manual terminals become secondary tools**,
- **runtime state is visible without requiring the user to parse shell output**.

### What this round does NOT cover

- Reworking auto-mode runtime behavior or bridge protocol in the first implementation pass.
- Building a new backend event stream format before proving the front-end shape using existing structured state.
- Merging every possible log source into one mega-timeline.
- Replacing milestone sidebar information architecture.
- Adding advanced filtering/search/export on day one.
- Promising a complete reconstruction of model-internal chain-of-thought beyond what current store events already expose.

### Rejected entirely for this round

- Keeping Power User Mode as a dual-terminal-first surface and only polishing labels.
- Making the interactive terminal the main content area.
- Treating raw terminal output as the primary explanation of auto progress.
- Mixing raw PTY lines, chat transcript, visualizer metrics, and git activity into a single undifferentiated stream.

## 1. Problem statement

The current Power User Mode still behaves like a terminal workbench:

- one pane shows the main session TUI,
- one pane shows an interactive GSD terminal,
- the user must infer whether auto-mode is active by reading terminal text and surrounding UI chrome.

This is mismatched with the user’s actual workflow.

The user’s stated operating mode is:

- auto-mode should run autonomously,
- manual interaction is exceptional,
- the UI should primarily show execution flow rather than terminal affordances.

That mismatch causes five concrete problems:

1. The main surface does not directly show the auto pipeline.
2. Important execution details (thinking, tool activity, streaming output) are available in structured state but not elevated into the default Power User Mode view.
3. The page implies that manual terminal interaction is equally primary, which is misleading for mostly autonomous runs.
4. Raw terminal output dominates the screen even when the user mainly wants live execution observability.
5. Exception handling and manual recovery are not visually separated from normal auto execution.

## 2. Design goals

### Primary goals

- Make Power User Mode answer “what is auto-mode doing right now?” within 2-3 seconds.
- Make structured auto execution flow the primary surface.
- Demote manual terminals to exception/recovery tooling.
- Reuse existing structured store state before introducing new runtime protocol work.
- Keep implementation local to the Web UI in the first iteration.

### Secondary goals

- Preserve access to raw TUI and interactive terminal for debugging/recovery.
- Make active tool execution visually obvious.
- Represent waiting/idle states as intentional execution states rather than blank space.
- Keep the new surface compact enough to coexist with the existing milestone sidebar.
- Avoid duplicating status/error information already available elsewhere in the app shell.

### Non-goals

- Do not reimplement the Visualizer inside Power User Mode.
- Do not add a full observability query system in v1.
- Do not block future protocol upgrades by overfitting to current store quirks.

## 3. Proposed UX

## 3.1 Overall page model

Power User Mode becomes a three-layer runtime console:

1. **Top context strip** — global run identity and live runtime summary.
2. **Primary Auto Mode Console** — the main execution stream.
3. **Secondary Recovery / Intervention surface** — lightweight controls and exception entry points, using the existing app-shell right sidebar in v1 rather than creating a second persistent sidebar inside Power User Mode.

Raw terminals remain available, but they are not the default visual model.

## 3.2 Top context strip

The top strip remains under the page title and becomes more runtime-oriented.

It shows compact chips for:

- Project
- Auto state (`Active`, `Paused`, `Complete`, `Inactive`)
- Bridge state
- Phase
- Unit
- Active tool (when present)
- Issue summary (when present)

Rules:

- `Active tool` only renders when a tool is currently running.
- `Issue` renders a concise summary, not a repeated full banner-sized error.
- If no unit exists, omit the unit chip.
- Chips wrap instead of horizontally overflowing.
- The migrated pending-command concept from the previous design is subsumed by the auto/runtime chips and should not compete with the new `Active tool` chip.

## 3.3 Primary Auto Mode Console

This becomes the dominant central surface.

### Title and framing

The main panel header reads:

- Title: `Auto Mode Console`
- Subtitle: `Live auto-mode execution stream`

This panel is read-only and auto-following by default.

### Timeline content model

The console renders a chronological structured stream composed of the following item types:

- `thinking`
- `assistant-output`
- `tool-running`
- `tool-completed`
- `ui-request`
- `waiting-tail`
- `status`
- `error`
- optional `phase-marker` if phase transitions can be derived reliably from snapshot diffing without introducing duplicate or noisy markers

These are not chat bubbles. They should read like a live execution pipeline.

### Visual hierarchy

- **Phase markers**
  - strong separators with compact labels such as `Admission`, `Research`, `completing-milestone`.
- **Thinking**
  - visually lighter, more compressed, clearly secondary to final assistant output.
- **Assistant output**
  - primary readable body text.
- **Tool running**
  - spinner + tool name + most relevant short arg summary.
- **Tool completed**
  - collapsible structured result block.
- **Waiting**
  - explicit neutral state such as `Waiting for next auto event…`.
- **Error**
  - elevated, readable failure block without forcing users into terminal parsing.

### Scroll behavior

- Auto-scroll follows new events by default.
- If the user scrolls upward, auto-follow pauses.
- A `Jump to latest` affordance appears while not following.
- Returning to bottom re-enables follow mode.

### Empty and idle states

- If auto has not produced execution events yet, the console shows a semantic placeholder rather than blank terminal space.
- If auto is alive but temporarily inactive, show `Waiting for next auto event…`.
- If auto is paused, show a pause state rather than an empty stream.

## 3.4 Recovery / Intervention surface

The default recovery surface should not duplicate the app-shell's existing right-side milestone/recovery information architecture.

In v1:

- keep the existing `MilestoneExplorer` / recovery sidebar in `app-shell.tsx`,
- treat that existing sidebar as the persistent recovery/intervention surface,
- and add Power User Mode-specific intervention actions inside the main console header or local action bar.

### Default sidebar content

Across the existing app-shell right sidebar plus local Power User Mode actions, the user should have access to:

- current milestone / slice / task context,
- validation or recovery summary,
- recent issues / blocking state,
- `Open Interactive Console`,
- `View Raw TUI`,
- `Stop Auto`.

### Interaction philosophy

The sidebar is not the default work area. It is an exception-handling surface.

The intended reading order is:

- watch the Auto Mode Console,
- glance right for state and exception controls,
- open recovery surfaces only when something goes wrong or intervention is required.

## 3.5 Interactive console behavior

The interactive GSD terminal remains available, but only on demand.

When `Open Interactive Console` is used:

- a secondary overlay/panel or collapsible diagnostic region opens,
- but the default Power User Mode layout should not permanently dedicate half the screen to this terminal.

The interaction surface should preserve the existing `ShellTerminal` workflow and transport behavior.

v1 does not need to guarantee preserved client-side scrollback across open/close cycles. It may lazily mount the console when opened, provided the session identity remains stable and reconnect behavior is explicit.

## 3.6 Raw Main Session TUI behavior

The raw main-session TUI also remains available, but only as a diagnostic surface.

Recommended presentation:

- button or toggle: `View Raw TUI`
- opens an on-demand surface such as a drawer, sheet, or collapsible diagnostic region

This preserves deep debugging value without letting raw terminal output dominate the main experience.

v1 may mount the raw TUI lazily on first open. If that means previous client-side scrollback is not preserved, the UI should not imply otherwise.

## 4. Data sources and state mapping

## 4.1 First-iteration data strategy

The first implementation should rely on the **existing structured Web store state** rather than new backend APIs.

Before implementing the Auto Mode Console UI, perform a real-run validation to confirm that auto-mode execution events actually arrive in the current Web store via `/api/session/events` for the session Power User Mode is observing.

If that validation shows the store does **not** reliably receive auto-mode thinking/message/tool events, Stage 1 must degrade gracefully:

- keep the runtime-first layout,
- use current phase/unit/bridge/status snapshots as the primary signal,
- and defer full structured execution streaming to Stage 2 protocol work.

The store already contains the necessary building blocks:

- `streamingAssistantText`
- `streamingThinkingText`
- `liveTranscript`
- `currentTurnSegments`
- `completedTurnSegments`
- `activeToolExecution`
- `completedToolExecutions`
- `pendingUiRequests`
- `statusTexts`
- `widgetContents`
- `boot.auto`
- `boot.workspace`
- `boot.bridge`
- `live.workspace`
- `lastBridgeError`
- `lastClientError`

Important limitation:

- `liveTranscript` is capped by `MAX_TRANSCRIPT_BLOCKS`
- `completedToolExecutions` is capped to a rolling window of recent items

Therefore, the Auto Mode Console in v1 is a **recent rolling execution stream**, not a complete audit log.

## 4.2 Reuse model

The implementation should reuse the **timeline derivation idea** already present in `web/components/gsd/chat-mode.tsx`, where structured assistant/tool/thinking state is assembled into a chronological list.

However:

- reuse the **data derivation approach**,
- do **not** reuse the chat UI as-is.

The Auto Mode Console must have its own visual language oriented around execution flow, not chat conversation.

## 4.3 Timeline item derivation

A dedicated selector/helper should derive a unified `AutoModeTimelineItem[]` from store state.

Candidate item types:

- `thinking`
- `message`
- `tool`
- `active-tool`
- `ui-request`
- `waiting-tail`
- `status`
- `error`
- optional `phase-marker` if phase transitions can be derived reliably from snapshot diffing without introducing duplicate or noisy markers

Rules:

- Preserve chronological ordering of current and completed turn segments.
- Promote active tool execution into a visually distinct running item.
- Convert pure “stream alive but silent” states into an explicit waiting-tail state rather than persisting synthetic waiting entries throughout history.
- Avoid duplicate rendering of the same failure across top strip, sidebar, and timeline.
- Prefer the current phase in the top strip over synthetic phase markers if transition evidence is incomplete.

## 4.4 Explicit boundary

The first version should **not** attempt to merge every possible source into one stream.

Do not directly mix these into the main timeline:

- raw PTY terminal lines,
- generic activity log terminal lines,
- Visualizer unit history,
- arbitrary git operations,
- unrelated bridge summary lines.

The main timeline should remain focused on **structured assistant/tool/thinking execution flow**.

In v1, the timeline must not claim to be a complete replay of all auto internals. It should explicitly represent the structured state currently exposed by the store.

## 5. Component architecture

## 5.1 Replace `DualTerminal` with a new runtime-first container

`web/components/gsd/dual-terminal.tsx` should no longer act as a symmetrical split-terminal shell.

It should become the composition root for:

- top context strip,
- Auto Mode Console,
- local intervention actions,
- on-demand interactive console surface,
- on-demand raw TUI surface.

It should **not** create a second always-visible right sidebar in v1, because the existing app-shell milestone/recovery sidebar remains the persistent right-side surface.

If the file becomes too large, split responsibilities into focused components rather than growing `dual-terminal.tsx` again.

## 5.2 New components

Recommended new components:

- `AutoModeConsole`
- `AutoModeTimeline`
- `AutoModeTimelineItem`
- `AutoModeSidebar`
- `RawTuiDrawer` (or equivalent)
- `InteractiveConsolePanel` (or equivalent)

These names are descriptive suggestions, not mandatory exact filenames.

## 5.3 New helpers/selectors

Recommended new helpers/selectors:

- `deriveAutoModeTimeline(state)`
- `deriveAutoModeRuntimeSummary(state)`
- `deriveAutoModeIssueSummary(state)`

These should live near the web store helpers rather than inside large component bodies.

## 5.4 Existing components to reuse selectively

Reusable logic/assets:

- `ToolExecutionBlock` concepts from `chat-mode.tsx`
- existing store selectors in `gsd-workspace-store.tsx`
- current badge/chip primitives
- the previous context-strip visual primitives where still applicable

Not to reuse wholesale:

- `ChatPane` layout and bubble framing
- old left/right terminal parity model
- spinner-only empty terminal overlays as the main runtime explanation

## 5.5 Migration from the 2026-04-24 context-first refresh

The previous v1.1 context-first dual-terminal refresh is not thrown away wholesale.

Reusable pieces:

- `web/lib/power-mode-context.ts` pure mapping helpers where still applicable (`auto` state priority, short error summaries)
- chip/badge primitives from `web/components/gsd/power-mode-context.tsx`

Pieces expected to be removed or heavily repurposed:

- pane-shell / pane-header components that exist only to support the dual-terminal mental model
- the current left/right parity structure in `dual-terminal.tsx`

Test migration note:

- existing focused tests for context-strip helpers should be retained or updated when helpers survive
- new tests must center on timeline derivation and console-state behavior rather than pane chrome

## 6. State and behavior rules

## 6.1 Auto state priority

Auto state badge priority remains:

1. `auto.active === true` → `Active`
2. `auto.paused === true` → `Paused`
3. `workspace.active.phase === "complete"` → `Complete`
4. otherwise → `Inactive`

## 6.2 Waiting state rules

The timeline should render explicit waiting states when:

- bridge/session is connected,
- there is no active tool,
- no new streaming text or thinking is arriving,
- and auto is still considered active or in-progress.

This avoids the “blank screen means broken” problem.

Waiting in v1 should be rendered as a **tail placeholder**, not as a historical timeline item inserted repeatedly between events.

The UI should only show the waiting-tail state after a small inactivity threshold (recommended baseline: about 1.5-2 seconds without new structured execution events).

## 6.3 Intervention visibility rules

- Interactive console is hidden by default.
- Raw TUI is hidden by default.
- Exceptions/recovery affordances remain visible even when the sidebar is compact.
- Error states should make manual entry points more obvious, but should not auto-open terminals unless explicitly designed to do so.
- v1 may lazily mount the interactive console and raw TUI when opened; if so, the product copy should not imply guaranteed preserved scrollback.

## 6.4 Deduplication rules

- Top strip shows concise run-level summary.
- Main timeline shows detailed execution flow.
- Existing app-shell right sidebar shows recovery-centric summaries and controls.
- The same full error body should not appear in all three places simultaneously.
- Active tool name should have a single primary source of truth in the main timeline; the top strip may show ambient tool state, but should avoid repeating the same verbose tool summary when the main timeline item is already visible.

## 7. Testing and validation

## 7.1 Automated tests

Add focused tests for:

- timeline derivation ordering,
- active-tool rendering conditions,
- waiting-state insertion,
- phase/unit summary mapping,
- deduplication between timeline/summary/sidebar surfaces.

Add a pre-implementation validation check for Stage 1:

- verify, during a real auto run, whether the current Web store receives auto-mode message/tool events via `/api/session/events`
- if it does not, update the implementation plan to use the degraded Stage 1 snapshot-first experience instead of pretending structured event streaming is already available

## 7.2 Component behavior tests

At minimum verify:

- empty console state,
- streaming thinking state,
- active tool block state,
- completed tool block state,
- hidden-by-default interactive console,
- hidden-by-default raw TUI.

## 7.3 Manual validation scenarios

Validate these scenarios against a real auto run:

1. **Normal execution**
   - phase changes appear,
   - tools run and complete,
   - assistant text streams into the console.

2. **Silent-but-active period**
   - the main surface shows a waiting state, not a blank panel.

3. **Error or pause**
   - the console shows a readable error/pause state,
   - the sidebar exposes recovery/intervention affordances clearly.

4. **Manual takeover**
   - the interactive console can be opened on demand,
   - the raw TUI can be opened on demand,
   - neither becomes the default view again.

## 8. Rollout strategy

Recommended rollout in two stages.

### Stage 1

- Verify that the current Web store really receives auto-mode structured execution events.
- Build the runtime-first layout using existing structured store state if that validation passes.
- Keep backend APIs unchanged.
- Validate that the console already provides a significantly better auto-mode experience.

### Stage 2 (only if needed)

- Add richer runtime event types if the current store does not expose enough pipeline semantics or if Stage 1 validation shows the structured event stream does not reliably cover auto-mode execution.
- Consider filters/search/advanced observability only after Stage 1 proves the core interaction model.

## 9. Risks and mitigations

### Risk: looks too much like chat UI

Mitigation:

- Use execution-oriented framing, block labels, and phase markers.
- Avoid user/assistant conversational styling as the dominant metaphor.

### Risk: structured store data is incomplete for some runs

Mitigation:

- Keep raw TUI available as fallback.
- Preserve room for Stage 2 protocol enhancements.

### Risk: too much information duplication

Mitigation:

- Explicit separation of responsibilities:
  - top strip = concise runtime summary
  - main console = execution stream
  - sidebar = recovery/intervention

### Risk: manual controls become too hidden

Mitigation:

- Sidebar always keeps visible intervention entry points.
- Do not bury `Stop Auto`, recovery summary, or open-console actions behind deep menus.

## 10. Success criteria

This redesign is successful if a user can open Power User Mode during an autonomous run and immediately understand:

- whether auto is active,
- which phase/unit it is on,
- what it is currently doing,
- which tool is running or just ran,
- whether it is waiting, progressing, paused, or failing,
- and where to intervene only if intervention is actually needed.

A successful implementation should make the default experience feel like a **live auto execution console**, not a pair of terminals waiting for interpretation.
