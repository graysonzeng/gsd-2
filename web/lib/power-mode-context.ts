import {
  getCurrentScopeLabel,
  getLiveAutoDashboard,
  getLiveWorkspaceIndex,
  getProjectDisplayName,
  getStatusPresentation,
  getVisibleWorkspaceError,
  type ActiveToolExecution,
  type AutoDashboardData,
  type CompletedToolExecution,
  type PendingUiRequest,
  type TurnSegment,
  type WidgetContent,
  type WorkspaceIndex,
  type WorkspaceStoreState,
} from "./gsd-workspace-store"

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
  | { kind: "tool"; id: string; tool: CompletedToolExecution }
  | { kind: "active-tool"; id: string; tool: ActiveToolExecution }
  | { kind: "ui-request"; id: string; request: PendingUiRequest }
  | { kind: "status"; id: string; label: string; content: string; tone: PowerModeTone }
  | { kind: "error"; id: string; content: string }
  | { kind: "waiting-tail"; id: string; content: string }

export interface AutoModeRuntimeSummary {
  projectLabel: string
  autoPresentation: PowerModePresentation
  bridgePresentation: ReturnType<typeof getStatusPresentation>
  phase: string | null
  unitId: string | null
  scopeLabel: string
  activeToolLabel: string | null
  issueSummary: string | null
  latestStatusText: string | null
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
>

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
  const autoInProgress = Boolean(auto?.active || auto?.paused || (phase && phase !== "complete"))
  if (!autoInProgress) return false

  const updatedAt = state.boot?.bridge?.updatedAt ? Date.parse(state.boot.bridge.updatedAt) : NaN
  if (Number.isFinite(updatedAt) && now - updatedAt < WAITING_TAIL_THRESHOLD_MS) return false

  return true
}

export function getPowerModeAutoPresentation(
  auto: AutoDashboardData | null | undefined,
  workspace: WorkspaceIndex | null | undefined,
): PowerModePresentation {
  if (auto?.active) return { label: "Active", tone: "success" }
  if (auto?.paused) return { label: "Paused", tone: "warning" }
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
  const unitId = getCurrentUnitId(auto, workspace)
  return {
    projectLabel: getProjectDisplayName(state.boot?.project.cwd),
    autoPresentation: getPowerModeAutoPresentation(auto, workspace),
    bridgePresentation: getStatusPresentation(state),
    phase,
    unitId,
    scopeLabel: getCurrentScopeLabel(workspace),
    activeToolLabel: state.activeToolExecution?.name ?? null,
    issueSummary: summarizeContextError(getVisibleWorkspaceError(state)),
    latestStatusText: latestStatusText(state.statusTexts),
  }
}

export function deriveAutoModeTimeline(state: AutoModeState, now = Date.now()): AutoModeTimelineItem[] {
  const items: AutoModeTimelineItem[] = []

  state.completedTurnSegments.forEach((segments, turnIndex) => {
    pushTurnSegments(items, segments, `turn-${turnIndex}`)
  })

  if (items.length === 0 && state.liveTranscript.length > 0) {
    state.liveTranscript.forEach((block, index) => {
      if (!block.trim()) return
      items.push({ kind: "message", id: `transcript-${index}`, content: block })
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

  const hasStructuredItems = items.some((item) => item.kind !== "status" && item.kind !== "error" && item.kind !== "waiting-tail")

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
  }

  if (shouldShowWaitingTail(state, now, hasStructuredItems || items.length > 0)) {
    items.push({ kind: "waiting-tail", id: "waiting-tail", content: "Waiting for next auto event…" })
  }

  return items
}
