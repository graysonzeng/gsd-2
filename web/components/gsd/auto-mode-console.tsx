"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { deriveAutoModeTimeline, deriveAutoModeRuntimeSummary, type AutoModeTimelineItem, type PowerModeTone } from "@/lib/power-mode-context"
import { extractSubagentSnapshotGroups, type SubagentSnapshotGroup, type SubagentSnapshotItem } from "@/lib/auto-mode-subagent-details"
import { useGSDWorkspaceState, type ActiveToolExecution, type CompletedToolExecution } from "@/lib/gsd-workspace-store"
import { NotificationsBadge } from "@/components/gsd/notifications-badge"

// ─── Theme tokens (TUI-style) ────────────────────────────────────────────────
// Uses monospace, hairline borders, zero shadow, Anthropic-inspired ink/paper.

type Rail = {
  glyph: string
  glyphClass: string
  label: string
  labelClass: string
  textClass: string
}

type NonDividerKind = Exclude<AutoModeTimelineItem["kind"], "turn-divider" | "unit-done">

function rail(kind: NonDividerKind, tone: PowerModeTone, streaming: boolean): Rail {
  switch (kind) {
    case "thinking":
      return {
        glyph: "╎",
        glyphClass: "text-muted-foreground/70",
        label: streaming ? "thinking…" : "thinking",
        labelClass: "text-muted-foreground",
        textClass: "text-muted-foreground italic",
      }
    case "message":
      return {
        glyph: "▍",
        glyphClass: "text-primary/70",
        label: streaming ? "assistant…" : "assistant",
        labelClass: "text-foreground",
        textClass: "text-foreground",
      }
    case "tool":
      return {
        glyph: "▸",
        glyphClass: "text-info/80",
        label: "tool",
        labelClass: "text-info",
        textClass: "text-foreground",
      }
    case "active-tool":
      return {
        glyph: "●",
        glyphClass: "text-info animate-pulse",
        label: "running",
        labelClass: "text-info",
        textClass: "text-foreground",
      }
    case "ui-request":
      return {
        glyph: "?",
        glyphClass: "text-warning",
        label: "needs input",
        labelClass: "text-warning",
        textClass: "text-foreground",
      }
    case "error":
      return {
        glyph: "!",
        glyphClass: "text-destructive",
        label: "error",
        labelClass: "text-destructive",
        textClass: "text-destructive",
      }
    case "status":
      return {
        glyph: "─",
        glyphClass: tone === "muted" ? "text-muted-foreground/60" : "text-info/70",
        label: "status",
        labelClass: "text-muted-foreground",
        textClass: "text-muted-foreground",
      }
    case "waiting-tail":
      return {
        glyph: "▌",
        glyphClass: "text-muted-foreground/70 animate-pulse",
        label: "waiting",
        labelClass: "text-muted-foreground",
        textClass: "text-muted-foreground",
      }
    case "run-event":
      return {
        glyph: "◇",
        glyphClass: tone === "warning" ? "text-warning" : "text-muted-foreground/70",
        label: "event",
        labelClass: "text-muted-foreground",
        textClass: "text-muted-foreground",
      }
    case "prompt":
      return {
        glyph: "❯",
        glyphClass: "text-success",
        label: "user",
        labelClass: "text-success",
        textClass: "text-foreground",
      }
  }
}

function BlinkingCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[0.95em] w-[0.45em] translate-y-[0.12em] animate-pulse bg-current align-middle"
    />
  )
}

function summarizeToolArgs(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null
  if (typeof args.command === "string" && args.command.trim()) return args.command
  if (typeof args.path === "string" && args.path.trim()) return args.path
  if (typeof args.file_path === "string" && args.file_path.trim()) return args.file_path
  if (typeof args.pattern === "string" && args.pattern.trim()) return args.pattern
  const firstEntry = Object.entries(args).find(([, v]) => typeof v === "string" && v.trim().length > 0)
  return firstEntry ? String(firstEntry[1]) : null
}

function extractResultText(content: Array<{ type: string; text?: string }> | undefined): string {
  return content
    ?.filter((entry) => entry.type === "text" && entry.text)
    .map((entry) => entry.text)
    .join("\n") ?? ""
}

