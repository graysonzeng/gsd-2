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

    assert.deepEqual(timeline.map((item) => item.kind), ["thinking", "message", "tool", "message", "active-tool"])
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

    assert.deepEqual(timeline.map((item) => item.kind), ["status", "status", "status", "waiting-tail"])
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
})
