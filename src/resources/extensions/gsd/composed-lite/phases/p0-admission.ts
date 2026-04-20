/**
 * Phase 0 — Admission
 *
 * State machine: pending → evidence_collected → awaiting_approval → approved/rejected
 * Contract C6: Admission must be explicitly approved before Phase 1.
 */

import { stringify as yamlStringify } from "yaml";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { writeArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { saveState } from "../state.js";
import { AdmissionPendingSignal, ComposedLiteFuseError } from "../types.js";

export async function runPhase0(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx, admissionAction } = req;

  // ── Evidence collection ─────────────────────────────────────────────────
  if (state.admission.state === "pending") {
    state.admission.state = "evidence_collected";
    state.admission.evidence_message_ids.push(`req-${Date.now()}`);

    appendAudit(projectRoot, state.run_id, {
      event: "admission_evidence",
      payload: { evidence_message_ids: state.admission.evidence_message_ids },
    });
  }

  // ── Build admission draft ───────────────────────────────────────────────
  const admissionDraft = {
    requirement: state.requirement,
    requirement_type: state.mode === "plan" ? "plan-only" : "full-delivery",
    scope_boundary: "As described in requirement",
    acceptance_criteria: "All phases complete without fuse",
    mode: state.mode,
  };

  const admissionYaml = yamlStringify(admissionDraft);
  const admissionHash = sha256(yamlStringify(admissionDraft));

  if (state.admission.state !== "approved") {
    state.admission.state = "awaiting_approval";
    state.admission.admission_hash = admissionHash;
    saveState(projectRoot, state);

    if (admissionAction === "reject") {
      state.admission.state = "rejected";
      throw new ComposedLiteFuseError(
        "admission_rejected",
        `Admission rejected for run ${state.run_id}`,
      );
    }

    if (admissionAction !== "approve") {
      ctx.ui.notify(
        `Composed-Lite Admission (${state.run_id})\n` +
        `Mode: ${state.mode}\n\n` +
        `${admissionYaml}\n` +
        `Run the same command again with --approve to continue, or --reject to cancel.`,
        "info",
      );
      throw new AdmissionPendingSignal(
        `Admission for run ${state.run_id} is awaiting explicit approval`,
      );
    }

    state.admission.state = "approved";
    state.admission.approved_by = "explicit-user";
    state.admission.approved_at = new Date().toISOString();
  }

  appendAudit(projectRoot, state.run_id, {
    event: "admission_approved",
    payload: { admission_hash: admissionHash },
  });

  // Write admission artifact
  const envelope = writeArtifact(projectRoot, "admission", admissionYaml, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 0,
    attempt: state.phases[0].attempt,
    artifact_kind: "admission",
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
    admission_hash: admissionHash,
    prev_phase_output_hash: null,
    input_hash: sha256(state.requirement),
    raw_log_hash: sha256(""),
    raw_log_path: "",
  });

  state.phases[0].artifact_envelope = {
    path: "admission",
    output_hash: envelope.output_hash,
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
  };
}
