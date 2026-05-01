import {
  getCurrentScopeLabel,
  getLiveAutoDashboard,
  getLiveAutoExecutionTimeline,
  getLiveWorkspaceIndex,
  getProjectDisplayName,
  getStatusPresentation,
  getVisibleWorkspaceError,
  type ActiveToolExecution,
  type AutoDashboardData,
  type BridgeRuntimeSnapshot,
  type CompletedToolExecution,
  type PendingUiRequest,
  type TurnSegment,
  type WidgetContent,
  type WorkspaceIndex,
  type WorkspaceStoreState,
} from "./gsd-workspace-store"
import type { AutoExecutionEvent } from "./auto-execution-types"

export type PowerModeTone = "success" | "warning" | "danger" | "info" | "muted"

export interface PowerModePresentation {
  label: string
  tone: PowerModeTone
}

export interface PanePresentation {
  label: string
  tone: PowerModeTone
  summary: string | null
}

export interface MainSessionPaneStatus {
  connectionState: "connecting" | "connected" | "error"
  hasOutput: boolean
}

export interface InteractivePaneStatus {
  connectionState: "connecting" | "connected" | "error"
  hasOutput: boolean
  tabCount: number
  commandLabel: string
}

export type AutoModeTimelineItem =
  | { kind: "thinking"; id: string; content: string; streaming?: boolean }
  | { kind: "message"; id: string; content: string; streaming?: boolean }
  | { kind: "prompt"; id: string; content: string; timestamp?: number }
  | { kind: "tool"; id: string; tool: CompletedToolExecution }
  | { kind: "active-tool"; id: string; tool: ActiveToolExecution }
  | { kind: "ui-request"; id: string; request: PendingUiRequest }
  | { kind: "status"; id: string; label: string; content: string; tone: PowerModeTone }
  | { kind: "error"; id: string; content: string }
  | { kind: "waiting-tail"; id: string; content: string }
  | { kind: "run-event"; id: string; label: string; content: string; tone: PowerModeTone }
  | {
      kind: "turn-divider"
      id: string
      turnIndex: number
      toolCount: number
      messageCount: number
      thinkingCount: number
    }
  | { kind: "unit-done"; id: string; unitType: string; unitId: string; durationMs: number }

export interface AutoModeRuntimeSummary {
  projectLabel: string
  autoPresentation: PowerModePresentation
  bridgePresentation: ReturnType<typeof getStatusPresentation>
  phase: string | null
  milestoneId: string | null
  unitId: string | null
  scopeLabel: string
  activeToolLabel: string | null
  issueSummary: string | null
  latestStatusText: string | null
  totalCost: number
  totalTokens: number
  elapsedMs: number
  modelLabel: string | null
  sessionIdShort: string | null
  isStreaming: boolean
  isCompacting: boolean
  rtkSavedTokens: number
  completedUnitsCount: number
  completedTurns: number
  hasInFlightTurn: boolean
  pendingUiCount: number
  statusTextCount: number
  widgetCount: number
}

type AutoModeState = Pick<
  WorkspaceStoreState,
  | "bootStatus"
  | "connectionState"
  | "boot"
  | "onboardingRequestState"
  | "live"
  | "lastBridgeError"
  | "lastClientError"
  | "currentTurnSegments"
  | "completedTurnSegments"
  | "streamingAssistantText"
  | "streamingThinkingText"
  | "activeToolExecution"
  | "pendingUiRequests"
  | "statusTexts"
  | "widgetContents"
  | "liveTranscript"
> & Partial<Pick<WorkspaceStoreState, "chatUserMessages">>

const WAITING_TAIL_THRESHOLD_MS = 1_500

function getCurrentUnitId(auto: AutoDashboardData | null | undefined, workspace: WorkspaceIndex | null | undefined): string | null {
  const scope = [workspace?.active.milestoneId, workspace?.active.sliceId, workspace?.active.taskId]
    .filter(Boolean)
    .join("/")
  return auto?.currentUnit?.id ?? (scope || null)
}

function latestStatusText(statusTexts: Record<string, string>): string | null {
  const entries = Object.entries(statusTexts)
  return entries.length > 0 ? entries[entries.length - 1]?.[1] ?? null : null
}

function summarizeWidgetContent(widgetContents: Record<string, WidgetContent>): Array<{ key: string; content: string }> {
  return Object.entries(widgetContents)
    .filter(([, widget]) => Array.isArray(widget.lines) && widget.lines.length > 0)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, widget]) => ({
      key,
      content: (widget.lines ?? []).slice(0, 3).join(" · "),
    }))
    .filter((widget) => widget.content.trim().length > 0)
}

