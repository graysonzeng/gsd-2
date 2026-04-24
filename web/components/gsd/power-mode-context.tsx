"use client"

import { AlertTriangle, Info, Loader2, PauseCircle, PlayCircle, TerminalSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { PanePresentation, PowerModePresentation } from "@/lib/power-mode-context"

function badgeToneClass(tone: PowerModePresentation["tone"]): string {
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

function renderToneIcon(tone: PowerModePresentation["tone"], isSpinning: boolean) {
  const className = cn("h-3.5 w-3.5 shrink-0", isSpinning && "animate-spin")
  switch (tone) {
    case "success":
      return <PlayCircle className={className} />
    case "warning":
      return <PauseCircle className={className} />
    case "danger":
      return <AlertTriangle className={className} />
    case "info":
      return <Loader2 className={className} />
    default:
      return <Info className={className} />
  }
}

export function PowerModeChip({
  label,
  value,
  tone = "muted",
  testId,
  title,
}: {
  label: string
  value: string
  tone?: PowerModePresentation["tone"]
  testId?: string
  title?: string
}) {
  const isSpinning = tone === "info"

  return (
    <Badge
      variant="outline"
      className={cn("h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-normal", badgeToneClass(tone))}
      data-testid={testId}
      title={title}
    >
      <span className="text-muted-foreground/90">{label}:</span>
      <span className="inline-flex items-center gap-1 font-medium">
        {renderToneIcon(tone, isSpinning)}
        <span className="max-w-[18rem] truncate">{value}</span>
      </span>
    </Badge>
  )
}

export function PowerModePaneHeader({
  title,
  subtitle,
  presentation,
  summary,
  testId,
}: {
  title: string
  subtitle: string
  presentation: PanePresentation
  summary?: string | null
  testId?: string
}) {
  return (
    <div className="border-b border-border/70 bg-card/70" data-testid={testId} role="region" aria-label={title}>
      <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{title}</div>
          <div className="hidden truncate text-[11px] text-muted-foreground md:block">{subtitle}</div>
        </div>
        <Badge variant="outline" className={cn("h-6 shrink-0 rounded-full px-2 text-[10px] font-medium", badgeToneClass(presentation.tone))} role="status">
          {presentation.label}
        </Badge>
      </div>
      {summary ? (
        <div className="border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="block truncate">{summary}</span>
        </div>
      ) : null}
    </div>
  )
}

export function PowerModePaneShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex h-full min-w-0 flex-col overflow-hidden border border-border/70 bg-terminal", className)}>{children}</div>
}

export function PowerModePaneBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-hidden", className)}>{children}</div>
}

export function PowerModeTerminalHint({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon ?? <TerminalSquare className="h-3 w-3" />}<span>{text}</span></div>
}
