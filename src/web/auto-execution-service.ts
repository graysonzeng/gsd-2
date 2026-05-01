import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { queryJournal, type JournalEntry } from "../resources/extensions/gsd/journal.ts";
import { SessionManager } from "../../packages/pi-coding-agent/src/core/session-manager.ts";
import { redactSecrets } from "../../packages/pi-coding-agent/src/core/redact-secrets.js";
import type {
  AutoExecutionEvent,
  AutoExecutionTimelineResponse,
} from "../../web/lib/auto-execution-types.ts";

const DEFAULT_UNIT_LIMIT = 20;
const MAX_UNIT_LIMIT = 100;
const MESSAGE_PREVIEW_LIMIT = 1000;
const THINKING_PREVIEW_LIMIT = 800;
const TOOL_ARGS_PREVIEW_LIMIT = 500;
const TOOL_RESULT_PREVIEW_LIMIT = 1000;

type AssistantContentBlock = {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
};

type TimelineOptions = {
  runId?: string | null;
  cursor?: string | null;
  limit?: number;
};

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function preview(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecrets(value).replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return truncate(normalized, maxChars);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_UNIT_LIMIT;
  return Math.max(1, Math.min(MAX_UNIT_LIMIT, Math.trunc(limit ?? DEFAULT_UNIT_LIMIT)));
}

function eventTimestamp(value: unknown, fallback: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : fallback;
}

function textFromAssistantContent(content: unknown, kind: "text" | "thinking"): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const typed = block as AssistantContentBlock;
      if (kind === "text" && typed.type === "text" && typeof typed.text === "string") return [typed.text];
      if (kind === "thinking" && typed.type === "thinking" && typeof typed.thinking === "string") return [typed.thinking];
      return [];
    })
    .join("\n")
    .trim();
  return parts.length > 0 ? parts : undefined;
}

function latestRunId(entries: JournalEntry[]): string | null {
  const latest = [...entries].reverse().find((entry) => typeof entry.data?.runId === "string");
  return (latest?.data?.runId as string | undefined) ?? null;
}

function eventTitle(entry: JournalEntry): string {
  const data = entry.data ?? {};
  switch (entry.eventType) {
    case "run-start":
      return "Auto run started";
    case "run-end":
      return `Auto run ${asString(data.status) ?? "ended"}`;
    case "unit-start":
      return `${asString(data.unitType) ?? "unit"} ${asString(data.unitId) ?? ""}`.trim();
    case "unit-end":
      return `${asString(data.unitType) ?? "unit"} ${asString(data.unitId) ?? ""} ${asString(data.status) ?? "done"}`.trim();
    case "model-selected":
      return `Model ${asString(data.model) ?? "selected"}`;
    case "continuity-decision":
      return asString(data.nextAction) ?? asString(data.continuitySignal) ?? "Continuity decision";
    case "artifact-verification-retry":
      return "Verification retry";
    case "terminal":
      return asString(data.reason) ?? "Auto terminated";
    case "guard-block":
      return "Guard blocked";
    case "agent-span":
      return data.phase === "start" ? "Agent span started" : "Agent span ended";
    case "dispatch-stop":
      return "Dispatch stopped";
    case "stuck-detected":
      return "Stuck detected";
    default:
      return entry.eventType;
  }
}

function mapJournalKind(entry: JournalEntry): AutoExecutionEvent["kind"] | null {
  switch (entry.eventType) {
    case "run-start":
    case "run-end":
    case "unit-start":
    case "unit-end":
    case "model-selected":
      return entry.eventType;
    case "continuity-decision":
      return "continuity";
    case "artifact-verification-retry":
      return "verification";
    case "terminal":
      return "run-end";
    case "guard-block":
    case "dispatch-stop":
      return "guard";
    case "agent-span":
      return entry.data?.phase === "start" ? "agent-span-start" : "agent-span-end";
    case "stuck-detected":
      return "error";
    default:
      return null;
  }
}

function journalToTimeline(entry: JournalEntry, runId: string): AutoExecutionEvent | null {
  const kind = mapJournalKind(entry);
  if (!kind) return null;
  const data = entry.data ?? {};
  const routing = data.routing && typeof data.routing === "object"
    ? data.routing as Record<string, unknown>
    : null;
  const changedFiles = asStringArray(data.changedFiles);

  let body: string | undefined;
  switch (entry.eventType) {
    case "continuity-decision":
      body = preview(asString(data.reason), MESSAGE_PREVIEW_LIMIT);
      break;
    case "artifact-verification-retry":
      {
        const attempt = typeof data.attempt === "number" ? data.attempt : 1;
        body = preview(`Attempt ${attempt} of verification`, MESSAGE_PREVIEW_LIMIT);
      }
      break;
    case "terminal":
    case "guard-block":
    case "dispatch-stop":
      body = preview(asString(data.reason), MESSAGE_PREVIEW_LIMIT);
      break;
    case "stuck-detected":
      body = preview(asString(data.reason) ?? "Process appears stuck", MESSAGE_PREVIEW_LIMIT);
      break;
    default:
      body = preview(asString(data.reason) ?? asString(data.status), MESSAGE_PREVIEW_LIMIT);
  }

  return {
    id: `journal:${entry.flowId}:${entry.seq}`,
    ts: entry.ts,
    runId,
    unitRunId: asString(data.unitRunId) ?? entry.flowId,
    unit: asString(data.unitType) && asString(data.unitId)
      ? { type: asString(data.unitType)!, id: asString(data.unitId)! }
      : undefined,
    session: {
      id: asString(data.sessionId),
      file: asString(data.sessionFile) ?? null,
    },
    model: asString(data.model)
      ? { id: asString(data.model)!, tier: asString(routing?.tier) }
      : undefined,
    kind,
    title: eventTitle(entry),
    body,
    diff: changedFiles.length > 0 || asString(data.commitSha)
      ? {
          files: changedFiles,
          commitSha: asString(data.commitSha) ?? null,
        }
      : undefined,
    source: {
      type: "journal",
      flowId: entry.flowId,
      seq: entry.seq,
    },
  };
}

