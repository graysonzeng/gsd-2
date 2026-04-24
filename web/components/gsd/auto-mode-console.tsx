"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Clock3, Loader2, TerminalSquare, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { deriveAutoModeTimeline, deriveAutoModeRuntimeSummary, type AutoModeTimelineItem, type PowerModeTone } from "@/lib/power-mode-context"
import { useGSDWorkspaceState } from "@/lib/gsd-workspace-store"

function toneClass(tone: PowerModeTone): string {
  switch (tone) {
    case "success":
      return "border-success/20 bg-success/10 text-success"
    case "warning":
      return "border-warning/20 bg-warning/10 text-warning"
    case "danger":
      return "border-destructive/20 bg-destructive/10 text-destructive"
    case "info":
      return "border-primary/20 bg-primary/10 text-primary"
    default:
      return "border-border/60 bg-muted/60 text-muted-foreground"
  }
}

function summarizeToolArgs(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null
  if (typeof args.command === "string" && args.command.trim()) return args.command
  if (typeof args.path === "string" && args.path.trim()) return args.path
  if (typeof args.file_path === "string" && args.file_path.trim()) return args.file_path
  const firstEntry = Object.entries(args).find(([, value]) => typeof value === "string" && value.trim().length > 0)
  return firstEntry ? String(firstEntry[1]) : null
}

function extractToolResultText(content: Array<{ type: string; text?: string }> | undefined): string {
  return content
    ?.filter((entry) => entry.type === "text" && entry.text)
    .map((entry) => entry.text)
    .join("\n") ?? ""
}

function StatusBlock({ label, content, tone }: { label: string; content: string; tone: PowerModeTone }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", toneClass(tone))}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="text-sm leading-6">{content}</div>
    </div>
  )
}

function ToolBlock({ item }: { item: Extract<AutoModeTimelineItem, { kind: "tool" | "active-tool" }> }) {
  const [expanded, setExpanded] = useState(item.kind === "active-tool")
  const label = item.kind === "active-tool" ? "Tool running" : "Tool completed"
  const tool = item.tool
  const summary = summarizeToolArgs(tool.args)
  const resultText = extractToolResultText(tool.result?.content)
  const isError = Boolean(tool.result?.isError)

  return (
    <div className={cn("rounded-lg border px-3 py-2", isError ? "border-destructive/30 bg-destructive/5" : "border-border/60 bg-card/80")}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
      >
        {item.kind === "active-tool"
          ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          : <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
          <div className="flex items-center gap-2 text-sm leading-6">
            <span className="font-mono font-medium">{tool.name}</span>
            {summary ? <span className="truncate text-muted-foreground">{summary}</span> : null}
          </div>
        </div>
        {resultText || item.kind === "active-tool"
          ? expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          : null}
      </button>
      {expanded && resultText ? (
        <div className={cn("mt-2 rounded-md border px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap", isError ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-border/50 bg-background/70 text-muted-foreground")}>
          {resultText.length > 2400 ? `${resultText.slice(0, 2400)}\n…` : resultText}
        </div>
      ) : null}
    </div>
  )
}

function TimelineItemView({ item }: { item: AutoModeTimelineItem }) {
  switch (item.kind) {
    case "thinking":
      return (
        <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Thinking{item.streaming ? " · live" : ""}</div>
          <div className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.content || "…"}</div>
        </div>
      )
    case "message":
      return (
        <div className="rounded-lg border border-border/60 bg-card/80 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Assistant{item.streaming ? " · live" : ""}</div>
          <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{item.content || "…"}</div>
        </div>
      )
    case "tool":
    case "active-tool":
      return <ToolBlock item={item} />
    case "ui-request":
      return <StatusBlock label="Needs input" content={item.request.title || item.request.method} tone="warning" />
    case "status":
      return <StatusBlock label={item.label} content={item.content} tone={item.tone} />
    case "error":
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]">
            <AlertTriangle className="h-3.5 w-3.5" />
            Issue
          </div>
          <div className="whitespace-pre-wrap text-sm leading-6">{item.content}</div>
        </div>
      )
    case "waiting-tail":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          <span>{item.content}</span>
        </div>
      )
  }
}

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

  const showEmpty = timeline.length === 0

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-terminal", className)} data-testid="auto-mode-console">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-card/70 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Auto Mode Console</div>
          <div className="truncate text-xs text-muted-foreground">Live auto-mode execution stream</div>
        </div>
        <div className="flex items-center gap-2">
          {runtime.activeToolLabel ? (
            <Badge variant="outline" className={cn("h-6 rounded-full px-2 text-[10px] font-medium", toneClass("info"))}>
              <Wrench className="mr-1 h-3 w-3" />
              {runtime.activeToolLabel}
            </Badge>
          ) : null}
          {!isFollowing && timeline.length > 0 ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={jumpToLatest}>
              Jump to latest
            </Button>
          ) : null}
        </div>
      </div>

      {showEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <TerminalSquare className="h-10 w-10 text-muted-foreground/60" />
          <div>
            <div className="text-sm font-medium text-foreground">No live auto events yet</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {runtime.phase ? `Current phase: ${runtime.phase}` : "Waiting for the next runtime update…"}
            </div>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto flex max-w-4xl flex-col gap-3">
            {timeline.map((item) => (
              <TimelineItemView key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
