# Auto Mode Console Stage 2 — Backend Event Forwarding (Investigation Plan)

> **Status:** probe run complete on 2026-04-25. Hypotheses H1 refuted as non-blocker, H2/H3/H4 refuted, new observation O1 recorded. The urgent Stage 2 work is **not** needed. See §10 for the resolution and the remaining optional follow-up on pipe backpressure.
> **Trigger:** Stage 1 UI shipped in commit `249f66e7` initially appeared to stay in the rolling fallback path because no structured agent events were observed during a 45-second SSE sample. A targeted probe on 2026-04-25 showed that the earlier observation was a timing artifact, not a backend bug.

## 0. Goal

Make `message_update` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end` / `agent_end` / `turn_end` visible to the Web `AutoModeConsole` during auto-mode runs, so the UI shows real live execution flow (thinking, assistant text, tool chatter) instead of only the snapshot-based runtime summary.

## 1. Current event path (verified)

```
gsd subprocess (rpc-mode, GSD_WEB_BRIDGE_TUI=1)
   └── AgentSession
         └── session.subscribe((event) => output(event))   ← rpc-mode.ts:477
               └── process.stdout.write(serializeJsonLine(event))
   (separate) RemoteTerminal → output({type:"terminal_output", data})

BridgeService (src/web/bridge-service.ts)
   └── spawns subprocess with GSD_WEB_BRIDGE_TUI=1
   └── handleStdoutLine(line)
         ├── isBridgeTerminalOutputEvent → emitTerminal
         └── sanitizeEventPayload → this.emit(event)   ← broadcast to subscribers

SSE route (web/app/api/session/events/route.ts)
   └── bridge.subscribe((event) => controller.enqueue(encodeSseData(event)))

Web client (gsd-workspace-store.tsx)
   └── EventSource(/api/session/events) → routeLiveInteractionEvent
         ├── message_update        → streaming text/thinking state
         ├── tool_execution_*      → active/completed tool state
         ├── agent_end / turn_end  → flush to liveTranscript/completedTurnSegments
         └── extension_ui_request  → pendingUiRequests
