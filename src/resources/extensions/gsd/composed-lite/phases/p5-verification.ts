/**
 * Phase 5 — Verification
 *
 * Runtime spawns verification commands directly (not via agent).
 * Contract C3: Verification by runtime spawn.
 */

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { buildRunScopedRawLogFileName } from "../types.js";
import { writeArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { saveState } from "../state.js";
import {
  runVerification,
  buildVerificationReport,
  extractFailureSummary,
} from "../verification-runner.js";
import { ComposedLiteFuseError, VerifyReentrySignal } from "../types.js";

export async function runPhase5(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 5: Verification — running test/build/lint/typecheck...", "info");
  ctx.ui.setStatus("cl:verify", "running test/build/lint/typecheck");

  // Run verification commands
  const results = runVerification(projectRoot, state.run_id, state.phases[5].attempt);

  // Audit
  appendAudit(projectRoot, state.run_id, {
    event: "verification_run",
    payload: { results },
  });

  // Build report
  const reportBody = buildVerificationReport(results, state, projectRoot);

  // Write verification report artifact
  const envelope = writeArtifact(projectRoot, "verification-report", reportBody, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 5,
    attempt: state.phases[5].attempt,
    artifact_kind: "verification-report",
    producer_kind: "verification_runner",
    producer_id: "verification-runner",
    provider: null,
    model: null,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: state.phases[4].artifact_envelope.output_hash,
    input_hash: sha256(results.map(r => r.command).join(",")),
    raw_log_hash: sha256(results.map(r => JSON.stringify(r)).join("\n")),
    raw_log_path: `logs/raw/${buildRunScopedRawLogFileName(state.run_id, `5-${state.phases[5].attempt}-verification.jsonl`)}`,
  });

  state.phases[5].artifact_envelope = {
    path: "verification-report",
    output_hash: envelope.output_hash,
    producer_kind: "verification_runner",
    producer_id: "verification-runner",
    provider: null,
    model: null,
  };

  // Check results
  const allPassed = results.every(r => r.exit_code === 0);

  if (allPassed) {
    state.last_verify_failure = null;
    ctx.ui.setStatus("cl:verify", "all verification checks passed");
    ctx.ui.notify("Phase 5: All verification checks passed.", "info");
    return;
  }

  // Verification failed — prepare for reentry to Phase 4
  const failureSummary = extractFailureSummary(results);
  state.last_verify_failure = failureSummary;
  state.budget.verify_reentry_count++;
  ctx.ui.setStatus("cl:verify", `failed — reentry ${state.budget.verify_reentry_count}/${state.budget.max_verify_reentry}`);

  ctx.ui.notify(
    `Phase 5: Verification failed (reentry ${state.budget.verify_reentry_count}/${state.budget.max_verify_reentry}).\n` +
      `${failureSummary?.slice(0, 200) || ""}`,
    "warning",
  );

  // Check reentry budget
  if (state.budget.verify_reentry_count >= state.budget.max_verify_reentry) {
    throw new ComposedLiteFuseError(
      "verify_reentry_exhausted",
      `Verification failed ${state.budget.verify_reentry_count} times, max reentry reached`,
    );
  }

  // Reset Phase 4 for re-implementation with failure context
  state.phases[4].status = "pending";
  state.phases[4].attempt++;
  state.phases[5].status = "pending";
  state.phases[5].attempt++;
  state.current_phase = 4;
  saveState(projectRoot, state);

  // Signal reentry — runner must NOT count this as consecutive_failure
  throw new VerifyReentrySignal("Verification failed, re-entering Phase 4");
}
