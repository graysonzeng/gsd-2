/**
 * composed-lite/state.ts — State management for the composed-lite runtime.
 *
 * Source of truth: .gsd/composed-lite/state.yaml
 * Projection: .gsd/STATE.json (minimal marker for /gsd status discovery)
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";
import { execSync } from "node:child_process";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

import type {
  ComposedLiteState,
  PhaseEntry,
  PhaseNumber,
  StateMarker,
} from "./types.js";
import {
  STATE_YAML_PATH,
  STATE_MARKER_PATH,
  COMPOSED_LITE_DIR,
  LOGS_DIR,
} from "./types.js";
import { appendAudit } from "./audit-log.js";
import { readArtifact, verifyEnvelope } from "./artifacts.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

function gitHead(projectRoot: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function nextRunId(projectRoot: string): string {
  const date = new Date();
  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");

  // Find next sequence number
  const logsDir = join(projectRoot, LOGS_DIR);
  let seq = 1;
  if (existsSync(logsDir)) {
    try {
      const files = readdirSync(logsDir);
      for (const f of files) {
        const m = f.match(new RegExp(`^audit-cl-${dateStr}-(\\d+)\\.jsonl$`));
        if (m) {
          const n = parseInt(m[1], 10);
          if (n >= seq) seq = n + 1;
        }
      }
    } catch { /* ignore */ }
  }
  return `cl-${dateStr}-${String(seq).padStart(2, "0")}`;
}

