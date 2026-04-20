/**
 * composed-lite/audit-log.ts — Hash-chained JSONL event log.
 *
 * Contract C8: Audit log hash chain, Phase 7 must verify.
 */

import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { LOGS_DIR } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditEventBase {
  seq: number;
  ts: string;
  run_id: string;
  prev_digest: string | null;
  entry_digest: string;
  event: string;
  payload: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function auditLogPath(projectRoot: string, runId: string): string {
  return join(projectRoot, LOGS_DIR, `audit-${runId}.jsonl`);
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

/**
 * Compute canonical JSON for hashing (sorted keys).
 */
function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Read the last line of the audit log to get prev_digest and seq.
 */
function readLastEntry(filePath: string): { seq: number; digest: string } | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return null;

  const lines = content.split("\n");
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine) return null;

  try {
    const entry = JSON.parse(lastLine) as AuditEventBase;
    return { seq: entry.seq, digest: entry.entry_digest };
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Append an audit event to the hash-chained JSONL log.
 */
export function appendAudit(
  projectRoot: string,
  runId: string,
  input: { event: string; payload: unknown },
): void {
  const filePath = auditLogPath(projectRoot, runId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const last = readLastEntry(filePath);
  const seq = last ? last.seq + 1 : 0;
  const prevDigest = last ? last.digest : null;

  const entry: Omit<AuditEventBase, "entry_digest"> = {
    seq,
    ts: new Date().toISOString(),
    run_id: runId,
    prev_digest: prevDigest,
    event: input.event,
    payload: input.payload,
  };

  const entryDigest = sha256(canonicalize(entry as Record<string, unknown>));

  const fullEntry: AuditEventBase = {
    ...entry,
    entry_digest: entryDigest,
  };

  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n");
}

/**
 * Read all events from the audit log.
 */
export function readAuditLog(projectRoot: string, runId: string): AuditEventBase[] {
  const filePath = auditLogPath(projectRoot, runId);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];

  return content.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line) as AuditEventBase;
    } catch {
      return null;
    }
  }).filter((e): e is AuditEventBase => e !== null);
}

/**
 * Verify the audit log hash chain integrity.
 */
export function verifyAuditChain(
  events: AuditEventBase[],
): { ok: true } | { ok: false; bad_seq: number; reason: string } {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Check seq monotonicity
    if (event.seq !== i) {
      return { ok: false, bad_seq: i, reason: `Expected seq ${i}, got ${event.seq}` };
    }

    // Check prev_digest chain
    if (i === 0 && event.prev_digest !== null) {
      return { ok: false, bad_seq: 0, reason: "First entry should have null prev_digest" };
    }
    if (i > 0 && event.prev_digest !== events[i - 1].entry_digest) {
      return {
        ok: false,
        bad_seq: i,
        reason: `prev_digest mismatch: expected ${events[i - 1].entry_digest}, got ${event.prev_digest}`,
      };
    }

    // Verify entry_digest
    const { entry_digest, ...rest } = event;
    const expected = sha256(canonicalize(rest as Record<string, unknown>));
    if (entry_digest !== expected) {
      return {
        ok: false,
        bad_seq: i,
        reason: `entry_digest mismatch at seq ${i}`,
      };
    }
  }

  return { ok: true };
}