function collectTranscriptEvents(
  sessionFile: string,
  runId: string,
  unitType: string,
  unitId: string,
  unitRunId: string,
): AutoExecutionEvent[] {
  const manager = SessionManager.open(sessionFile);
  const entries = manager.getEntries();
  const events: AutoExecutionEvent[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      const thinking = preview(textFromAssistantContent(message.content, "thinking"), THINKING_PREVIEW_LIMIT);
      if (thinking) {
        events.push({
          id: `transcript:${unitRunId}:${entry.id}:thinking`,
          ts: eventTimestamp(message.timestamp, entry.timestamp),
          runId,
          unitRunId,
          unit: { type: unitType, id: unitId },
          session: { file: sessionFile },
          kind: "thinking",
          title: "Reasoning",
          body: thinking,
          source: { type: "session-transcript", path: sessionFile },
        });
      }

      const assistantText = preview(textFromAssistantContent(message.content, "text"), MESSAGE_PREVIEW_LIMIT);
      if (assistantText) {
        events.push({
          id: `transcript:${unitRunId}:${entry.id}:message`,
          ts: eventTimestamp(message.timestamp, entry.timestamp),
          runId,
          unitRunId,
          unit: { type: unitType, id: unitId },
          session: { file: sessionFile },
          kind: "message",
          title: "Assistant",
          body: assistantText,
          source: { type: "session-transcript", path: sessionFile },
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      const argsPreview = preview(JSON.stringify((message.details as Record<string, unknown> | undefined)?.args ?? {}), TOOL_ARGS_PREVIEW_LIMIT);
      const resultText = Array.isArray(message.content)
        ? message.content
            .flatMap((block) => (block.type === "text" && typeof block.text === "string") ? [block.text] : [])
            .join("\n")
        : "";
      const resultPreview = preview(resultText, TOOL_RESULT_PREVIEW_LIMIT);
      const details = message.details as Record<string, unknown> | undefined;
      const diffPreview = preview(typeof details?.diff === "string" ? details.diff : undefined, TOOL_RESULT_PREVIEW_LIMIT);
      events.push({
        id: `transcript:${unitRunId}:${entry.id}:tool`,
        ts: eventTimestamp(message.timestamp, entry.timestamp),
        runId,
        unitRunId,
        unit: { type: unitType, id: unitId },
        session: { file: sessionFile },
        kind: message.isError ? "error" : "tool-end",
        title: `${message.toolName ?? "tool"} finished`,
        body: resultPreview,
        tool: {
          callId: message.toolCallId,
          name: message.toolName,
          argsPreview,
          resultPreview,
          isError: message.isError,
        },
        diff: diffPreview ? { files: [], patchPreview: diffPreview } : undefined,
        source: { type: "session-transcript", path: sessionFile },
      });
    }
  }

  return events;
}

function sessionFileForUnit(entries: JournalEntry[], unitRunId: string): string | undefined {
  const direct = entries.find((entry) => (asString(entry.data?.unitRunId) ?? entry.flowId) === unitRunId && asString(entry.data?.sessionFile));
  return asString(direct?.data?.sessionFile);
}

export function collectAutoExecutionTimeline(
  basePath: string,
  options: TimelineOptions = {},
): AutoExecutionTimelineResponse {
  const allEntries = queryJournal(basePath);
  const runId = options.runId ?? latestRunId(allEntries);
  if (!runId) {
    return {
      events: [],
      nextCursor: null,
      watermark: null,
      degraded: true,
    };
  }

  const runEntries = allEntries.filter((entry) => entry.data?.runId === runId);
  const unitStartEntries = runEntries.filter((entry) => entry.eventType === "unit-start");
  const start = parseCursor(options.cursor);
  const limit = parseLimit(options.limit);
  const pagedUnits = unitStartEntries.slice(start, start + limit);
  const pagedUnitRunIds = new Set(pagedUnits.map((entry) => asString(entry.data?.unitRunId) ?? entry.flowId));

  const events: AutoExecutionEvent[] = [];
  for (const entry of runEntries) {
    if (entry.eventType !== "run-start" && entry.eventType !== "run-end") {
      const unitRunId = asString(entry.data?.unitRunId) ?? entry.flowId;
      if (!pagedUnitRunIds.has(unitRunId)) continue;
    }
    const mapped = journalToTimeline(entry, runId);
    if (mapped) events.push(mapped);
  }

  for (const unitStart of pagedUnits) {
    const unitRunId = asString(unitStart.data?.unitRunId) ?? unitStart.flowId;
    const sessionFile = sessionFileForUnit(runEntries, unitRunId);
    if (!sessionFile) continue;
    const resolvedSessionFile = resolve(sessionFile);
    if (!existsSync(resolvedSessionFile)) continue;
    events.push(...collectTranscriptEvents(
      resolvedSessionFile,
      runId,
      asString(unitStart.data?.unitType) ?? "unit",
      asString(unitStart.data?.unitId) ?? unitRunId,
      unitRunId,
    ));
  }

  events.sort((left, right) => {
    const tsDelta = Date.parse(left.ts) - Date.parse(right.ts);
    if (tsDelta !== 0) return tsDelta;
    return left.id.localeCompare(right.id);
  });

  return {
    events,
    nextCursor: start + limit < unitStartEntries.length ? String(start + limit) : null,
    watermark: events.at(-1)?.ts ?? null,
    degraded: unitStartEntries.length === 0,
  };
}
