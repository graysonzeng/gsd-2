/**
 * composed-lite/types.ts — Shared types and constants for the composed-lite runtime.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

// ─── Run Request ─────────────────────────────────────────────────────────────

export interface ComposedLiteRunRequest {
  projectRoot: string;
  requirement: string;
  mode: "full" | "plan";
  source: "workflow-start" | "workflow-run" | "resume";
  ctx: ExtensionCommandContext;
  pi: ExtensionAPI;
}

// ─── Phase Numbers ───────────────────────────────────────────────────────────

export type PhaseNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const PHASE_NAMES: Record<PhaseNumber, string> = {
  0: "admission",
  1: "research",
  2: "design",
  3: "split",
  4: "implementation",
  5: "verification",
  6: "delivery",
  7: "postmortem",
};

export const FULL_PHASE_SEQUENCE: PhaseNumber[] = [0, 1, 2, 3, 4, 5, 6, 7];
export const PLAN_PHASE_SEQUENCE: PhaseNumber[] = [0, 1, 2, 3, 7];
export const SKIP_IN_PLAN: Set<PhaseNumber> = new Set([4, 5, 6]);

// ─── Phase Status ────────────────────────────────────────────────────────────

export type PhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "fused";

export type RunStatus = "active" | "fused" | "completed" | "abandoned";

// ─── Admission State ─────────────────────────────────────────────────────────

export type AdmissionState =
  | "pending"
  | "evidence_collected"
  | "awaiting_approval"
  | "approved"
  | "rejected";

// ─── Fuse Reasons ────────────────────────────────────────────────────────────

export type FuseReason =
  | "budget_time_exhausted"
  | "verify_reentry_exhausted"
  | "consecutive_failures"
  | "admission_rejected"
  | "admission_tampered"
  | "review_unavailable"
  | "review_parse_exhausted"
  | "design_review_exhausted"
  | "code_review_exhausted"
  | "implementation_empty_diff"
  | "implementation_noop_diff"
  | "audit_log_tampered"
  | "state_integrity_error"
  | "lock_conflict";

// ─── Fuse Error ──────────────────────────────────────────────────────────────

export class ComposedLiteFuseError extends Error {
  constructor(public fuseReason: FuseReason, message: string) {
    super(message);
    this.name = "ComposedLiteFuseError";
  }
}

/**
 * Thrown by Phase 5 when verification fails but reentry budget is not exhausted.
 * This is NOT a failure — it signals "go back to Phase 4 and try again".
 * The runner must not count this as a consecutive_failure.
 */
export class VerifyReentrySignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyReentrySignal";
  }
}

// ─── Artifact Types ──────────────────────────────────────────────────────────

export type ArtifactKind =
  | "admission"
  | "research-brief"
  | "design-doc"
  | "design-review"
  | "impl-plan"
  | "implementation-summary"
  | "code-review"
  | "verification-report"
  | "delivery-report"
  | "postmortem-report";

export type ProducerKind =
  | "runtime"
  | "main_agent"
  | "subagent_scout"
  | "subagent_worker"
  | "subagent_reviewer"
  | "verification_runner";

// ─── Artifact Envelope ───────────────────────────────────────────────────────

export interface ArtifactEnvelope {
  schema_version: 1;
  run_id: string;
  phase: PhaseNumber;
  attempt: number;
  revision_round?: number;
  artifact_kind: ArtifactKind;
  producer_kind: ProducerKind;
  producer_id: string;
  provider: string | null;
  model: string | null;
  admission_hash: string;
  prev_phase_output_hash: string | null;
  input_hash: string;
  raw_log_hash: string;
  raw_log_path: string;
  output_hash: string;
  created_at: string;
}

// ─── Phase Entry in State ────────────────────────────────────────────────────

export interface PhaseEntry {
  status: PhaseStatus;
  started_at: string | null;
  completed_at: string | null;
  attempt: number;
  revision_round: number;
  failure_reason: string | null;
  artifact_envelope: {
    path: string | null;
    output_hash: string | null;
    producer_kind: ProducerKind | null;
    producer_id: string | null;
    provider: string | null;
    model: string | null;
  };
}

// ─── Composed-Lite State ─────────────────────────────────────────────────────

export interface ComposedLiteState {
  schema_version: 2;
  run_id: string;
  requirement: string;
  mode: "full" | "plan";
  status: RunStatus;
  created_at: string;
  updated_at: string;

  lease: {
    pid: number;
    host: string;
    started_at: string;
  };

  env_fingerprint: {
    project_root: string;
    git_head_at_start: string;
    node_version: string;
  };

  current_phase: PhaseNumber;
  fuse_reason: FuseReason | null;

  budget: {
    max_time_minutes: number;
    elapsed_minutes: number;
    verify_reentry_count: number;
    max_verify_reentry: number;
    consecutive_failures: number;
    max_consecutive_failures: number;
  };

  admission: {
    state: AdmissionState;
    evidence_message_ids: string[];
    approved_by: string | null;
    approved_at: string | null;
    admission_hash: string | null;
  };

  phases: Record<PhaseNumber, PhaseEntry>;

  last_verify_failure: string | null;

  review: {
    main_model: string;
    reviewer_model: string | null;
    reviewer_provider: string | null;
    cross_provider: boolean;
    fallback_self_review: boolean;
  };

  git: {
    baseline_sha: string | null;
    commit_created: boolean;
    commit_sha: string | null;
    committed_files: string[];
  };
}

// ─── STATE.json Marker ───────────────────────────────────────────────────────

export interface StateMarker {
  type: "runtime-owned";
  runtime: "composed-lite";
  run_id: string;
  state_path: string;
  status: RunStatus;
  updated_at: string;
}

// ─── Directories ─────────────────────────────────────────────────────────────

export const COMPOSED_LITE_DIR = ".gsd/composed-lite";
export const STATE_YAML_PATH = ".gsd/composed-lite/state.yaml";
export const STATE_MARKER_PATH = ".gsd/STATE.json";
export const ARTIFACTS_DIR = ".gsd/composed-lite/artifacts";
export const LOGS_DIR = ".gsd/composed-lite/logs";
export const RAW_LOGS_DIR = ".gsd/composed-lite/logs/raw";
export const RUN_LOCK_PATH = ".gsd/composed-lite/run.lock";

// ─── Artifact file paths ─────────────────────────────────────────────────────

export const ARTIFACT_PATHS: Record<ArtifactKind, string> = {
  "admission": "admission.yaml",
  "research-brief": "research-brief.yaml",
  "design-doc": "design-doc.md",
  "design-review": "design-review.yaml",
  "impl-plan": "impl-plan.yaml",
  "implementation-summary": "implementation-summary.md",
  "code-review": "code-review.yaml",
  "verification-report": "verification-report.md",
  "delivery-report": "delivery-report.yaml",
  "postmortem-report": "postmortem-report.yaml",
};
