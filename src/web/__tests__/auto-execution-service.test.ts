import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { collectAutoExecutionTimeline } from "../auto-execution-service.ts"

function tmpDir(): string {
  const dir = join("/tmp", `gsd-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeJournal(basePath: string, entries: object[]): void {
  const journalDir = join(basePath, ".gsd", "journal")
  mkdirSync(journalDir, { recursive: true })
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeFileSync(join(journalDir, "2026-05-01.jsonl"), lines)
}

describe("auto-execution-service collectAutoExecutionTimeline", () => {
  let basePath: string

  beforeEach(() => {
    basePath = tmpDir()
  })

  afterEach(() => {
    try {
      rmSync(basePath, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  test("returns degraded response when no journal directory exists", () => {
    const result = collectAutoExecutionTimeline(basePath)
    assert.equal(result.degraded, true)
    assert.equal(result.events.length, 0)
    assert.equal(result.nextCursor, null)
  })

  test("returns degraded response when journal has no runId in entries", () => {
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: "flow-1", seq: 1, eventType: "iteration-start", data: {} },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    assert.equal(result.degraded, true)
    assert.equal(result.events.length, 0)
  })

  test("maps run-start and run-end events correctly", () => {
    const runId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId, resumed: false } },
      { ts: "2026-05-01T10:05:00.000Z", flowId: runId, seq: 2, eventType: "run-end", data: { runId, status: "completed", reason: "all done" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    assert.equal(result.degraded, true) // no unit-start entries → degraded
    assert.equal(result.events.length, 2)
    assert.equal(result.events[0].kind, "run-start")
    assert.equal(result.events[0].runId, runId)
    assert.equal(result.events[1].kind, "run-end")
    assert.equal(result.events[1].body, "all done")
  })

  test("maps unit-start/end with model-selected and returns non-degraded", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "implement", unitId: "task-1" } },
      { ts: "2026-05-01T10:00:02.000Z", flowId, seq: 2, eventType: "model-selected", data: { runId, unitRunId: flowId, model: "anthropic/claude-sonnet-4-20250514", routing: { tier: "standard" } } },
      { ts: "2026-05-01T10:00:10.000Z", flowId, seq: 3, eventType: "unit-end", data: { runId, unitRunId: flowId, unitType: "implement", unitId: "task-1", status: "completed", durationMs: 9000 } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    assert.equal(result.degraded, false)
    const kinds = result.events.map((e) => e.kind)
    assert.ok(kinds.includes("run-start"))
    assert.ok(kinds.includes("unit-start"))
    assert.ok(kinds.includes("model-selected"))
    assert.ok(kinds.includes("unit-end"))
    // Verify model is parsed
    const modelEvent = result.events.find((e) => e.kind === "model-selected")
    assert.ok(modelEvent)
    assert.equal(modelEvent.model?.id, "anthropic/claude-sonnet-4-20250514")
    assert.equal(modelEvent.model?.tier, "standard")
  })

  test("maps continuity-decision to continuity kind", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "fix", unitId: "u-1" } },
      { ts: "2026-05-01T10:00:05.000Z", flowId, seq: 2, eventType: "continuity-decision", data: { runId, unitRunId: flowId, continuitySignal: "breakpoint", nextAction: "pause", reason: "Verification failed, pausing for human" } },
      { ts: "2026-05-01T10:00:10.000Z", flowId, seq: 3, eventType: "unit-end", data: { runId, unitRunId: flowId, unitType: "fix", unitId: "u-1", status: "paused" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const continuityEvent = result.events.find((e) => e.kind === "continuity")
    assert.ok(continuityEvent)
    assert.ok(continuityEvent.title.includes("pause") || continuityEvent.title.includes("breakpoint"))
    assert.ok(continuityEvent.body?.includes("Verification failed"))
    assert.equal(continuityEvent.source.type, "journal")
  })

  test("maps artifact-verification-retry to verification kind", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "implement", unitId: "u-2" } },
      { ts: "2026-05-01T10:00:05.000Z", flowId, seq: 2, eventType: "artifact-verification-retry", data: { runId, unitRunId: flowId, unitType: "implement", unitId: "u-2", attempt: 3 } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const verEvent = result.events.find((e) => e.kind === "verification")
    assert.ok(verEvent)
    assert.equal(verEvent.title, "Verification retry")
    assert.ok(verEvent.body?.includes("3"))
  })

  test("maps guard-block to guard kind", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "fix", unitId: "u-3" } },
      { ts: "2026-05-01T10:00:03.000Z", flowId, seq: 2, eventType: "guard-block", data: { runId, unitRunId: flowId, reason: "Budget exceeded", gateId: "budget-ceiling" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const guardEvent = result.events.find((e) => e.kind === "guard")
    assert.ok(guardEvent)
    assert.equal(guardEvent.title, "Guard blocked")
    assert.ok(guardEvent.body?.includes("Budget exceeded"))
  })

  test("maps dispatch-stop to guard kind", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "plan", unitId: "u-4" } },
      { ts: "2026-05-01T10:00:04.000Z", flowId, seq: 2, eventType: "dispatch-stop", data: { runId, unitRunId: flowId, reason: "User halt requested" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const stopEvent = result.events.find((e) => e.kind === "guard")
    assert.ok(stopEvent)
    assert.equal(stopEvent.title, "Dispatch stopped")
    assert.ok(stopEvent.body?.includes("User halt"))
  })

  test("maps terminal to run-end kind", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "research", unitId: "u-5" } },
      { ts: "2026-05-01T10:00:05.000Z", flowId, seq: 2, eventType: "terminal", data: { runId, unitRunId: flowId, reason: "milestone-complete", milestoneId: "M001" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const terminalEvent = result.events.find((e) => e.kind === "run-end" && e.source.seq === 2)
    assert.ok(terminalEvent)
    assert.ok(terminalEvent.title.includes("milestone-complete") || terminalEvent.body?.includes("milestone-complete"))
  })

  test("maps stuck-detected to error kind", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "fix", unitId: "u-6" } },
      { ts: "2026-05-01T10:00:10.000Z", flowId, seq: 2, eventType: "stuck-detected", data: { runId, unitRunId: flowId, reason: "Same unit dispatched 5 times" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const stuckEvent = result.events.find((e) => e.kind === "error")
    assert.ok(stuckEvent)
    assert.equal(stuckEvent.title, "Stuck detected")
    assert.ok(stuckEvent.body?.includes("Same unit dispatched"))
  })

  test("maps agent-span with phase=start to agent-span-start", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "implement", unitId: "u-7" } },
      { ts: "2026-05-01T10:00:03.000Z", flowId, seq: 2, eventType: "agent-span", data: { runId, unitRunId: flowId, phase: "start", spanName: "scout-reviewer" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const spanEvent = result.events.find((e) => e.kind === "agent-span-start")
    assert.ok(spanEvent)
    assert.equal(spanEvent.title, "Agent span started")
  })

  test("maps agent-span with phase=end to agent-span-end", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "implement", unitId: "u-8" } },
      { ts: "2026-05-01T10:00:08.000Z", flowId, seq: 2, eventType: "agent-span", data: { runId, unitRunId: flowId, phase: "end", spanName: "scout-reviewer" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const spanEvent = result.events.find((e) => e.kind === "agent-span-end")
    assert.ok(spanEvent)
    assert.equal(spanEvent.title, "Agent span ended")
  })

  test("old run without unit-start returns degraded=true but still shows run-level events", () => {
    const runId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:01:00.000Z", flowId: runId, seq: 2, eventType: "run-end", data: { runId, status: "stopped", reason: "user cancelled" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    assert.equal(result.degraded, true)
    // run-start and run-end are always included regardless of unit pagination
    assert.ok(result.events.length >= 2)
    assert.equal(result.events[0].kind, "run-start")
    assert.equal(result.events[1].kind, "run-end")
  })

  test("pagination: respects cursor and limit for unit-start entries", () => {
    const runId = randomUUID()
    const flow1 = randomUUID()
    const flow2 = randomUUID()
    const flow3 = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId: flow1, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flow1, unitType: "plan", unitId: "u-1" } },
      { ts: "2026-05-01T10:00:10.000Z", flowId: flow1, seq: 2, eventType: "unit-end", data: { runId, unitRunId: flow1, unitType: "plan", unitId: "u-1", status: "completed" } },
      { ts: "2026-05-01T10:01:01.000Z", flowId: flow2, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flow2, unitType: "implement", unitId: "u-2" } },
      { ts: "2026-05-01T10:01:10.000Z", flowId: flow2, seq: 2, eventType: "unit-end", data: { runId, unitRunId: flow2, unitType: "implement", unitId: "u-2", status: "completed" } },
      { ts: "2026-05-01T10:02:01.000Z", flowId: flow3, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flow3, unitType: "verify", unitId: "u-3" } },
      { ts: "2026-05-01T10:02:10.000Z", flowId: flow3, seq: 2, eventType: "unit-end", data: { runId, unitRunId: flow3, unitType: "verify", unitId: "u-3", status: "completed" } },
    ])

    // Get first 2 units
    const page1 = collectAutoExecutionTimeline(basePath, { limit: 2 })
    assert.equal(page1.degraded, false)
    assert.equal(page1.nextCursor, "2")
    // Should include unit-start/end for u-1 and u-2 but not u-3
    const unitIds = page1.events
      .filter((e) => e.kind === "unit-start")
      .map((e) => e.unit?.id)
    assert.ok(unitIds.includes("u-1"))
    assert.ok(unitIds.includes("u-2"))
    assert.ok(!unitIds.includes("u-3"))

    // Get page 2
    const page2 = collectAutoExecutionTimeline(basePath, { cursor: "2", limit: 2 })
    assert.equal(page2.nextCursor, null)
    const page2UnitIds = page2.events
      .filter((e) => e.kind === "unit-start")
      .map((e) => e.unit?.id)
    assert.ok(page2UnitIds.includes("u-3"))
  })

  test("events are sorted by timestamp", () => {
    const runId = randomUUID()
    const flowId = randomUUID()
    writeJournal(basePath, [
      { ts: "2026-05-01T10:00:05.000Z", flowId, seq: 2, eventType: "model-selected", data: { runId, unitRunId: flowId, model: "claude" } },
      { ts: "2026-05-01T10:00:00.000Z", flowId: runId, seq: 1, eventType: "run-start", data: { runId } },
      { ts: "2026-05-01T10:00:01.000Z", flowId, seq: 1, eventType: "unit-start", data: { runId, unitRunId: flowId, unitType: "fix", unitId: "u-1" } },
    ])
    const result = collectAutoExecutionTimeline(basePath)
    const timestamps = result.events.map((e) => Date.parse(e.ts))
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(timestamps[i] >= timestamps[i - 1], `Event ${i} should be >= event ${i - 1} in timestamp order`)
    }
  })
})