function shortPath(value: string | null | undefined): string {
  if (!value) return ""
  return value.length <= 64 ? value : `…${value.slice(-63)}`
}

function normalizedToolName(name: string): "bash" | "edit" | "write" | "read" | "grep" | "generic" {
  const lower = name.toLowerCase()
  if (lower === "bash" || lower === "shell") return "bash"
  if (lower === "edit" || lower === "multiedit" || lower.includes("edit")) return "edit"
  if (lower === "write" || lower === "createfile" || lower.includes("write")) return "write"
  if (lower === "read" || lower === "read_file" || lower.includes("read")) return "read"
  if (lower === "grep" || lower === "grep_search" || lower.startsWith("grep")) return "grep"
  return "generic"
}

function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0"
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(Math.round(tokens))
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  if (mins < 60) return `${mins}m${rem.toString().padStart(2, "0")}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h${(mins % 60).toString().padStart(2, "0")}m`
}

// ─── Per-item rows ───────────────────────────────────────────────────────────

function Row({
  rail: r,
  lineNumber,
  right,
  children,
}: {
  rail: Rail
  lineNumber?: number
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="group relative grid grid-cols-[36px_20px_110px_1fr_auto] gap-x-2 px-0 py-0.5 hover:bg-muted/20">
      <div className="select-none pt-0.5 text-right font-mono text-[11px] leading-5 text-muted-foreground/40 tabular-nums">
        {typeof lineNumber === "number" ? String(lineNumber).padStart(3, " ") : ""}
      </div>
      <div className={cn("select-none pt-0.5 text-center font-mono text-[13px] leading-5", r.glyphClass)}>{r.glyph}</div>
      <div className={cn("select-none truncate pt-0.5 font-mono text-[11px] uppercase leading-5 tracking-[0.12em]", r.labelClass)}>{r.label}</div>
      <div className={cn("min-w-0 font-mono text-[13px] leading-5", r.textClass)}>{children}</div>
      {right ? <div className="pt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">{right}</div> : null}
    </div>
  )
}

function MessageRow({
  rail: r,
  content,
  streaming,
  lineNumber,
}: {
  rail: Rail
  content: string
  streaming?: boolean
  lineNumber: number
}) {
  return (
    <Row rail={r} lineNumber={lineNumber}>
      <span className="whitespace-pre-wrap break-words">{content || " "}</span>
      {streaming ? <BlinkingCaret /> : null}
    </Row>
  )
}

function DiffLine({ line }: { line: string }) {
  const isAdd = line.startsWith("+") && !line.startsWith("+++")
  const isRem = line.startsWith("-") && !line.startsWith("---")
  const isHunk = line.startsWith("@@")
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words",
        isAdd && "bg-success/10 text-success",
        isRem && "bg-destructive/10 text-destructive",
        isHunk && "bg-info/10 text-info",
        !isAdd && !isRem && !isHunk && "text-muted-foreground",
      )}
    >
      {line || " "}
    </div>
  )
}