function pushTurnSegments(items: AutoModeTimelineItem[], segments: TurnSegment[], prefix: string) {
  segments.forEach((segment, index) => {
    if (segment.kind === "thinking") {
      items.push({ kind: "thinking", id: `${prefix}-thinking-${index}`, content: segment.content })
      return
    }
    if (segment.kind === "text") {
      items.push({ kind: "message", id: `${prefix}-text-${index}`, content: segment.content })
      return
    }
    items.push({ kind: "tool", id: `${prefix}-tool-${index}-${segment.tool.id}`, tool: segment.tool })
  })
}

function shouldShowWaitingTail(state: AutoModeState, now: number, hasAnyItems: boolean): boolean {
  if (!hasAnyItems) return false
  if (state.bootStatus !== "ready") return false
  if (state.connectionState !== "connected") return false
  if (state.activeToolExecution) return false
  if (state.streamingAssistantText.length > 0 || state.streamingThinkingText.length > 0) return false
  if (state.pendingUiRequests.length > 0) return false

  const auto = getLiveAutoDashboard(state)
  const workspace = getLiveWorkspaceIndex(state)
  const phase = workspace?.active.phase ?? null
  const autoInProgress = Boolean(
    auto?.active ||
    auto?.paused ||
    ((phase && phase !== "complete") && hasAuthoritativeAutoActivity(state.boot?.bridge)),
  )
  if (!autoInProgress) return false

  const updatedAt = state.boot?.bridge?.updatedAt ? Date.parse(state.boot.bridge.updatedAt) : NaN
  if (Number.isFinite(updatedAt) && now - updatedAt < WAITING_TAIL_THRESHOLD_MS) return false

  return true
}

function hasAuthoritativeAutoActivity(bridge: BridgeRuntimeSnapshot | null | undefined): boolean {
  return Boolean(bridge?.sessionState?.isStreaming || bridge?.sessionState?.activeToolExecution)
}

export function getPowerModeAutoPresentation(
  auto: AutoDashboardData | null | undefined,
  workspace: WorkspaceIndex | null | undefined,
  bridge?: BridgeRuntimeSnapshot | null,
): PowerModePresentation {
  if (auto?.active) return { label: "Active", tone: "success" }
  if (auto?.paused) return { label: "Paused", tone: "warning" }
  if (workspace?.active.phase && workspace.active.phase !== "complete" && hasAuthoritativeAutoActivity(bridge)) {
    return { label: "Active", tone: "success" }
  }
  if (workspace?.active.phase === "complete") return { label: "Complete", tone: "muted" }
  return { label: "Inactive", tone: "muted" }
}

export function getMainSessionPanePresentation(status: MainSessionPaneStatus): PanePresentation {
  if (status.connectionState === "error") {
    return {
      label: "Error",
      tone: "danger",
      summary: status.hasOutput ? "Main session needs attention" : "Reconnecting to main session…",
    }
  }
  if (status.connectionState === "connected") {
    return {
      label: "Connected",
      tone: "success",
      summary: status.hasOutput ? null : "Main session connected — waiting for output…",
    }
  }
  return {
    label: "Connecting",
    tone: "info",
    summary: "Connecting to main session…",
  }
}

export function getInteractivePanePresentation(status: InteractivePaneStatus): PanePresentation {
  if (status.connectionState === "error") {
    return {
      label: "Error",
      tone: "danger",
      summary: `${status.commandLabel} terminal disconnected`,
    }
  }
  if (status.connectionState === "connected") {
    return {
      label: "Ready",
      tone: "success",
      summary: status.hasOutput ? `Interactive session ready${status.tabCount > 1 ? ` · ${status.tabCount} tabs` : ""}` : `${status.commandLabel} connected — waiting for output…`,
    }
  }
  return {
    label: "Starting",
    tone: "info",
    summary: `Starting ${status.commandLabel}…`,
  }
}