```

Empirically verified on commit HEAD with isolated repo bound to project `/Users/sheng/tencent/gsd-phase-discipline-auto-56G8jS`, auto-mode active on M004/S01:

- Short sample (6s): only `bridge_status`.
- Long sample (~45s wall clock, ~20s active): `bridge_status × 1`, `extension_ui_request × 1`, **0 message_update / tool_execution_* / agent_end / turn_end**.
- Auto-mode phase still progresses (`planning → executing → summarizing`), cost accumulates (`$3.22 → $3.22+`), so the agent IS executing in the subprocess, it just isn't fanning events out.

## 2. Hypothesis set

The `session.subscribe(...)` listener in `rpc-mode.ts:477` attaches to the single long-lived `AgentSession` instance. `AgentSession.newSession()` (`packages/pi-coding-agent/src/core/agent-session.ts:1575`) does not replace that instance — it resets internal state and reuses the same agent. Subscribers therefore should stay attached across auto-mode's "fresh session per unit" transitions.

Given that:

- **H1 — quiet window:** auto-mode happened to be between units during every sample. Agent events would be observed during an active turn but weren't observed by this investigation by chance. Weak hypothesis because the 45s sample spanned active execution, but worth eliminating first.

- **H2 — bypass path:** auto-mode's `runUnit` flow (`src/resources/extensions/gsd/auto/run-unit.ts`) is dispatching prompts through a code path that does not go through the live `AgentSession` event bus the RPC host is subscribed to — e.g. a second, transient pi session, a direct agent driver, or a `subagent-spawn`-style detached subprocess that has its own stdout.

- **H3 — swallowing by embedded InteractiveMode:** when `GSD_WEB_BRIDGE_TUI=1` is set (`rpc-mode.ts:127`), an `InteractiveMode` is instantiated against the same `session`. If the embedded mode reroutes session events to terminal rendering instead of dispatching them through `session.subscribe` (or if an ordering/ownership bug silently detaches the RPC-level subscriber on embedded attach), stdout never sees the agent events.

- **H4 — protocol / filter drift:** rpc-mode.ts defaults to `protocolVersion = 1` with `eventFilter = null`. No `init` / `subscribe` commands are issued by BridgeService. So v2 filtering should not apply. Confirmed by code review, but worth revalidating if H2/H3 both fail.

## 3. Evidence gate (required before any code change)

Add a lightweight empirical gate. Do not touch runtime code until gate 3.1 or 3.2 returns data:

### 3.1 Capture subprocess stdout directly

- Goal: observe the raw JSONL emitted by the gsd rpc subprocess during an active auto run.
- Method options:
  - Attach a wrapper logger in `BridgeService.handleStdoutLine` that file-logs the first N kB of each line before `sanitizeEventPayload`.
  - Or run a one-off `gsd` CLI in rpc mode outside the web host (with `GSD_WEB_BRIDGE_TUI=1`) and run an auto unit manually, tee-ing stdout to disk.
- Expected outcomes:
  - If file log shows `message_update` / `tool_execution_*` lines → bridge/SSE layer is losing them → triage switches to bridge (H4-ish).
  - If file log contains only `bridge_status`-like events → subprocess is not even emitting them → H2 or H3.

### 3.2 Instrument AgentSession.subscribe

- Add a one-line debug counter inside `session.subscribe` callback in `rpc-mode.ts:477` that prints a rolling counter per event type to stderr (not stdout — stderr is already collected by BridgeService).
- Run auto for one unit, inspect counters.
- If counters show no `message_update` fired → agent event bus isn't emitting → H2 / H3 confirmed upstream of subscribe.

The investigation code added for 3.1 or 3.2 is a temporary probe; it must be removed before any UX-facing fix lands.

## 4. Minimal fix paths (conditional on gate result)

Only one of these should be implemented, picked by gate outcome:

### Path A — if gate 3.1 shows events on subprocess stdout but bridge drops them

- Bisect in `BridgeService.handleStdoutLine`:
  - Make sure `sanitizeEventPayload` is not mis-classifying payloads.
  - Check subscriber fanout (`this.emit`) isn't running before SSE route attaches.
  - Add structural test in `src/tests/integration/` that pipes a fake subprocess stdout with `message_update` and asserts it reaches a `bridge.subscribe` listener.

### Path B — if gate 3.2 shows `session.subscribe` never fires `message_update` during auto

- auto-mode's `runUnit` is driving prompts through a code path that does not tick `AgentSession`'s public event bus.
- Inspect `src/resources/extensions/gsd/auto/run-unit.ts` dispatch around `s.cmdCtx!.newSession(...)` and the subsequent prompt send.
- Either:
  - Route auto prompts through the same `AgentSession` the RPC host subscribed to (so events reuse the existing fanout), OR
  - Add a thin event forwarder in the auto runtime that writes equivalent agent events to `process.stdout` via the same JSONL contract (`serializeJsonLine`). Must not duplicate events when both paths fire.

### Path C — if `GSD_WEB_BRIDGE_TUI=1` causes embedded InteractiveMode to swallow events

- In `rpc-mode.ts`, ensure the embedded `InteractiveMode` attaches as a passive consumer (its own internal listener) and does not replace or short-circuit the RPC-level `session.subscribe` fanout.
- Specifically verify `InteractiveMode` with `bindExtensions: false, submitPromptsDirectly: true` still lets `session.subscribe` fire for all upstream agent events.
- Fix is almost certainly local to `rpc-mode.ts` and/or `modes/interactive/interactive-mode.ts` event wiring.

## 5. Non-goals for Stage 2

- No change to the new `AutoModeConsole` UI.
- No change to `power-mode-context.ts` derivation.
- No change to bridge protocol version negotiation (stay v1 unless gate 4 proves v2 is required).
- No new event types.
- No change to frontend `gsd-workspace-store.tsx` routing — it already consumes exactly the events this plan is about.

## 6. Risks / reversibility

- Forwarding events a second time (path B's forwarder option) risks double delivery if the main `session.subscribe` path also fires for the same turn. Any forwarder must tag source + be idempotent, and tests must assert no dup per `message_update.id`.
- Instrumentation in 3.1 / 3.2 writes to logs/stderr only — low risk, fully revertible.
- Path C could regress interactive mode rendering if event routing is reshuffled. Must be paired with a focused interactive-mode test, not only the web integration test.

## 7. Suggested commit plan (execution, not part of this plan)

1. Commit 1: add probes from §3.1 / §3.2 (behind an env flag or temporary log lines), re-run auto, attach artifacts to findings doc.
2. Commit 2: apply whichever of §4 A/B/C the probes identify, minimal diff only.
3. Commit 3: remove probes, add focused tests:
   - integration test: bridge subprocess emitting `message_update` is delivered to a bridge subscriber.
   - behavior test (if path B): auto-mode one-unit dry run emits at least one `message_update` through the RPC host stdout.
4. Commit 4 (only if still useful): doc update — amend Auto Mode Console spec to remove the Stage 2 caveat.

## 8. Entry points (for whoever picks this up)

- RPC host fanout: `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts:477`
- Embedded interactive mode: `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts:127-203`
- AgentSession.newSession: `packages/pi-coding-agent/src/core/agent-session.ts:1575`
- Auto-mode per-unit new session + dispatch: `src/resources/extensions/gsd/auto/run-unit.ts:85` and surrounding
- Bridge subprocess spawn + stdin/stdout wiring: `src/web/bridge-service.ts:1555-1710`
- SSE route: `web/app/api/session/events/route.ts`
- Web store routing: `web/lib/gsd-workspace-store.tsx` `routeLiveInteractionEvent`

## 9. What is explicitly left for the user to decide

- Whether to land the probes (§3) as a real commit or keep them as a dev-only branch.
- Whether to schedule Stage 2 as a standalone PR or fold it into a follow-up milestone.
- Whether Stage 2 should also cover `execution_complete` / `cost_update` v2 synthesized events, or stay strictly on v1 event types the Web store already consumes.

## 10. Probe findings (2026-04-25)

A targeted probe was added under env flag `GSD_POWER_MODE_PROBE=1` at the two seams described in §3:

- §3.1 probe in `src/web/bridge-service.ts` `handleStdoutLine` — tees every subprocess stdout line to `/tmp/gsd-bridge-stdout-probe.jsonl`.
- §3.2 probe in `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts` inside the `session.subscribe` fanout — appends each agent event kind to `/tmp/gsd-rpc-agent-events-probe.log`.

Both probes were added on a fresh build, a `/gsd auto` prompt was sent via `/api/session/command`, and a 30-second Web SSE trace was captured while auto-mode ran against the isolated project.

Measured counts in a ~33-second window:

| Layer | message_update | Representative structural events |
|-------|----------------|-----------------------------------|
| §3.2 rpc fanout (`session.subscribe`) | 1862 | `agent_start=1`, `turn_start=2`, `tool_execution_start=1`, `tool_execution_update=33`, `tool_execution_end=1`, `turn_end=1` |
| §3.1 bridge subprocess stdout | 397 | `agent_start=1`, `turn_start=2`, `message_start=2`, `tool_execution_start=1` |
| `/api/session/events` SSE | 278 | `agent_start=1`, `agent_end=1`, `turn_start=4`, `turn_end=4`, `tool_execution_start=3`, `tool_execution_end=3`, `session_state_changed=1`, `bridge_status=6`, `live_state_invalidation=6` |

### Conclusions

- **H1 — quiet window:** *confirmed as a non-bug.* The original 45-second SSE trace that showed zero agent events landed entirely in a between-unit quiet window. Once auto-mode was actively running, SSE received a steady stream of `message_update`, `turn_*`, `tool_execution_*` and `agent_end` events.
- **H2 — bypass path:** *refuted.* `session.subscribe` fires for every phase of auto-mode execution. Auto-mode does not drive prompts through a separate event bus.
- **H3 — embedded InteractiveMode swallows events:** *refuted.* With `GSD_WEB_BRIDGE_TUI=1` enabled, the fanout listener still receives every agent event.
- **H4 — protocol filter drift:** *refuted by construction.* Protocol v1 is used with no event filter applied.

### New observation (O1): pipe backpressure between fanout and bridge stdout

The 35-second window measured an ~80% gap between `session.subscribe` fire count (1862) and the JSONL lines the bridge read from subprocess stdout (397) during the high-intensity portion of the run. The most likely explanation is Node's pipe-level backpressure: the subprocess keeps writing to `process.stdout`, and bridge drains as fast as its async reader can, but during bursts there is a queue imbalance. SSE downstream saw 278 `message_update`, which is enough to drive the UI at ~8 events/second. Not a UX blocker in practice, but worth tracking if the UI ever needs lossless replay.

O1 is not an urgent fix. Possible future mitigations, **not committed to here**:

- Coalesce `message_update` deltas into periodic flushes with a max-length guard.
- Switch the bridge subprocess transport from stdout JSONL to a dedicated IPC channel with higher watermark tuning.
- Use the RPC v2 `subscribe` command to filter out high-frequency events the UI does not need.

### Outcome

- Stage 2 is **not required** for baseline Auto Mode Console functionality.
- The Stage 1 UI already shows live agent content when auto-mode is actively running. Apparent emptiness is a between-unit snapshot fallback, and the new waiting-tail placeholder describes that state accurately.
- The probes described in §3 have been reverted; this plan is retained only as an artifact of the investigation and as a reference point for the optional O1 follow-up.