function SubagentSnapshotLine({ item }: { item: SubagentSnapshotItem }) {
  if (item.type === "assistant-text") {
    return <div className="whitespace-pre-wrap break-words text-foreground">{item.text}</div>
  }

  if (item.type === "tool-call") {
    const argSummary = summarizeToolArgs(item.args)
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1.5">
          <span className="text-info">▸</span>
          <span className="font-medium text-foreground">{item.name}</span>
          {argSummary ? <span className="whitespace-pre-wrap break-words text-muted-foreground">{shortPath(argSummary)}</span> : null}
        </div>
        {item.resultText ? (
          <div className={cn("ml-5 border-l border-border/40 pl-2 whitespace-pre-wrap break-words", item.resultIsError ? "text-destructive" : "text-muted-foreground")}>
            <span className="text-muted-foreground/70">↳ result</span>
            <span>{`: ${item.resultText}`}</span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn("whitespace-pre-wrap break-words", item.isError ? "text-destructive" : "text-muted-foreground")}>
      <span className="text-muted-foreground/70">↳ {item.toolName}</span>
      {item.text ? <span>{`: ${item.text}`}</span> : null}
    </div>
  )
}

function SubagentSnapshotBody({
  groups,
  liveTag,
}: {
  groups: SubagentSnapshotGroup[]
  liveTag: React.ReactNode
}) {
  return (
    <div className="ml-[164px] mr-2 rounded-sm border-l border-border/50 bg-background/40 px-3 py-1.5 font-mono text-[11px] leading-[1.45]">
      {liveTag}
      {groups.map((group, groupIndex) => (
        <div key={`${group.agent}-${group.step ?? "na"}-${groupIndex}`} className={cn(groupIndex > 0 ? "mt-3 border-t border-border/40 pt-2" : "") }>
          <div className="mb-1 text-muted-foreground/70">
            {group.agent}
            {typeof group.step === "number" ? <span>{` · step ${group.step}`}</span> : null}
          </div>
          <div className="space-y-1">
            {group.items.map((item, itemIndex) => (
              <SubagentSnapshotLine key={`${group.agent}-${group.step ?? "na"}-${itemIndex}`} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ToolBody({
  tool,
  resultText,
  isActive,
}: {
  tool: CompletedToolExecution | ActiveToolExecution
  resultText: string
  isActive: boolean
}) {
  const kind = normalizedToolName(tool.name)
  const isError = Boolean(("result" in tool && tool.result?.isError))
  const diff =
    "result" in tool && typeof tool.result?.details?.diff === "string"
      ? (tool.result.details.diff as string)
      : null
  const subagentSnapshot = extractSubagentSnapshotGroups(tool.result?.details)

  const liveTag = isActive ? (
    <div className="mb-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-info">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
      live · partial output
    </div>
  ) : null

  if (subagentSnapshot) {
    return <SubagentSnapshotBody groups={subagentSnapshot} liveTag={liveTag} />
  }

  // Edit / MultiEdit with diff: colored unified diff
  if (kind === "edit" && diff) {
    return (
      <div className="ml-[164px] mr-2 rounded-sm border-l border-border/50 bg-background/40 px-3 py-1.5 font-mono text-[11px] leading-[1.45]">
        {liveTag}
        {diff.split("\n").slice(0, 120).map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
        {diff.split("\n").length > 120 ? (
          <div className="text-muted-foreground/70">…{diff.split("\n").length - 120} more lines</div>
        ) : null}
      </div>
    )
  }

  // Bash: command + output
  if (kind === "bash") {
    const command = typeof tool.args?.command === "string" ? tool.args.command : ""
    return (
      <div className="ml-[164px] mr-2 rounded-sm border-l border-border/50 bg-background/40 px-3 py-1.5 font-mono text-[11px] leading-[1.45]">
        {liveTag}
        {command ? (
          <div className="mb-1 flex items-start gap-1.5">
            <span className="text-success">$</span>
            <span className="whitespace-pre-wrap break-words text-foreground">{command}</span>
          </div>
        ) : null}
        {resultText ? (
          <pre className={cn("whitespace-pre-wrap break-words", isError ? "text-destructive" : "text-muted-foreground")}>
            {resultText.length > 2400 ? `${resultText.slice(0, 2400)}\n…` : resultText}
          </pre>
        ) : null}
      </div>
    )
  }

  // Read / Write: path header + text preview
  if ((kind === "read" || kind === "write") && resultText) {
    const path = (typeof tool.args?.path === "string" && tool.args.path)
      || (typeof tool.args?.file_path === "string" && tool.args.file_path)
      || ""
    return (
      <div className="ml-[164px] mr-2 rounded-sm border-l border-border/50 bg-background/40 px-3 py-1.5 font-mono text-[11px] leading-[1.45] text-muted-foreground">
        {liveTag}
        {path ? <div className="mb-1 text-muted-foreground/70">▸ {shortPath(path)}</div> : null}
        <pre className="whitespace-pre-wrap break-words">
          {resultText.length > 2400 ? `${resultText.slice(0, 2400)}\n…` : resultText}
        </pre>
      </div>
    )
  }

  // Generic preview
  if (!resultText && !isActive) return null
  return (
    <div className="ml-[164px] mr-2 rounded-sm border-l border-border/50 bg-background/40 px-3 py-1.5 font-mono text-[11px] leading-[1.45] text-muted-foreground">
      {liveTag}
      {resultText ? (
        <pre className="whitespace-pre-wrap break-words">
          {resultText.length > 2400 ? `${resultText.slice(0, 2400)}\n…` : resultText}
        </pre>
      ) : (
        <div className="text-muted-foreground/60">(waiting for first output…)</div>
      )}
    </div>
  )
}

function ToolRow({
  item,
  lineNumber,
}: {
  item: Extract<AutoModeTimelineItem, { kind: "tool" | "active-tool" }>
  lineNumber: number
}) {
  const tool = item.tool
  const isError = Boolean(("result" in tool && tool.result?.isError))
  const r = rail(item.kind, isError ? "danger" : "info", false)
  const [expanded, setExpanded] = useState(item.kind === "active-tool")
  const argSummary = summarizeToolArgs(tool.args)
  const resultText = extractResultText(tool.result?.content)
  const hasSubagentSnapshot = Boolean(extractSubagentSnapshotGroups(tool.result?.details))
  const hasBody = resultText.length > 0 || normalizedToolName(tool.name) === "edit" || hasSubagentSnapshot

  return (
    <div className="flex flex-col gap-0.5">
      <Row
        rail={isError ? { ...r, glyph: "×", glyphClass: "text-destructive", labelClass: "text-destructive" } : r}
        lineNumber={lineNumber}
        right={hasBody ? (expanded ? "[collapse]" : "[expand]") : null}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-baseline gap-2 text-left"
        >
          <span className={cn("font-mono font-medium", isError ? "text-destructive" : "text-foreground")}>{tool.name}</span>
          {argSummary ? (
            <span className="truncate font-mono text-muted-foreground/90" title={argSummary}>
              {shortPath(argSummary)}
            </span>
          ) : null}
        </button>
      </Row>
      {expanded && (hasBody || item.kind === "active-tool") ? (
        <ToolBody tool={tool} resultText={resultText} isActive={item.kind === "active-tool"} />
      ) : null}
    </div>
  )
}

function TurnDivider({
  turnIndex,
  toolCount,
  messageCount,
  thinkingCount,
}: {
  turnIndex: number
  toolCount: number
  messageCount: number
  thinkingCount: number
}) {
  const stats: string[] = []
  if (messageCount > 0) stats.push(`${messageCount} msg${messageCount > 1 ? "s" : ""}`)
  if (toolCount > 0) stats.push(`${toolCount} tool${toolCount > 1 ? "s" : ""}`)
  if (thinkingCount > 0) stats.push(`${thinkingCount} think${thinkingCount > 1 ? "s" : ""}`)
  return (
    <div className="my-1 flex items-center gap-2 px-2" aria-hidden>
      <span className="h-px flex-1 bg-border/40" />
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
        turn {String(turnIndex + 1).padStart(2, "0")} · end
        {stats.length > 0 ? ` · ${stats.join(" · ")}` : ""}
      </span>
      <span className="h-px flex-1 bg-border/40" />
    </div>
  )
}

function UnitDoneRow({
  unitType,
  unitId,
  durationMs,
  lineNumber,
}: {
  unitType: string
  unitId: string
  durationMs: number
  lineNumber: number
}) {
  return (
    <Row
      rail={{
        glyph: "✓",
        glyphClass: "text-success",
        label: "unit done",
        labelClass: "text-success",
        textClass: "text-foreground",
      }}
      lineNumber={lineNumber}
    >
      <span className="font-mono">
        <span className="text-muted-foreground/70 uppercase tracking-[0.12em]">{unitType}</span>{" "}
        <span className="text-foreground font-medium">{unitId}</span>
        {durationMs > 0 ? (
          <span className="ml-2 text-muted-foreground/70">· {formatElapsed(durationMs)}</span>
        ) : null}
      </span>
    </Row>
  )
}

function PhaseMarkerRow({ from, to, lineNumber }: { from: string | null; to: string; lineNumber: number }) {
  return (
    <Row
      rail={{
        glyph: "»",
        glyphClass: "text-warning",
        label: "phase",
        labelClass: "text-warning",
        textClass: "text-foreground",
      }}
      lineNumber={lineNumber}
    >
      <span className="font-mono font-medium">
        {from ? <span className="text-muted-foreground">{from} </span> : null}
        <span className="text-muted-foreground">→ </span>
        <span className="text-foreground">{to}</span>
      </span>
    </Row>
  )
}

function TimelineRow({ item, lineNumber }: { item: AutoModeTimelineItem; lineNumber: number }) {
  switch (item.kind) {
    case "thinking":
      return <MessageRow rail={rail("thinking", "muted", Boolean(item.streaming))} content={item.content || "…"} streaming={item.streaming} lineNumber={lineNumber} />
    case "message":
      return <MessageRow rail={rail("message", "info", Boolean(item.streaming))} content={item.content || "…"} streaming={item.streaming} lineNumber={lineNumber} />
    case "tool":
    case "active-tool":
      return <ToolRow item={item} lineNumber={lineNumber} />
    case "ui-request": {
      const r = rail("ui-request", "warning", false)
      return (
        <Row rail={r} lineNumber={lineNumber}>
          <span className="font-mono">{item.request.title || item.request.method}</span>
        </Row>
      )
    }
    case "status": {
      const r = rail("status", item.tone, false)
      return (
        <Row rail={{ ...r, label: item.label.toLowerCase() }} lineNumber={lineNumber}>
          <span className="font-mono">{item.content}</span>
        </Row>
      )
    }
    case "error": {
      const r = rail("error", "danger", false)
      return (
        <Row rail={r} lineNumber={lineNumber}>
          <span className="whitespace-pre-wrap break-words font-mono">{item.content}</span>
        </Row>
      )
    }
    case "waiting-tail": {
      const r = rail("waiting-tail", "muted", false)
      return (
        <Row rail={r} lineNumber={lineNumber}>
          <span className="font-mono text-muted-foreground">{item.content}</span>
        </Row>
      )
    }
    case "run-event": {
      const r = rail("run-event", item.tone, false)
      return (
        <Row rail={{ ...r, label: item.label }} lineNumber={lineNumber}>
          <span className="whitespace-pre-wrap break-words font-mono">{item.content}</span>
        </Row>
      )
    }
    case "turn-divider":
      return (
        <TurnDivider
          turnIndex={item.turnIndex}
          toolCount={item.toolCount}
          messageCount={item.messageCount}
          thinkingCount={item.thinkingCount}
        />
      )
    case "prompt": {
      const r = rail("prompt", "success", false)
      return (
        <Row rail={r} lineNumber={lineNumber}>
          <span className="whitespace-pre-wrap break-words font-mono text-foreground">{item.content}</span>
        </Row>
      )
    }
    case "unit-done":
      return (
        <UnitDoneRow
          unitType={item.unitType}
          unitId={item.unitId}
          durationMs={item.durationMs}
          lineNumber={lineNumber}
        />
      )
  }
}

// ─── Header / footer chrome ──────────────────────────────────────────────────

function HeaderBadge({ label, value, tone = "muted" }: { label: string; value: string; tone?: PowerModeTone }) {
  const toneText =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger" ? "text-destructive" :
    tone === "info" ? "text-info" :
    "text-muted-foreground"
  return (
    <div className="flex items-baseline gap-1 font-mono text-[11px]">
      <span className="uppercase tracking-[0.14em] text-muted-foreground/80">{label}</span>
      <span className={cn("font-medium", toneText)}>{value}</span>
    </div>
  )
}

function StatusStrip({
  phase,
  unit,
  project,
  statusText,
  widgetLine,
  connected,
}: {
  phase: string | null
  unit: string | null
  project: string
  statusText: string | null
  widgetLine: string | null
  connected: boolean
}) {
  const parts: Array<{ label: string; value: string }> = []
  if (phase) parts.push({ label: "phase", value: phase })
  if (unit) parts.push({ label: "unit", value: unit })
  if (statusText) parts.push({ label: "status", value: statusText })
  if (widgetLine) parts.push({ label: "widget", value: widgetLine })

  return (
    <div className="flex items-center gap-3 border-t border-border/50 bg-card/60 px-4 py-1.5 font-mono text-[11px] leading-4">
      <span className={cn("inline-flex items-center gap-1", connected ? "text-success" : "text-muted-foreground")}>
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-muted-foreground/60")} />
        <span>{connected ? "online" : "offline"}</span>
      </span>
      <span className="truncate text-muted-foreground">{project}</span>
      {parts.map((part) => (
        <span key={part.label} className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <span className="uppercase tracking-[0.14em] text-muted-foreground/70">{part.label}</span>
          <span className="truncate text-foreground/90" title={part.value}>
            {part.value.length > 48 ? `${part.value.slice(0, 47)}…` : part.value}
          </span>
        </span>
      ))}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AutoModeConsole({ className }: { className?: string }) {
  const workspace = useGSDWorkspaceState()
  const runtime = useMemo(() => deriveAutoModeRuntimeSummary(workspace), [workspace])
  const timeline = useMemo(() => deriveAutoModeTimeline(workspace), [workspace])
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const [isFollowing, setIsFollowing] = useState(true)

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    isNearBottomRef.current = nearBottom
    setIsFollowing(nearBottom)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (isNearBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [timeline])

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    isNearBottomRef.current = true
    setIsFollowing(true)
  }, [])

  const kindCounts = useMemo(() => {
    const c = { tool: 0, thinking: 0, message: 0, active: 0, error: 0, prompt: 0 }
    for (const item of timeline) {
      if (item.kind === "tool") c.tool += 1
      else if (item.kind === "active-tool") c.active += 1
      else if (item.kind === "thinking") c.thinking += 1
      else if (item.kind === "message") c.message += 1
      else if (item.kind === "error") c.error += 1
      else if (item.kind === "prompt") c.prompt += 1
    }
    return c
  }, [timeline])

  const latestWidgetLine = useMemo(() => {
    const widgets = workspace.widgetContents
    const keys = Object.keys(widgets).sort()
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const w = widgets[keys[i]]
      if (w?.lines && w.lines.length > 0) return w.lines[0] ?? null
    }
    return null
  }, [workspace.widgetContents])

  // Phase transition tracking — renders as phase-marker rows at the top of timeline.
  const [phaseTransitions, setPhaseTransitions] = useState<Array<{ from: string | null; to: string; at: number }>>([])
  const prevPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    const next = runtime.phase
    if (!next) return
    const prev = prevPhaseRef.current
    if (prev === next) return
    prevPhaseRef.current = next
    setPhaseTransitions((existing) => {
      const appended = [...existing, { from: prev, to: next, at: Date.now() }]
      return appended.length > 6 ? appended.slice(appended.length - 6) : appended
    })
  }, [runtime.phase])

  const connected = workspace.connectionState === "connected"
  const showEmpty = timeline.length === 0 && phaseTransitions.length === 0

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/70 bg-terminal font-mono",
        className,
      )}
      data-testid="auto-mode-console"
    >
      {/* Header — Row 1: identity */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/50 bg-card/60 px-4 py-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", runtime.autoPresentation.tone === "success" ? "bg-success animate-pulse" : "bg-muted-foreground/40")} />
            auto-console
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/70">·</span>
          <HeaderBadge label="auto" value={runtime.autoPresentation.label.toLowerCase()} tone={runtime.autoPresentation.tone} />
          <HeaderBadge label="bridge" value={runtime.bridgePresentation.label.toLowerCase()} tone={runtime.bridgePresentation.tone === "success" ? "success" : runtime.bridgePresentation.tone === "warning" ? "warning" : runtime.bridgePresentation.tone === "danger" ? "danger" : "muted"} />
          {runtime.phase ? <HeaderBadge label="phase" value={runtime.phase} tone="warning" /> : null}
          {runtime.milestoneId ? <HeaderBadge label="mile" value={runtime.milestoneId} tone="info" /> : null}
          {runtime.unitId ? <HeaderBadge label="unit" value={runtime.unitId} tone="info" /> : null}
          {runtime.modelLabel ? <HeaderBadge label="model" value={runtime.modelLabel} tone="info" /> : null}
          {runtime.sessionIdShort ? <HeaderBadge label="sid" value={runtime.sessionIdShort} /> : null}
          {runtime.isStreaming ? (
            <span className="inline-flex items-baseline gap-1 font-mono text-[11px] text-success">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              streaming
            </span>
          ) : null}
          {runtime.isCompacting ? (
            <span className="inline-flex items-baseline gap-1 font-mono text-[11px] text-warning">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
              compacting
            </span>
          ) : null}
          {runtime.activeToolLabel ? <HeaderBadge label="tool" value={runtime.activeToolLabel} tone="info" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {runtime.totalTokens > 0 ? <HeaderBadge label="tok" value={formatTokens(runtime.totalTokens)} /> : null}
          {runtime.totalCost > 0 ? <HeaderBadge label="$" value={`$${runtime.totalCost.toFixed(2)}`} tone="info" /> : null}
          {runtime.elapsedMs > 0 ? <HeaderBadge label="up" value={formatElapsed(runtime.elapsedMs)} /> : null}
          {runtime.rtkSavedTokens > 0 ? <HeaderBadge label="rtk" value={`−${formatTokens(runtime.rtkSavedTokens)}`} tone="success" /> : null}
          <NotificationsBadge projectCwd={workspace.boot?.project.cwd} />
        </div>
      </div>

      {/* Header — Row 2: counters */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 bg-card/30 px-4 py-1">
        <div className="flex flex-wrap items-center gap-3">
          <HeaderBadge
            label="done"
            value={runtime.hasInFlightTurn ? `${runtime.completedTurns}+1·live` : String(runtime.completedTurns)}
            tone={runtime.hasInFlightTurn ? "info" : "muted"}
          />
          <HeaderBadge label="msgs" value={String(kindCounts.message)} />
          <HeaderBadge label="tools" value={String(kindCounts.tool + kindCounts.active)} />
          <HeaderBadge label="thinks" value={String(kindCounts.thinking)} />
          {kindCounts.prompt > 0 ? <HeaderBadge label="prompts" value={String(kindCounts.prompt)} tone="success" /> : null}
          {runtime.completedUnitsCount > 0 ? <HeaderBadge label="units" value={String(runtime.completedUnitsCount)} tone="success" /> : null}
          {runtime.pendingUiCount > 0 ? <HeaderBadge label="pending" value={String(runtime.pendingUiCount)} tone="warning" /> : null}
          {runtime.statusTextCount > 0 ? <HeaderBadge label="sts" value={String(runtime.statusTextCount)} /> : null}
          {runtime.widgetCount > 0 ? <HeaderBadge label="wid" value={String(runtime.widgetCount)} /> : null}
          {kindCounts.error > 0 ? <HeaderBadge label="err" value={String(kindCounts.error)} tone="danger" /> : null}
        </div>
        {!isFollowing && timeline.length > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-info hover:underline"
          >
            ↓ jump to latest
          </button>
        ) : null}
      </div>

      {/* Body */}
      {showEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center font-mono">
          <div className="inline-flex items-center gap-2 text-[12px] text-muted-foreground/80">
            <span className="inline-block h-2 w-2 animate-pulse bg-muted-foreground/60" />
            <span className="uppercase tracking-[0.2em]">idle</span>
          </div>
          <div>
            <div className="text-[12px] text-foreground">No live auto events yet</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {runtime.phase ? `current phase: ${runtime.phase}` : "waiting for next runtime update…"}
            </div>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2">
          <div className="flex flex-col">
            {phaseTransitions.map((t, idx) => (
              <PhaseMarkerRow key={`phase-${idx}-${t.at}`} from={t.from} to={t.to} lineNumber={idx + 1} />
            ))}
            {phaseTransitions.length > 0 && timeline.length > 0 ? (
              <div className="my-1 h-px bg-border/30" aria-hidden />
            ) : null}
            {timeline.map((item, idx) => (
              <TimelineRow key={item.id} item={item} lineNumber={phaseTransitions.length + idx + 1} />
            ))}
          </div>
        </div>
      )}

      {/* Footer status strip */}
      <StatusStrip
        phase={runtime.phase}
        unit={runtime.unitId}
        project={runtime.projectLabel}
        statusText={runtime.latestStatusText}
        widgetLine={latestWidgetLine}
        connected={connected}
      />
    </div>
  )
}