export function summarizeContextError(message: string | null | undefined, maxLength = 72): string | null {
  if (!message) return null
  const trimmed = message.trim()
  if (!trimmed) return null
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function deriveAutoModeRuntimeSummary(state: AutoModeState): AutoModeRuntimeSummary {
  const workspace = getLiveWorkspaceIndex(state)
  const auto = getLiveAutoDashboard(state)
  const phase = workspace?.active.phase ?? null
  const milestoneId = workspace?.active.milestoneId ?? null
  const unitId = getCurrentUnitId(auto, workspace)

  const bridge = state.boot?.bridge
  const sessionState = bridge?.sessionState ?? null
  const model = sessionState?.model
  const modelLabel = model ? (model.id || model.providerId || model.provider || null) : null
  const rawSessionId = sessionState?.sessionId ?? bridge?.activeSessionId ?? null
  const sessionIdShort = typeof rawSessionId === "string" && rawSessionId.length > 0
    ? (rawSessionId.length > 8 ? rawSessionId.slice(0, 8) : rawSessionId)
    : null
  const rtkSaved = auto?.rtkSavings
  const rtkSavedTokens = typeof rtkSaved?.inputTokens === "number" && typeof rtkSaved?.outputTokens === "number"
    ? rtkSaved.inputTokens + rtkSaved.outputTokens
    : 0

  return {
    projectLabel: getProjectDisplayName(state.boot?.project.cwd),
    autoPresentation: getPowerModeAutoPresentation(auto, workspace, bridge),
    bridgePresentation: getStatusPresentation(state),
    phase,
    milestoneId,
    unitId,
    scopeLabel: getCurrentScopeLabel(workspace),
    activeToolLabel: state.activeToolExecution?.name ?? null,
    issueSummary: summarizeContextError(getVisibleWorkspaceError(state)),
    latestStatusText: latestStatusText(state.statusTexts),
    totalCost: auto?.totalCost ?? 0,
    totalTokens: auto?.totalTokens ?? 0,
    elapsedMs: auto?.elapsed ?? 0,
    modelLabel,
    sessionIdShort,
    isStreaming: Boolean(sessionState?.isStreaming),
    isCompacting: Boolean(sessionState?.isCompacting),
    rtkSavedTokens,
    completedUnitsCount: auto?.completedUnits?.length ?? 0,
    completedTurns: state.completedTurnSegments.length,
    hasInFlightTurn:
      state.currentTurnSegments.length > 0 ||
      state.streamingAssistantText.length > 0 ||
      state.streamingThinkingText.length > 0 ||
      Boolean(state.activeToolExecution),
    pendingUiCount: state.pendingUiRequests.length,
    statusTextCount: Object.keys(state.statusTexts).length,
    widgetCount: Object.keys(state.widgetContents).length,
  }
}

function countTurnStats(segments: TurnSegment[]): { toolCount: number; messageCount: number; thinkingCount: number } {
  let toolCount = 0
  let messageCount = 0
  let thinkingCount = 0
  for (const seg of segments) {
    if (seg.kind === "tool") toolCount += 1
    else if (seg.kind === "text") messageCount += 1
    else if (seg.kind === "thinking") thinkingCount += 1
  }
  return { toolCount, messageCount, thinkingCount }
}

function mapExecutionEvent(event: AutoExecutionEvent): AutoModeTimelineItem | null {
  switch (event.kind) {
    case "thinking":
      return event.body ? { kind: "thinking", id: event.id, content: event.body } : null
    case "message":
      return event.body ? { kind: "message", id: event.id, content: event.body } : null
    case "tool-end":
      return {
        kind: event.kind === "tool-end" ? "status" : "status",
        id: event.id,
        label: event.tool?.name ?? "tool",
        content: event.tool?.resultPreview ?? event.body ?? event.title,
        tone: event.tool?.isError ? "danger" : "info",
      }
    case "error":
      return { kind: "error", id: event.id, content: event.body ?? event.title }
    case "continuity":
      return {
        kind: "run-event",
        id: event.id,
        label: event.title,
        content: event.body ?? "Continuity decision made",
        tone: event.body && /stop|pause|cancel/i.test(event.body) ? "warning" : "muted",
      }
    case "verification":
      return {
        kind: "run-event",
        id: event.id,
        label: event.title,
        content: event.body ?? "Verification in progress",
        tone: "warning",
      }
    case "guard":
      return {
        kind: "run-event",
        id: event.id,
        label: event.title,
        content: event.body ?? "Guard condition triggered",
        tone: "danger",
      }
    case "agent-span-start":
    case "agent-span-end":
      return {
        kind: "run-event",
        id: event.id,
        label: event.title,
        content: event.body ?? event.title,
        tone: "info",
      }
    case "file-diff":
      return {
        kind: "status",
        id: event.id,
        label: "Files changed",
        content: event.diff?.files?.join(", ") ?? event.body ?? event.title,
        tone: "info",
      }
    case "tool-start":
    case "tool-update":
      return {
        kind: "status",
        id: event.id,
        label: event.tool?.name ?? "tool",
        content: event.body ?? event.title,
        tone: "info",
      }
    case "run-start":
    case "run-end":
    case "unit-start":
    case "unit-end":
    case "model-selected":
      return {
        kind: "run-event",
        id: event.id,
        label: event.kind,
        content: event.body ?? event.title,
        tone: event.kind === "run-end" && /stop|error|cancel/i.test(event.body ?? event.title) ? "warning" : "muted",
      }
    default:
      return null
  }
}

export function deriveAutoModeTimeline(state: AutoModeState, now = Date.now()): AutoModeTimelineItem[] {
  const items: AutoModeTimelineItem[] = []
  const historicalTimeline = getLiveAutoExecutionTimeline(state).map(mapExecutionEvent).filter(Boolean) as AutoModeTimelineItem[]

  // Collect historical IDs for dedup
  const historicalIds = new Set<string>()
  historicalTimeline.forEach((item) => {
    historicalIds.add(item.id)
  })

  items.push(...historicalTimeline)

  // Prepend structural errors (bridge / client) only when present.
  const bridgeError = state.lastBridgeError?.message
  if (typeof bridgeError === "string" && bridgeError.trim()) {
    items.push({ kind: "error", id: "bridge-error", content: `bridge: ${bridgeError.trim()}` })
  }
  if (typeof state.lastClientError === "string" && state.lastClientError.trim()) {
    items.push({ kind: "error", id: "client-error", content: `client: ${state.lastClientError.trim()}` })
  }

  const userPrompts = state.chatUserMessages?.filter((m) => m.role === "user" && m.content.trim()) ?? []

  state.completedTurnSegments.forEach((segments, turnIndex) => {
    const prompt = userPrompts[turnIndex]
    if (prompt) {
      items.push({
        kind: "prompt",
        id: `prompt-${turnIndex}-${prompt.id}`,
        content: prompt.content,
        timestamp: prompt.timestamp,
      })
    }
    pushTurnSegments(items, segments, `turn-${turnIndex}`)
    if (segments.length > 0) {
      const stats = countTurnStats(segments)
      items.push({
        kind: "turn-divider",
        id: `turn-divider-${turnIndex}`,
        turnIndex,
        ...stats,
      })
    }
  })

  if (items.length === 0 && state.liveTranscript.length > 0) {
    state.liveTranscript.forEach((block, index) => {
      if (!block.trim()) return
      items.push({ kind: "message", id: `transcript-${index}`, content: block })
    })
  }

  // User prompt for the in-flight turn (if chatUserMessages has one more entry than completedTurnSegments)
  const currentTurnPromptIndex = state.completedTurnSegments.length
  const currentPrompt = userPrompts[currentTurnPromptIndex]
  if (currentPrompt && (state.currentTurnSegments.length > 0 || state.activeToolExecution || state.streamingAssistantText.length > 0 || state.streamingThinkingText.length > 0)) {
    items.push({
      kind: "prompt",
      id: `prompt-current-${currentPrompt.id}`,
      content: currentPrompt.content,
      timestamp: currentPrompt.timestamp,
    })
  }

  pushTurnSegments(items, state.currentTurnSegments, "current")

  if (state.activeToolExecution) {
    items.push({ kind: "active-tool", id: `active-${state.activeToolExecution.id}`, tool: state.activeToolExecution })
  }

  if (state.streamingThinkingText.length > 0) {
    items.push({ kind: "thinking", id: "streaming-thinking", content: state.streamingThinkingText, streaming: true })
  }

  if (state.streamingAssistantText.length > 0) {
    items.push({ kind: "message", id: "streaming-message", content: state.streamingAssistantText, streaming: true })
  }

  state.pendingUiRequests.forEach((request) => {
    items.push({ kind: "ui-request", id: request.id, request })
  })

  const hasStructuredItems = items.some((item) =>
    item.kind !== "status" &&
    item.kind !== "error" &&
    item.kind !== "waiting-tail" &&
    item.kind !== "prompt" &&
    item.kind !== "turn-divider",
  )

  if (!hasStructuredItems) {
    const summary = deriveAutoModeRuntimeSummary(state)
    if (summary.issueSummary) {
      items.push({ kind: "error", id: "runtime-error", content: summary.issueSummary })
    }

    if (summary.phase || summary.unitId) {
      items.push({
        kind: "status",
        id: "runtime-scope",
        label: "Runtime",
        content: [summary.phase ? `Phase: ${summary.phase}` : null, summary.unitId ? `Unit: ${summary.unitId}` : null].filter(Boolean).join(" · "),
        tone: summary.autoPresentation.tone,
      })
    }

    if (summary.latestStatusText) {
      items.push({ kind: "status", id: "runtime-status", label: "Status", content: summary.latestStatusText, tone: "muted" })
    }

    summarizeWidgetContent(state.widgetContents).forEach((widget, index) => {
      items.push({
        kind: "status",
        id: `widget-${index}-${widget.key}`,
        label: `Widget · ${widget.key}`,
        content: widget.content,
        tone: "info",
      })
    })
  } else {
    const auto = getLiveAutoDashboard(state)
    auto?.completedUnits?.forEach((unit) => {
      const finishedAt = unit.finishedAt ?? Date.now()
      items.push({
        kind: "unit-done",
        id: `unit-done-${unit.type}-${unit.id}-${finishedAt}`,
        unitType: unit.type,
        unitId: unit.id,
        durationMs: Math.max(0, finishedAt - unit.startedAt),
      })
    })
  }

  if (shouldShowWaitingTail(state, now, hasStructuredItems || items.length > 0)) {
    items.push({ kind: "waiting-tail", id: "waiting-tail", content: "Waiting for next auto event…" })
  }

  return items
}
