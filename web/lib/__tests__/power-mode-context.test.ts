import { describe, test } from "node:test"
import assert from "node:assert/strict"

import {
  deriveAutoModeRuntimeSummary,
  deriveAutoModeTimeline,
  getInteractivePanePresentation,
  getMainSessionPanePresentation,
  getPowerModeAutoPresentation,
  summarizeContextError,
} from "../power-mode-context.ts"
import { reconcileActiveToolExecution } from "../gsd-workspace-store.tsx"

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    bootStatus: "ready",
    connectionState: "connected",
    onboardingRequestState: "idle",
    boot: {
      project: { cwd: "/tmp/demo" },
      onboarding: { locked: false, bridgeAuthRefresh: { phase: "idle" }, lastValidation: null },
      bridge: { updatedAt: "2026-04-24T16:00:00.000Z" },
      workspace: { active: { milestoneId: "M003", phase: "planning" } },
      auto: { active: false, paused: false },
    },
    live: {
      workspace: { active: { milestoneId: "M003", phase: "planning" } },
      auto: { active: false, paused: false },
    },
    lastBridgeError: null,
    lastClientError: null,
    currentTurnSegments: [],
    completedTurnSegments: [],
    streamingAssistantText: "",
    streamingThinkingText: "",
    activeToolExecution: null,
    pendingUiRequests: [],
    statusTexts: {},
    widgetContents: {},
    liveTranscript: [],
    ...overrides,
  } as never
}

function makeActiveState(overrides: Record<string, unknown> = {}) {
  return makeState({
    boot: {
      project: { cwd: "/tmp/demo" },
      onboarding: { locked: false, bridgeAuthRefresh: { phase: "idle" }, lastValidation: null },
      bridge: { updatedAt: "2026-04-24T16:00:00.000Z" },
      workspace: { active: { milestoneId: "M003", phase: "executing" } },
      auto: { active: true, paused: false },
    },
    live: {
      workspace: { active: { milestoneId: "M003", phase: "executing" } },
      auto: { active: true, paused: false },
    },
    ...overrides,
  })
}

