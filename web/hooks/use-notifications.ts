"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { authFetch } from "@/lib/auth"
import { buildProjectPath } from "@/lib/project-url"

export type NotificationSeverity = "info" | "success" | "warning" | "error"

export interface NotificationEntry {
  id: string
  ts: string
  severity: NotificationSeverity
  message: string
  source: string
  read: boolean
}

export interface NotificationsPayload {
  entries: NotificationEntry[]
  unreadCount: number
  totalCount: number
}

export const NOTIFICATIONS_POLL_MS = 30_000

export async function fetchNotificationsCount(projectCwd: string | undefined): Promise<number> {
  const path = buildProjectPath("/api/notifications?countOnly=true", projectCwd)
  const res = await authFetch(path)
  if (!res.ok) throw new Error(`notifications count failed: ${res.status}`)
  const data = (await res.json()) as { unreadCount?: number }
  return typeof data.unreadCount === "number" ? data.unreadCount : 0
}

export async function fetchNotificationsDetails(projectCwd: string | undefined): Promise<NotificationsPayload> {
  const path = buildProjectPath("/api/notifications", projectCwd)
  const res = await authFetch(path)
  if (!res.ok) throw new Error(`notifications fetch failed: ${res.status}`)
  return (await res.json()) as NotificationsPayload
}

export async function clearAllNotifications(projectCwd: string | undefined): Promise<void> {
  const path = buildProjectPath("/api/notifications", projectCwd)
  const res = await authFetch(path, { method: "DELETE" })
  if (!res.ok) throw new Error(`notifications clear failed: ${res.status}`)
}

export async function markAllNotificationsRead(projectCwd: string | undefined): Promise<void> {
  const path = buildProjectPath("/api/notifications?action=markRead", projectCwd)
  const res = await authFetch(path, { method: "POST" })
  if (!res.ok) throw new Error(`notifications mark-read failed: ${res.status}`)
}

export function useUnreadNotificationsCount(
  projectCwd: string | null | undefined,
  pollMs: number = NOTIFICATIONS_POLL_MS,
): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    if (!projectCwd) {
      setCount(0)
      return
    }
    try {
      const next = await fetchNotificationsCount(projectCwd)
      if (mountedRef.current) setCount(next)
    } catch {}
  }, [projectCwd])

  useEffect(() => {
    mountedRef.current = true
    const kick = window.setTimeout(() => {
      void load()
    }, 0)
    const timer = window.setInterval(() => {
      void load()
    }, pollMs)
    return () => {
      mountedRef.current = false
      window.clearTimeout(kick)
      window.clearInterval(timer)
    }
  }, [load, pollMs])

  return { count, refresh: load }
}