function makeDefaultPhaseEntry(): PhaseEntry {
  return {
    status: "pending",
    started_at: null,
    completed_at: null,
    attempt: 0,
    revision_round: 0,
    failure_reason: null,
    artifact_envelope: {
      path: null,
      output_hash: null,
      producer_kind: null,
      producer_id: null,
      provider: null,
      model: null,
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize a fresh state for a new composed-lite run.
 */
export function initState(
  projectRoot: string,
  req: { requirement: string; mode: "full" | "plan" },
): ComposedLiteState {
  const now = new Date().toISOString();
  const runId = nextRunId(projectRoot);

  const state: ComposedLiteState = {
    schema_version: 2,
    run_id: runId,
    requirement: req.requirement,
    mode: req.mode,
    status: "active",
    created_at: now,
    updated_at: now,

    lease: {
      pid: process.pid,
      host: hostname(),
      started_at: now,
    },

    env_fingerprint: {
      project_root: projectRoot,
      git_head_at_start: gitHead(projectRoot),
      node_version: process.version,
    },

    current_phase: 0,
    fuse_reason: null,

    budget: {
      max_time_minutes: 120,
      elapsed_minutes: 0,
      verify_reentry_count: 0,
      max_verify_reentry: 3,
      consecutive_failures: 0,
      max_consecutive_failures: 2,
      pause_started_at: null,
      total_paused_minutes: 0,
    },

    admission: {
      state: "pending",
      evidence_message_ids: [],
      approved_by: null,
      approved_at: null,
      admission_hash: null,
    },

    carry_forward_review: {
      action: null,
      entries: [],
    },

    phases: {
      0: makeDefaultPhaseEntry(),
      1: makeDefaultPhaseEntry(),
      2: makeDefaultPhaseEntry(),
      3: makeDefaultPhaseEntry(),
      4: makeDefaultPhaseEntry(),
      5: makeDefaultPhaseEntry(),
      6: makeDefaultPhaseEntry(),
      7: makeDefaultPhaseEntry(),
    },

    last_verify_failure: null,

    review: {
      main_model: "",
      reviewer_model: null,
      reviewer_provider: null,
      cross_provider: true,
      fallback_self_review: false,
    },

    git: {
      baseline_sha: null,
      commit_created: false,
      commit_sha: null,
      committed_files: [],
    },
  };

  saveState(projectRoot, state);
  return state;
}

export function readStateSnapshot(projectRoot: string): ComposedLiteState | null {
  const statePath = join(projectRoot, STATE_YAML_PATH);
  if (!existsSync(statePath)) return null;

  let raw: string;
  try {
    raw = readFileSync(statePath, "utf-8");
  } catch {
    return null;
  }

  let state: ComposedLiteState;
  try {
    state = yamlParse(raw) as ComposedLiteState;
  } catch {
    return null;
  }

  if (!state || state.schema_version !== 2 || !state.run_id) {
    return null;
  }

  return state;
}

/**
 * Load and validate existing state. Returns null if no state exists.
 * Runs §5.5 recovery invariants on loaded state.
 */
export function loadState(projectRoot: string): ComposedLiteState | null {
  const state = readStateSnapshot(projectRoot);
  if (!state) return null;

  // §5.5 Recovery invariants

  // 1. Env fingerprint: project_root must match cwd
  if (state.env_fingerprint.project_root !== projectRoot) {
    // Allow recovery but update fingerprint
    state.env_fingerprint.project_root = projectRoot;
  }

  if (!state.carry_forward_review) {
    state.carry_forward_review = {
      action: null,
      entries: [],
    };
  }

  if (typeof state.budget.total_paused_minutes !== "number") {
    state.budget.total_paused_minutes = 0;
  }
  if (!("pause_started_at" in state.budget)) {
    state.budget.pause_started_at = null;
  }

  // 2. Reset any "running" phases to "pending" (crash recovery)
  for (const key of Object.keys(state.phases) as unknown as PhaseNumber[]) {
    const phase = state.phases[key];
    if (phase.status === "running") {
      phase.status = "pending";
      phase.attempt += 1;
      phase.started_at = null;
    }
  }

  // 3. Update lease
  state.lease = {
    pid: process.pid,
    host: hostname(),
    started_at: new Date().toISOString(),
  };

  // 4. Verify artifact hashes for completed phases (C9: hash > existence)
  for (const key of Object.keys(state.phases) as unknown as PhaseNumber[]) {
    const phase = state.phases[key];
    if (phase.status !== "completed" || !phase.artifact_envelope.output_hash) continue;
    if (!phase.artifact_envelope.path) continue;

    const kind = phase.artifact_envelope.path as import("./types.js").ArtifactKind;
    const artifact = readArtifact(projectRoot, kind);
    if (!artifact) {
      // Artifact missing — reset phase to pending for re-execution
      phase.status = "pending";
      phase.attempt += 1;
      phase.started_at = null;
      continue;
    }

    const verification = verifyEnvelope(artifact.envelope, artifact.body, {
      run_id: state.run_id,
      admission_hash: state.admission.admission_hash || "",
      prev_phase_output_hash: null, // skip cross-phase check during recovery
    });

    if (!verification.ok) {
      // Hash/run_id mismatch — reset phase
      phase.status = "pending";
      phase.attempt += 1;
      phase.started_at = null;
    }
  }

  return state;
}

/**
 * Atomic save of state.yaml + STATE.json marker update + audit log.
 */
export function saveState(projectRoot: string, state: ComposedLiteState): void {
  state.updated_at = new Date().toISOString();

  const statePath = join(projectRoot, STATE_YAML_PATH);
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const yamlContent = yamlStringify(state);

  // Atomic write: write to .tmp then rename
  const tmpPath = statePath + ".tmp";
  writeFileSync(tmpPath, yamlContent);
  renameSync(tmpPath, statePath);

  // Update STATE.json marker
  writeStateMarker(projectRoot, state);
}

/**
 * Write the .gsd/STATE.json marker for /gsd status discovery.
 */
export function writeStateMarker(projectRoot: string, state: ComposedLiteState): void {
  const markerPath = join(projectRoot, STATE_MARKER_PATH);
  const dir = dirname(markerPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const marker: StateMarker = {
    type: "runtime-owned",
    runtime: "composed-lite",
    run_id: state.run_id,
    state_path: STATE_YAML_PATH,
    status: state.status,
    updated_at: state.updated_at,
  };

  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + "\n");
}

/**
 * Update a specific phase entry in state.
 */
export function updatePhase(
  state: ComposedLiteState,
  phase: PhaseNumber,
  patch: Partial<PhaseEntry>,
): void {
  Object.assign(state.phases[phase], patch);
}