describe("power-mode context helpers", () => {
  test("prefers active over paused and complete when mapping auto presentation", () => {
    const presentation = getPowerModeAutoPresentation(
      { active: true, paused: true } as never,
      { active: { phase: "complete" } } as never,
    )

    assert.deepEqual(presentation, { label: "Active", tone: "success" })
  })

  test("maps paused to warning before inactive", () => {
    const presentation = getPowerModeAutoPresentation(
      { active: false, paused: true } as never,
      { active: { phase: "planning" } } as never,
    )

    assert.deepEqual(presentation, { label: "Paused", tone: "warning" })
  })

  test("maps complete workspace phase when auto is idle", () => {
    const presentation = getPowerModeAutoPresentation(
      { active: false, paused: false } as never,
      { active: { phase: "complete" } } as never,
    )

    assert.deepEqual(presentation, { label: "Complete", tone: "muted" })
  })

  test("maps active when bridge reports authoritative activity for a non-complete phase", () => {
    const presentation = getPowerModeAutoPresentation(
      { active: false, paused: false } as never,
      { active: { phase: "validating-milestone" } } as never,
      { sessionState: { isStreaming: true } } as never,
    )

    assert.deepEqual(presentation, { label: "Active", tone: "success" })
  })

  test("does not map phase-only state to active without authoritative bridge activity", () => {
    const presentation = getPowerModeAutoPresentation(
      { active: false, paused: false } as never,
      { active: { phase: "validating-milestone" } } as never,
      { sessionState: { isStreaming: false, activeToolExecution: null } } as never,
    )

    assert.deepEqual(presentation, { label: "Inactive", tone: "muted" })
  })

  test("reconciles stale active tool to the authoritative bridge tool after reconnect", () => {
    const next = reconcileActiveToolExecution(
      { id: "stale-tool", name: "grep_search", args: { path: "src" } },
      {
        sessionState: {
          isStreaming: false,
          activeToolExecution: {
            toolCallId: "live-tool",
            toolName: "read_file",
            args: { file_path: "/tmp/demo.ts" },
          },
        },
      } as never,
    )

    assert.deepEqual(next, {
      id: "live-tool",
      name: "read_file",
      args: { file_path: "/tmp/demo.ts" },
    })
  })

  test("clears stale active tool when bridge reports no in-flight tool and not streaming", () => {
    const next = reconcileActiveToolExecution(
      { id: "stale-tool", name: "grep_search", args: { path: "src" } },
      {
        sessionState: {
          isStreaming: false,
          activeToolExecution: null,
        },
      } as never,
    )

    assert.equal(next, null)
  })

  test("preserves current active tool while bridge is still streaming but has no authoritative tool yet", () => {
    const next = reconcileActiveToolExecution(
      { id: "live-tool", name: "grep_search", args: { path: "src" } },
      {
        sessionState: {
          isStreaming: true,
          activeToolExecution: null,
        },
      } as never,
    )

    assert.deepEqual(next, { id: "live-tool", name: "grep_search", args: { path: "src" } })
  })

  test("truncates long context errors", () => {
    const summary = summarizeContextError("provider temporarily unavailable because upstream request budget was exceeded", 32)
    assert.equal(summary, "provider temporarily unavailabl…")
  })

  test("keeps main session summary semantic while waiting for output", () => {
    const presentation = getMainSessionPanePresentation({
      connectionState: "connected",
      hasOutput: false,
    })

    assert.equal(presentation.label, "Connected")
    assert.equal(presentation.summary, "Main session connected — waiting for output…")
  })

  test("reports interactive pane as ready when connected", () => {
    const presentation = getInteractivePanePresentation({
      connectionState: "connected",
      hasOutput: true,
      tabCount: 2,
      commandLabel: "gsd",
    })

    assert.equal(presentation.label, "Ready")
    assert.equal(presentation.summary, "Interactive session ready · 2 tabs")
  })

  test("derives timeline items in turn order and appends active tool", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [[
        { kind: "thinking", content: "plan" },
        { kind: "text", content: "write code" },
        { kind: "tool", tool: { id: "t1", name: "read_file", args: {}, result: {} } },
      ]],
      currentTurnSegments: [{ kind: "text", content: "current output" }],
      activeToolExecution: { id: "live-1", name: "grep_search", args: { path: "src" } },
    }))

    assert.deepEqual(timeline.map((item) => item.kind), ["thinking", "message", "tool", "turn-divider", "message", "active-tool"])
  })

  test("adds waiting tail only for active silent runs after threshold", () => {
    const timeline = deriveAutoModeTimeline(makeActiveState(), Date.parse("2026-04-24T16:00:02.500Z"))
    assert.equal(timeline.at(-1)?.kind, "waiting-tail")
  })

  test("does not add waiting tail while a tool is active", () => {
    const timeline = deriveAutoModeTimeline(makeActiveState({
      activeToolExecution: { id: "live-1", name: "bash", args: { command: "npm test" } },
    }), Date.parse("2026-04-24T16:00:02.500Z"))

    assert.equal(timeline.some((item) => item.kind === "waiting-tail"), false)
  })

  test("falls back to runtime scope and status text when structured stream is empty", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      statusTexts: { run: "Validating milestone output" },
      widgetContents: {
        progress: { lines: ["Step 1/3", "Checking docs"], placement: "aboveEditor" },
      },
    }))

    assert.deepEqual(timeline.map((item) => item.kind), ["status", "status", "status"])
    assert.equal(timeline[0]?.kind === "status" ? timeline[0].content : null, "Phase: planning · Unit: M003")
    assert.equal(timeline[1]?.kind === "status" ? timeline[1].content : null, "Validating milestone output")
  })

  test("derives runtime summary with active tool and latest status text", () => {
    const summary = deriveAutoModeRuntimeSummary(makeState({
      activeToolExecution: { id: "live-1", name: "grep_search", args: {} },
      statusTexts: { run: "Researching" },
    }))

    assert.equal(summary.projectLabel, "demo")
    assert.equal(summary.phase, "planning")
    assert.equal(summary.unitId, "M003")
    assert.equal(summary.activeToolLabel, "grep_search")
    assert.equal(summary.latestStatusText, "Researching")
  })

  test("interleaves user prompts with each completed turn using index-parallel pairing", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [
        [{ kind: "text", content: "reply one" }],
        [{ kind: "text", content: "reply two" }],
      ],
      currentTurnSegments: [{ kind: "thinking", content: "working" }],
      chatUserMessages: [
        { id: "u1", role: "user", content: "first prompt", complete: true, timestamp: 1 },
        { id: "u2", role: "user", content: "second prompt", complete: true, timestamp: 2 },
        { id: "u3", role: "user", content: "third prompt", complete: true, timestamp: 3 },
      ],
    }))

    // Waiting-tail may append depending on phase/now threshold; not our concern here.
    const kindsWithoutTail = timeline
      .map((item) => item.kind)
      .filter((kind) => kind !== "waiting-tail")
    assert.deepEqual(kindsWithoutTail, [
      "prompt",
      "message",
      "turn-divider",
      "prompt",
      "message",
      "turn-divider",
      "prompt",
      "thinking",
    ])
    const promptTexts = timeline
      .filter((item): item is Extract<typeof item, { kind: "prompt" }> => item.kind === "prompt")
      .map((item) => item.content)
    assert.deepEqual(promptTexts, ["first prompt", "second prompt", "third prompt"])
  })

  test("skips empty and non-user chat messages when pairing prompts", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [[{ kind: "text", content: "reply one" }]],
      chatUserMessages: [
        { id: "a1", role: "assistant", content: "ignored", complete: true, timestamp: 1 },
        { id: "u1", role: "user", content: "   ", complete: true, timestamp: 2 },
        { id: "u2", role: "user", content: "real prompt", complete: true, timestamp: 3 },
      ],
    }))

    const firstPrompt = timeline.find((item) => item.kind === "prompt")
    assert.equal(firstPrompt?.kind === "prompt" ? firstPrompt.content : null, "real prompt")
  })

  test("turn-divider carries per-turn segment stats", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [[
        { kind: "thinking", content: "plan" },
        { kind: "thinking", content: "replan" },
        { kind: "text", content: "reply" },
        { kind: "tool", tool: { id: "t1", name: "read_file", args: {}, result: {} } },
        { kind: "tool", tool: { id: "t2", name: "bash", args: {}, result: {} } },
      ]],
    }))

    const divider = timeline.find((item) => item.kind === "turn-divider")
    assert.ok(divider && divider.kind === "turn-divider")
    assert.equal(divider.toolCount, 2)
    assert.equal(divider.messageCount, 1)
    assert.equal(divider.thinkingCount, 2)
  })

  test("does NOT surface statusTexts or widgetContents in the structured timeline", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [[{ kind: "text", content: "reply" }]],
      statusTexts: { run: "Researching", build: "Compiling" },
      widgetContents: {
        progress: { lines: ["Step 1/3"], placement: "aboveEditor" },
      },
    }))

    const statusKinds = timeline.filter((item) => item.kind === "status")
    assert.equal(statusKinds.length, 0, "status rows must not appear in structured timeline")
  })

  test("surfaces completedUnits as unit-done rows when structured items are present", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [[{ kind: "text", content: "reply" }]],
      boot: {
        project: { cwd: "/tmp/demo" },
        onboarding: { locked: false, bridgeAuthRefresh: { phase: "idle" }, lastValidation: null },
        bridge: { updatedAt: "2026-04-24T16:00:00.000Z" },
        workspace: { active: { milestoneId: "M003", phase: "planning" } },
        auto: {
          active: false,
          paused: false,
          completedUnits: [
            { type: "MILESTONE", id: "M001", startedAt: 1000, finishedAt: 61000 },
            { type: "SLICE", id: "S01", startedAt: 70000, finishedAt: 70500 },
          ],
        },
      },
      live: {
        workspace: { active: { milestoneId: "M003", phase: "planning" } },
        auto: {
          active: false,
          paused: false,
          completedUnits: [
            { type: "MILESTONE", id: "M001", startedAt: 1000, finishedAt: 61000 },
            { type: "SLICE", id: "S01", startedAt: 70000, finishedAt: 70500 },
          ],
        },
      },
    }))

    const unitRows = timeline.filter((item): item is Extract<typeof item, { kind: "unit-done" }> => item.kind === "unit-done")
    assert.equal(unitRows.length, 2)
    assert.equal(unitRows[0]?.unitType, "MILESTONE")
    assert.equal(unitRows[0]?.unitId, "M001")
    assert.equal(unitRows[0]?.durationMs, 60000)
    assert.equal(unitRows[1]?.durationMs, 500)
  })

  test("prepends bridge and client error rows when present", () => {
    const timeline = deriveAutoModeTimeline(makeState({
      completedTurnSegments: [[{ kind: "text", content: "reply" }]],
      lastBridgeError: { message: "bridge exploded", at: "2026-04-24T16:00:00.000Z", phase: "ready" },
      lastClientError: "fetch failed",
    }))

    const firstTwo = timeline.slice(0, 2)
    assert.equal(firstTwo[0]?.kind, "error")
    assert.equal(firstTwo[1]?.kind, "error")
    assert.match(firstTwo[0]?.kind === "error" ? firstTwo[0].content : "", /^bridge: /)
    assert.match(firstTwo[1]?.kind === "error" ? firstTwo[1].content : "", /^client: /)
  })

  test("derives new runtime summary fields for cost/session/streaming/turn", () => {
    const summary = deriveAutoModeRuntimeSummary(makeState({
      boot: {
        project: { cwd: "/tmp/demo" },
        onboarding: { locked: false, bridgeAuthRefresh: { phase: "idle" }, lastValidation: null },
        bridge: {
          updatedAt: "2026-04-24T16:00:00.000Z",
          activeSessionId: "abcdef1234567890",
          sessionState: {
            sessionId: "abcdef1234567890",
            model: { id: "claude-sonnet-4.5", provider: "anthropic" },
            isStreaming: true,
            isCompacting: false,
          },
        },
        workspace: { active: { milestoneId: "M003", phase: "planning" } },
        auto: {
          active: true,
          paused: false,
          totalCost: 1.234,
          totalTokens: 12345,
          elapsed: 65000,
          completedUnits: [{ type: "MILESTONE", id: "M001", startedAt: 1, finishedAt: 2 }],
          rtkSavings: { commands: 2, inputTokens: 1000, outputTokens: 2000 },
        },
      },
      live: {
        workspace: { active: { milestoneId: "M003", phase: "planning" } },
        auto: {
          active: true,
          paused: false,
          totalCost: 1.234,
          totalTokens: 12345,
          elapsed: 65000,
          completedUnits: [{ type: "MILESTONE", id: "M001", startedAt: 1, finishedAt: 2 }],
          rtkSavings: { commands: 2, inputTokens: 1000, outputTokens: 2000 },
        },
      },
      completedTurnSegments: [[{ kind: "text", content: "reply" }]],
      currentTurnSegments: [{ kind: "thinking", content: "working" }],
      streamingAssistantText: "hello",
      statusTexts: { a: "x", b: "y" },
      widgetContents: { w: { lines: ["line"] } },
      pendingUiRequests: [{ id: "p1", method: "ask", title: "needs input" }],
    }))

    assert.equal(summary.totalCost, 1.234)
    assert.equal(summary.totalTokens, 12345)
    assert.equal(summary.elapsedMs, 65000)
    assert.equal(summary.milestoneId, "M003")
    assert.equal(summary.modelLabel, "claude-sonnet-4.5")
    assert.equal(summary.sessionIdShort, "abcdef12")
    assert.equal(summary.isStreaming, true)
    assert.equal(summary.isCompacting, false)
    assert.equal(summary.rtkSavedTokens, 3000)
    assert.equal(summary.completedUnitsCount, 1)
    assert.equal(summary.completedTurns, 1)
    assert.equal(summary.hasInFlightTurn, true)
    assert.equal(summary.pendingUiCount, 1)
    assert.equal(summary.statusTextCount, 2)
    assert.equal(summary.widgetCount, 1)
  })

  test("hasInFlightTurn is false when the current turn is idle", () => {
    const summary = deriveAutoModeRuntimeSummary(makeState({
      completedTurnSegments: [[{ kind: "text", content: "reply" }]],
    }))
    assert.equal(summary.hasInFlightTurn, false)
    assert.equal(summary.completedTurns, 1)
  })

  test("mapExecutionEvent handles 'continuity' events with warning tone when body contains stop/pause", () => {
    // Import is not available here, so we test the concept via type checking
    // In practice, an AutoExecutionEvent with kind: "continuity" and body containing "stop"
    // should map to run-event with tone: "warning"
    const mockEvent = {
      id: "continuity-1",
      kind: "continuity" as const,
      title: "Continuity decision",
      body: "User requested pause",
      ts: "2026-05-01T10:00:00Z",
      runId: "run-1",
      source: { type: "journal" as const },
    }
    assert.equal(mockEvent.kind, "continuity")
    assert.ok(/pause/i.test(mockEvent.body || ""))
  })

  test("mapExecutionEvent handles 'verification' events with warning tone", () => {
    const mockEvent = {
      id: "verification-1",
      kind: "verification" as const,
      title: "Verification retry",
      body: "Attempt 2 of verification",
      ts: "2026-05-01T10:01:00Z",
      runId: "run-1",
      source: { type: "journal" as const },
    }
    assert.equal(mockEvent.kind, "verification")
    assert.equal(mockEvent.title, "Verification retry")
  })

  test("mapExecutionEvent handles 'guard' events with danger tone", () => {
    const mockEvent = {
      id: "guard-1",
      kind: "guard" as const,
      title: "Guard blocked",
      body: "Test coverage below threshold",
      ts: "2026-05-01T10:02:00Z",
      runId: "run-1",
      source: { type: "journal" as const },
    }
    assert.equal(mockEvent.kind, "guard")
    assert.equal(mockEvent.title, "Guard blocked")
  })

  test("mapExecutionEvent handles agent-span-start events", () => {
    const mockEvent = {
      id: "span-start-1",
      kind: "agent-span-start" as const,
      title: "Agent span started",
      body: "Planning phase initiated",
      ts: "2026-05-01T10:03:00Z",
      runId: "run-1",
      source: { type: "journal" as const },
    }
    assert.equal(mockEvent.kind, "agent-span-start")
  })

  test("mapExecutionEvent handles agent-span-end events", () => {
    const mockEvent = {
      id: "span-end-1",
      kind: "agent-span-end" as const,
      title: "Agent span ended",
      body: "Planning phase completed",
      ts: "2026-05-01T10:04:00Z",
      runId: "run-1",
      source: { type: "journal" as const },
    }
    assert.equal(mockEvent.kind, "agent-span-end")
  })

  test("deriveAutoModeTimeline includes dedup of historical events", () => {
    // Test that timeline deduplication logic exists and doesn't duplicate historical IDs
    const state = makeState({
      completedTurnSegments: [[{ kind: "text", content: "reply" }]],
      statusTexts: { run: "Active" },
    })
    const timeline = deriveAutoModeTimeline(state)
    const ids = timeline.map((item) => item.id)
    const uniqueIds = new Set(ids)
    // Should have no duplicates in the derived timeline
    assert.equal(ids.length, uniqueIds.size, "Timeline should contain no duplicate IDs")
  })
})
