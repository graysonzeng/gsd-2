import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import { ARTIFACTS_DIR, type PendingReviewFindingsDocument, type PendingReviewFindingsEntry, type ReviewArtifactKind } from "./types.js";
import { sha256 } from "./artifacts.js";
import type { ReviewResult } from "./review-harness.js";

const PENDING_REVIEW_FINDINGS_PATH = "pending-review-findings.yaml";

function documentPath(projectRoot: string): string {
  return join(projectRoot, ARTIFACTS_DIR, PENDING_REVIEW_FINDINGS_PATH);
}

function emptyDocument(): PendingReviewFindingsDocument {
  return {
    schema_version: 1,
    entries: [],
  };
}

function normalizeDocument(value: unknown): PendingReviewFindingsDocument {
  if (!value || typeof value !== "object") return emptyDocument();
  const parsed = value as Partial<PendingReviewFindingsDocument>;
  const entries = Array.isArray(parsed.entries) ? parsed.entries.filter(Boolean) as PendingReviewFindingsEntry[] : [];
  return {
    schema_version: 1,
    entries,
  };
}

function writeDocument(projectRoot: string, document: PendingReviewFindingsDocument): void {
  const filePath = documentPath(projectRoot);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, yamlStringify(document));
}

export function readPendingReviewFindings(projectRoot: string): PendingReviewFindingsDocument {
  const filePath = documentPath(projectRoot);
  if (!existsSync(filePath)) return emptyDocument();
  try {
    return normalizeDocument(yamlParse(readFileSync(filePath, "utf-8")));
  } catch {
    return emptyDocument();
  }
}

export function recordPendingReviewFindings(input: {
  projectRoot: string;
  runId: string;
  requirement: string;
  phase: 2 | 4;
  reviewKind: ReviewArtifactKind;
  reviewResult: ReviewResult;
  sourceReviewOutputHash: string | null;
}): PendingReviewFindingsEntry {
  const { projectRoot, runId, requirement, phase, reviewKind, reviewResult, sourceReviewOutputHash } = input;
  const document = readPendingReviewFindings(projectRoot);
  const createdAt = new Date().toISOString();
  const findingsHash = sha256(JSON.stringify({
    reviewKind,
    phase,
    critical: reviewResult.critical,
    important: reviewResult.important,
    minor: reviewResult.minor,
    rationale: reviewResult.rationale,
  }));

  const entry: PendingReviewFindingsEntry = {
    schema_version: 1,
    review_kind: reviewKind,
    source_run_id: runId,
    source_phase: phase,
    source_requirement: requirement,
    overall_assessment: reviewResult.overall_assessment === "fail" ? "fail" : "issues",
    source_review_output_hash: sourceReviewOutputHash,
    critical: reviewResult.critical,
    important: reviewResult.important,
    minor: reviewResult.minor,
    rationale: reviewResult.rationale,
    findings_hash: findingsHash,
    created_at: createdAt,
    resolved: false,
    resolved_at: null,
    resolution_run_id: null,
  };

  const existingIndex = document.entries.findIndex(candidate =>
    !candidate.resolved && candidate.source_run_id === runId && candidate.review_kind === reviewKind,
  );

  if (existingIndex >= 0) {
    document.entries[existingIndex] = entry;
  } else {
    document.entries.push(entry);
  }

  writeDocument(projectRoot, document);
  return entry;
}

export function markPendingReviewFindingsResolved(input: {
  projectRoot: string;
  reviewKind: ReviewArtifactKind;
  resolutionRunId: string;
}): PendingReviewFindingsEntry[] {
  const { projectRoot, reviewKind, resolutionRunId } = input;
  const document = readPendingReviewFindings(projectRoot);
  const resolvedAt = new Date().toISOString();
  const updated: PendingReviewFindingsEntry[] = [];

  for (const entry of document.entries) {
    if (entry.resolved || entry.review_kind !== reviewKind) continue;
    entry.resolved = true;
    entry.resolved_at = resolvedAt;
    entry.resolution_run_id = resolutionRunId;
    updated.push(entry);
  }

  if (updated.length > 0) {
    writeDocument(projectRoot, document);
  }

  return updated;
}

export function getLatestPendingReviewFindingsBundle(projectRoot: string): PendingReviewFindingsEntry[] {
  const document = readPendingReviewFindings(projectRoot);
  const unresolved = document.entries.filter(entry => !entry.resolved);
  if (unresolved.length === 0) return [];

  unresolved.sort((left, right) => right.created_at.localeCompare(left.created_at));
  const latestRunId = unresolved[0].source_run_id;
  return unresolved
    .filter(entry => entry.source_run_id === latestRunId)
    .sort((left, right) => left.source_phase - right.source_phase || left.created_at.localeCompare(right.created_at));
}

export function summarizePendingReviewFindings(entries: PendingReviewFindingsEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map(entry => {
    const critical = entry.critical.length;
    const important = entry.important.length;
    const minor = entry.minor.length;
    return [
      `- ${entry.review_kind} from ${entry.source_run_id} (phase ${entry.source_phase})`,
      `  assessment=${entry.overall_assessment}, critical=${critical}, important=${important}, minor=${minor}`,
    ].join("\n");
  }).join("\n");
}

export function formatCarryForwardReviewContext(entries: PendingReviewFindingsEntry[]): string {
  if (entries.length === 0) return "";
  const lines = ["Carry-forward review findings from the previous composed-lite run:"];
  for (const entry of entries) {
    lines.push(`- ${entry.review_kind} from ${entry.source_run_id} (phase ${entry.source_phase})`);
    for (const finding of entry.critical) {
      lines.push(`  - [critical] ${finding.id} | target=${finding.target} | ${finding.rationale}`);
    }
    for (const finding of entry.important) {
      lines.push(`  - [important] ${finding.id} | target=${finding.target} | ${finding.rationale}`);
    }
    for (const finding of entry.minor) {
      lines.push(`  - [minor] ${finding.id} | target=${finding.target} | ${finding.rationale}`);
    }
    if (entry.rationale) {
      lines.push(`  - reviewer_rationale: ${entry.rationale}`);
    }
  }
  return lines.join("\n");
}
