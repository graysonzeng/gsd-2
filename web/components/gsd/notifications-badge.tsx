"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  clearAllNotifications,
  fetchNotificationsDetails,
  markAllNotificationsRead,
  useUnreadNotificationsCount,
  type NotificationEntry,
  type NotificationsPayload,
  type NotificationSeverity,
} from "@/hooks/use-notifications"

const MAX_LIST_ENTRIES = 20

function severityGlyph(sev: NotificationSeverity): string {
  switch (sev) {
    case "error":
      return "!"
    case "warning":
      return "⚠"
    case "success":
      return "✓"
    case "info":
    default:
      return "•"
  }
}

function severityClass(sev: NotificationSeverity): string {
  switch (sev) {
    case "error":
      return "text-destructive"
    case "warning":
      return "text-warning"
    case "success":
      return "text-success"
    case "info":
    default:
      return "text-muted-foreground"
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ts
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return ts
  }
}

function truncate(message: string, max = 140): string {
  if (message.length <= max) return message
  return `${message.slice(0, max - 1)}…`
}

export function NotificationsBadge({ projectCwd }: { projectCwd: string | null | undefined }) {
  const { count, refresh } = useUnreadNotificationsCount(projectCwd ?? undefined)
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<NotificationsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markingRead, setMarkingRead] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const loadDetails = useCallback(async () => {
    if (!projectCwd) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchNotificationsDetails(projectCwd)
      setPayload(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectCwd])

  useEffect(() => {
    if (!open) {
      setConfirmClear(false)
      return
    }
    loadDetails()
  }, [open, loadDetails, count])

  const handleMarkRead = useCallback(async () => {
    if (!projectCwd || !payload || payload.unreadCount <= 0) return
    setMarkingRead(true)
    try {
      await markAllNotificationsRead(projectCwd)
      setPayload({
        ...payload,
        unreadCount: 0,
        entries: payload.entries.map((entry) => ({ ...entry, read: true })),
      })
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMarkingRead(false)
    }
  }, [projectCwd, payload, refresh])

  const handleClear = useCallback(async () => {
    if (!projectCwd) return
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setClearing(true)
    try {
      await clearAllNotifications(projectCwd)
      setPayload({ entries: [], unreadCount: 0, totalCount: 0 })
      refresh()
      setConfirmClear(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setClearing(false)
    }
  }, [projectCwd, confirmClear, refresh])

  if (count <= 0 && !open) return null

  const entries = payload?.entries ?? []
  const visibleEntries = entries.slice(0, MAX_LIST_ENTRIES)
  const moreCount = Math.max(0, entries.length - visibleEntries.length)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={count > 0 ? `${count} unread notifications` : "notifications"}
          className={cn(
            "inline-flex items-baseline gap-1 font-mono text-[11px] hover:underline",
            count > 0 ? "text-warning" : "text-muted-foreground/70",
          )}
        >
          <span className="uppercase tracking-[0.14em] text-muted-foreground/80">🔔</span>
          <span className="font-medium">{count}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-50 w-[420px] max-w-[92vw] rounded-md border border-border/70 bg-terminal p-0 font-mono text-[12px] shadow-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-3 py-1.5">
          <div className="flex items-baseline gap-2">
            <span className="uppercase tracking-[0.16em] text-muted-foreground/80">notifications</span>
            {payload ? (
              <span className={cn("text-[11px]", payload.unreadCount > 0 ? "text-warning" : "text-muted-foreground/70")}>
                {payload.unreadCount > 0
                  ? `${payload.unreadCount} unread · ${payload.totalCount} total`
                  : `${payload.totalCount} total`}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleMarkRead}
              disabled={markingRead || loading || (payload?.unreadCount ?? 0) === 0}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-info hover:underline disabled:opacity-40 disabled:hover:no-underline"
            >
              {markingRead ? "marking…" : "mark all read"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing || (!payload && !loading) || (payload?.totalCount ?? 0) === 0}
              className={cn(
                "font-mono text-[11px] uppercase tracking-[0.14em]",
                confirmClear
                  ? "text-destructive hover:underline"
                  : "text-muted-foreground/80 hover:text-destructive hover:underline",
                "disabled:opacity-40 disabled:hover:no-underline",
              )}
            >
              {clearing ? "clearing…" : confirmClear ? "confirm clear?" : "clear all"}
            </button>
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto px-2 py-1">
          {loading && !payload ? (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground/70">loading…</div>
          ) : error ? (
            <div className="px-2 py-4 text-[11px] text-destructive">error: {error}</div>
          ) : visibleEntries.length === 0 ? (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground/70">no notifications</div>
          ) : (
            <ul className="flex flex-col">
              {visibleEntries.map((entry) => (
                <NotificationRow key={entry.id} entry={entry} />
              ))}
              {moreCount > 0 ? (
                <li className="px-2 py-1 text-[11px] text-muted-foreground/60">
                  …{moreCount} more (run <span className="text-foreground">/gsd notifications</span> to see all)
                </li>
              ) : null}
            </ul>
          )}
        </div>

        <div className="border-t border-border/60 bg-card/40 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
          ⌃⌥N in terminal · /gsd notifications
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({ entry }: { entry: NotificationEntry }) {
  return (
    <li
      className={cn(
        "flex items-start gap-2 border-b border-border/30 px-2 py-1 last:border-b-0",
        !entry.read && "bg-muted/20",
      )}
    >
      <span className={cn("select-none pt-[2px] font-mono text-[12px]", severityClass(entry.severity))}>
        {severityGlyph(entry.severity)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          <span className={cn("font-medium", severityClass(entry.severity))}>{entry.severity}</span>
          <span>{formatTime(entry.ts)}</span>
          <span className="text-muted-foreground/50">· {entry.source}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-foreground/90">{truncate(entry.message)}</div>
      </div>
    </li>
  )
}
