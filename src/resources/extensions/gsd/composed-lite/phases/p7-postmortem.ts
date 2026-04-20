/**
 * Phase 7 — Postmortem
 *
 * Always executes, even after fuse (Contract C13).
 * Verifies audit log chain (C8), runs drift detection.
 */

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { readAuditLog, verifyAuditChain, appendAudit, type AuditEventBase } from "../audit-log.js";
import { ARTIFACT_PATHS, type ArtifactKind } from "../types.js";

// ─── Drift detection ─────────────────────────────────────────────────────────

function detectDrift(
  events: AuditEventBase[],
  state: ComposedLiteState,
  projectRoot: string,
): string[] {
  const warnings: string[] = [];

  // 1. Review phases (2, 4) must have reviewer_verdict events.
  //    Phase 5 is runtime verification — no reviewer involved.
  const reviewPhases = [2, 4];
  for (const phase of reviewPhases) {
    if (state.phases[phase as keyof typeof state.phases]?.status !== "completed") continue;

    const hasVerdict = events.some(
      e => e.event === "reviewer_verdict" && (e.payload as any)?.phase === phase,
    );
    if (!hasVerdict) {
      warnings.push(`review_missing: Phase ${phase} completed without reviewer_verdict`);
    }
  }

  // 2. Check for self_review_used
  const selfReviewUsed = events.some(e => e.event === "reviewer_fallback_self_review");
  if (selfReviewUsed) {
    warnings.push("self_review_used: Non-independent review was used");
  }

  // 3. Verify artifact hashes for completed phases
  for (const [phaseStr, entry] of Object.entries(state.phases)) {
    if (entry.status !== "completed" || !entry.artifact_envelope.output_hash) continue;
    if (!entry.artifact_envelope.path) continue;

    const kind = entry.artifact_envelope.path as ArtifactKind;
    const artifact = readArtifact(projectRoot, kind);
    if (!artifact) {
      warnings.push(`artifact_missing: Phase ${phaseStr} artifact "${kind}" not found`);
      continue;
    }

    const actualHash = sha256(artifact.body);
    if (actualHash !== entry.artifact_envelope.output_hash) {
      warnings.push(`artifact_hash_mismatch: Phase ${phaseStr} "${kind}" hash differs from state`);
    }
  }

  return warnings;
}

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase7(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 7: Postmortem — analyzing run...", "info");

  // ── Read and verify audit log (C8) ──────────────────────────────────────
  const events = readAuditLog(projectRoot, state.run_id);
  const chainResult = verifyAuditChain(events);

  const driftWarnings: string[] = [];

  if (!chainResult.ok) {
    driftWarnings.push(`audit_chain_broken: seq ${chainResult.bad_seq} — ${chainResult.reason}`);
    // This is a hard failure — could set fuse if not already fused
    if (!state.fuse_reason) {
      state.fuse_reason = "audit_log_tampered";
      state.status = "fused";
    }
  }

  // ── Drift detection ─────────────────────────────────────────────────────
  const detected = detectDrift(events, state, projectRoot);
  driftWarnings.push(...detected);

  // ── Compute timing ──────────────────────────────────────────────────────
  const elapsed = (Date.now() - new Date(state.created_at).getTime()) / 60_000;
  const timeUsed = Math.round(elapsed * 10) / 10;

  // ── Build postmortem report ─────────────────────────────────────────────
  const outcome = state.fuse_reason ? "fused" : "completed";
  const body = [
    `outcome: ${outcome}`,
    `run_id: "${state.run_id}"`,
    `mode: ${state.mode}`,
    `time_used_minutes: ${timeUsed}`,
    state.fuse_reason ? `fuse_reason: "${state.fuse_reason}"` : "fuse_reason: null",
    `reviewer_model: "${state.review.reviewer_model || "none"}"`,
    `reviewer_provider: "${state.review.reviewer_provider || "none"}"`,
    `cross_provider: ${state.review.cross_provider}`,
    state.git.commit_sha ? `git_sha: "${state.git.commit_sha}"` : "git_sha: null",
    `drift_warnings:`,
    driftWarnings.length > 0
      ? driftWarnings.map(w => `  - "${w}"`).join("\n")
      : "  []",
    `phases_completed: ${Object.values(state.phases).filter(p => p.status === "completed").length}`,
    `phases_skipped: ${Object.values(state.phases).filter(p => p.status === "skipped").length}`,
    `phases_failed: ${Object.values(state.phases).filter(p => p.status === "failed" || p.status === "fused").length}`,
    `audit_events: ${events.length}`,
    `audit_chain_valid: ${chainResult.ok}`,
  ].join("\n");

  const envelope = writeArtifact(projectRoot, "postmortem-report", body, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 7,
    attempt: state.phases[7].attempt,
    artifact_kind: "postmortem-report",
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: null, // postmortem doesn't chain
    input_hash: sha256(state.run_id),
    raw_log_hash: sha256(events.map(e => e.entry_digest).join(",")),
    raw_log_path: `logs/audit-${state.run_id}.jsonl`,
  });

  state.phases[7].artifact_envelope = {
    path: "postmortem-report",
    output_hash: envelope.output_hash,
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
  };

  // Audit
  appendAudit(projectRoot, state.run_id, {
    event: "postmortem_complete",
    payload: { drift_warnings: driftWarnings },
  });

  // Display summary
  const summaryLines = [
    `Phase 7: Postmortem — ${outcome}`,
    `  Time: ${timeUsed} minutes`,
    `  Reviewer: ${state.review.reviewer_model || "none"} (${state.review.reviewer_provider || "none"})`,
  ];

  if (state.git.commit_sha) {
    summaryLines.push(`  Commit: ${state.git.commit_sha.slice(0, 8)}`);
  }
  if (state.fuse_reason) {
    summaryLines.push(`  Fuse reason: ${state.fuse_reason}`);
  }
  if (driftWarnings.length > 0) {
    summaryLines.push(`  Drift warnings: ${driftWarnings.length}`);
    for (const w of driftWarnings) {
      summaryLines.push(`    - ${w}`);
    }
  }

  ctx.ui.notify(summaryLines.join("\n"), outcome === "completed" ? "info" : "warning");
}
