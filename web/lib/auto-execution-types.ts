export type AutoExecutionEventKind =
  | "run-start"
  | "run-end"
  | "unit-start"
  | "unit-end"
  | "model-selected"
  | "thinking"
  | "message"
  | "tool-end"
  | "error"
  | "agent-span-start"
  | "agent-span-end"
  | "verification"
  | "continuity"
  | "guard"
  | "file-diff"
  | "tool-start"
  | "tool-update"

export interface AutoExecutionEventSource {
  type: "bridge-event" | "session-transcript" | "journal" | "git" | "closeout-artifact"
  path?: string
  flowId?: string
  seq?: number
}

export interface AutoExecutionEvent {
  id: string
  ts: string
  runId: string
  unitRunId?: string
  unit?: { type: string; id: string }
  session?: { id?: string; file?: string | null }
  model?: { id?: string; tier?: string; provider?: string }
  kind: AutoExecutionEventKind
  title: string
  body?: string
  tool?: {
    callId: string
    name: string
    argsPreview?: string
    resultPreview?: string
    isError?: boolean
  }
  diff?: {
    files: string[]
    patchPreview?: string
    commitSha?: string | null
  }
  source: AutoExecutionEventSource
}

export interface AutoExecutionTimelineResponse {
  events: AutoExecutionEvent[]
  nextCursor: string | null
  watermark: string | null
  degraded: boolean
}
