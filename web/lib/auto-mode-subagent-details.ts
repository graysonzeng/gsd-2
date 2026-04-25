export type SubagentSnapshotItem =
  | { type: "assistant-text"; text: string }
  | { type: "tool-call"; name: string; args?: Record<string, unknown>; resultText?: string; resultIsError?: boolean }
  | { type: "tool-result"; toolName: string; text: string; isError: boolean }

export interface SubagentSnapshotGroup {
  agent: string
  step?: number
  items: SubagentSnapshotItem[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((entry) => {
      const record = asRecord(entry)
      if (!record || record.type !== "text") return null
      return asNonEmptyString(record.text)
    })
    .filter((value): value is string => Boolean(value))
    .join("\n")
}

function extractSnapshotItems(messages: unknown): SubagentSnapshotItem[] {
  if (!Array.isArray(messages)) return []

  const items: SubagentSnapshotItem[] = []
  const callItemById = new Map<string, Extract<SubagentSnapshotItem, { type: "tool-call" }>>()

  for (const message of messages) {
    const record = asRecord(message)
    if (!record) continue

    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const part of record.content) {
        const partRecord = asRecord(part)
        if (!partRecord) continue

        if (partRecord.type === "text") {
          const text = asNonEmptyString(partRecord.text)
          if (text) items.push({ type: "assistant-text", text })
          continue
        }

        if (partRecord.type === "toolCall") {
          const name = asNonEmptyString(partRecord.name)
          const args = asRecord(partRecord.arguments) ?? undefined
          if (!name) continue

          const item: Extract<SubagentSnapshotItem, { type: "tool-call" }> = { type: "tool-call", name, args }
          items.push(item)

          const callId = asNonEmptyString(partRecord.id)
          if (callId) callItemById.set(callId, item)
        }
      }
      continue
    }

    if (record.role === "toolResult") {
      const toolName = asNonEmptyString(record.toolName) ?? "tool"
      const text = extractTextContent(record.content)
      if (!text) continue

      const toolCallId = asNonEmptyString(record.toolCallId)
      const matchingCall = toolCallId ? callItemById.get(toolCallId) : null
      if (matchingCall) {
        matchingCall.resultText = text
        matchingCall.resultIsError = Boolean(record.isError)
        continue
      }

      items.push({
        type: "tool-result",
        toolName,
        text,
        isError: Boolean(record.isError),
      })
    }
  }

  return items
}

export function extractSubagentSnapshotGroups(details: Record<string, unknown> | undefined): SubagentSnapshotGroup[] | null {
  const record = asRecord(details)
  if (!record || !Array.isArray(record.results) || record.results.length === 0) return null

  const groups = record.results
    .map((result) => {
      const resultRecord = asRecord(result)
      if (!resultRecord) return null

      const items = extractSnapshotItems(resultRecord.messages)
      if (items.length === 0) return null

      const step = typeof resultRecord.step === "number" ? resultRecord.step : undefined
      return {
        agent: asNonEmptyString(resultRecord.agent) ?? "agent",
        ...(typeof step === "number" ? { step } : {}),
        items,
      } satisfies SubagentSnapshotGroup
    })
    .filter((group): group is SubagentSnapshotGroup => Boolean(group))

  return groups.length > 0 ? groups : null
}
