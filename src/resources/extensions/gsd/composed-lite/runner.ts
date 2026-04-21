/**
 * composed-lite/runner.ts — Main runtime loop for the composed-lite workflow.
 *
 * Manages phase progression, recovery, fuse handling, and delegates to
 * individual phase handlers. All anti-drift contracts are enforced here
 * in code, not via prompts.
 */

import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

import type {
  ComposedLiteRunRequest,
  ComposedLiteState,
  FuseReason,
  PhaseNumber,
} from "./types.js";
import {
  COMPOSED_LITE_DIR,
  ARTIFACTS_DIR,
  LOGS_DIR,
  RAW_LOGS_DIR,
  FULL_PHASE_SEQUENCE,
  PLAN_PHASE_SEQUENCE,
  SKIP_IN_PLAN,
  PHASE_NAMES,
  ComposedLiteFuseError,
  VerifyReentrySignal,
  AdmissionPendingSignal,
} from "./types.js";
import { initState, loadState, saveState, writeStateMarker } from "./state.js";
import { acquireLock, releaseLock } from "./run-lock.js";
import { appendAudit } from "./audit-log.js";
import { checkBudget, syncElapsedBudgetMinutes } from "./budget.js";
import { sha256 } from "./artifacts.js";

// Phase handlers — imported lazily per phase
import { runPhase0 } from "./phases/p0-admission.js";
import { runPhase1 } from "./phases/p1-research.js";
import { runPhase2 } from "./phases/p2-design.js";
import { runPhase3 } from "./phases/p3-split.js";
import { runPhase4 } from "./phases/p4-implementation.js";
import { runPhase5 } from "./phases/p5-verification.js";
import { runPhase6 } from "./phases/p6-delivery.js";
import { runPhase7 } from "./phases/p7-postmortem.js";

// ─── Phase handler registry ─────────────────────────────────────────────────

type PhaseHandler = (state: ComposedLiteState, req: ComposedLiteRunRequest) => Promise<void>;

const PHASE_HANDLERS: Record<PhaseNumber, PhaseHandler> = {
  0: runPhase0,
  1: runPhase1,
  2: runPhase2,
  3: runPhase3,
  4: runPhase4,
  5: runPhase5,
  6: runPhase6,
  7: runPhase7,
};

// ─── Ensure directories ──────────────────────────────────────────────────────

function ensureDirs(projectRoot: string): void {
  const dirs = [
    join(projectRoot, COMPOSED_LITE_DIR),
    join(projectRoot, ARTIFACTS_DIR),
    join(projectRoot, LOGS_DIR),
    join(projectRoot, RAW_LOGS_DIR),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ─── Fuse helper ─────────────────────────────────────────────────────────────

function fuse(state: ComposedLiteState, reason: FuseReason, projectRoot: string): void {
  state.fuse_reason = reason;
  state.status = "fused";
  appendAudit(projectRoot, state.run_id, {
    event: "fuse",
    payload: { fuse_reason: reason },
  });
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

export async function runComposedLite(req: ComposedLiteRunRequest): Promise<void> {
  const { projectRoot, ctx, pi } = req;

  // ── Prerequisite: git repo check ──────────────────────────────────────
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: projectRoot, stdio: "ignore" });
  } catch {
    ctx.ui.notify(
      "composed-lite requires a git repository. Initialize one with `git init` first.",
      "error",
    );
    return;
  }

  ensureDirs(projectRoot);

  // ── Acquire run lock (run_id not yet known — will update after init) ──
  try {
    acquireLock(projectRoot, "pending");
  } catch (err) {
    ctx.ui.notify(
      `Cannot start composed-lite: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
    return;
  }

  let state: ComposedLiteState;

  try {
    // ── Initialize or recover state ─────────────────────────────────────
    const existing = loadState(projectRoot);
    const canResumeActiveRun = Boolean(existing && existing.status === "active");
    const requestedRequirement = req.requirement.trim();

    if (!requestedRequirement && !canResumeActiveRun) {
      ctx.ui.notify(
        "composed-lite requires a requirement description. Usage: /gsd start composed-lite <description>",
        "error",
      );
      return;
    }

    if (existing && req.source === "resume") {
      state = existing;
      ctx.ui.notify(
        `Resuming composed-lite run ${state.run_id} at phase ${state.current_phase} (${PHASE_NAMES[state.current_phase]})`,
        "info",
      );
    } else if (existing && existing.status === "active") {
      if (requestedRequirement && requestedRequirement !== existing.requirement.trim()) {
        ctx.ui.notify(
          `Active composed-lite run ${existing.run_id} already exists for a different requirement.\n` +
          `Existing: ${existing.requirement}\n` +
          `Requested: ${requestedRequirement}\n\n` +
          `Resume the active run with /gsd start resume, or finish/reset it before starting a new one.`,
          "warning",
        );
        return;
      }

      // Existing active run found — resume it
      state = existing;
      ctx.ui.notify(
        `Found active composed-lite run ${state.run_id}, resuming at phase ${state.current_phase} (${PHASE_NAMES[state.current_phase]})`,
        "info",
      );
    } else {
      // Fresh start
      state = initState(projectRoot, {
        requirement: req.requirement,
        mode: req.mode,
      });
      ctx.ui.notify(
        `Starting composed-lite run ${state.run_id} in ${req.mode} mode`,
        "info",
      );
    }

    // Initialize main_model from session context (needed for cross-provider reviewer pick).
    //
    // Resolution order (v2):
    //   GSD_COMPOSED_LITE_MAIN_MODEL    (explicit, from external agent / docs)
    //   > GSD_SESSION_MODEL             (session-scoped, legacy)
    //   > ANTHROPIC_MODEL               (legacy, Anthropic-specific)
    //   > "unknown"                     (picker falls back to inferProvider("unknown"))
    if (!state.review.main_model) {
      state.review.main_model =
        (process.env.GSD_COMPOSED_LITE_MAIN_MODEL?.trim())
        || process.env.GSD_SESSION_MODEL
        || process.env.ANTHROPIC_MODEL
        || "unknown";
    }

    // Explicit main provider override. When set, the reviewer picker skips
    // substring-based provider inference and uses this value directly. Useful
    // when `main_model` carries a custom alias not recognised by inferProvider.
    if (!state.review.main_model_provider) {
      const mainProviderOverride = process.env.GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER?.trim();
      state.review.main_model_provider = mainProviderOverride || null;
    }

    // Update lock with actual run_id
    acquireLock(projectRoot, state.run_id);

    // Write STATE.json marker
    writeStateMarker(projectRoot, state);

    // Audit: run start
    appendAudit(projectRoot, state.run_id, {
      event: "run_start",
      payload: {
        mode: state.mode,
        requirement_hash: sha256(state.requirement),
        main_model: state.review.main_model,
        env_fingerprint: state.env_fingerprint,
      },
    });

    // ── Phase loop ──────────────────────────────────────────────────────
    const sequence = state.mode === "plan" ? PLAN_PHASE_SEQUENCE : FULL_PHASE_SEQUENCE;

    for (const phaseNum of sequence) {
      // Skip already completed phases
      if (state.phases[phaseNum].status === "completed" || state.phases[phaseNum].status === "skipped") {
        continue;
      }

      // Check for fuse
      if (state.fuse_reason && phaseNum !== 7) {
        // Skip to postmortem if fused (but always run phase 7 — C13)
        if (state.mode === "plan" && SKIP_IN_PLAN.has(phaseNum)) {
          continue;
        }
        continue;
      }

      // Budget check before each phase (except Phase 7 which always runs)
      if (phaseNum !== 7) {
        const allowAdmissionDecisionBeforeBudgetCheck =
          phaseNum === 0
          && state.admission.state === "awaiting_approval"
          && Boolean(req.admissionAction || req.carryForwardReviewAction);
        if (!allowAdmissionDecisionBeforeBudgetCheck) {
          syncElapsedBudgetMinutes(state);
        }
        const budgetCheck = allowAdmissionDecisionBeforeBudgetCheck ? { ok: true as const } : checkBudget(state);
        if (!budgetCheck.ok) {
          fuse(state, budgetCheck.fuseReason, projectRoot);
          saveState(projectRoot, state);
          // Don't break — let the loop reach Phase 7
          continue;
        }
      }

      // Phase prerequisites check (C4): all prior phases must be completed/skipped
      if (phaseNum !== 7) {
        const prior = sequence.filter(p => p < phaseNum);
        const allPriorDone = prior.every(p =>
          state.phases[p].status === "completed" || state.phases[p].status === "skipped"
        );
        if (!allPriorDone) {
          fuse(state, "state_integrity_error", projectRoot);
          saveState(projectRoot, state);
          continue;
        }
      }

      // Skip phases in plan mode
      if (state.mode === "plan" && SKIP_IN_PLAN.has(phaseNum)) {
        state.phases[phaseNum].status = "skipped";
        state.phases[phaseNum].completed_at = new Date().toISOString();
        appendAudit(projectRoot, state.run_id, {
          event: "phase_exit",
          payload: {
            phase: phaseNum,
            attempt: state.phases[phaseNum].attempt,
            outcome: "skipped",
            failure_reason: "plan_mode",
            output_hash: null,
          },
        });
        saveState(projectRoot, state);
        continue;
      }

      // ── Execute phase ───────────────────────────────────────────────
      state.phases[phaseNum].status = "running";
      state.phases[phaseNum].started_at = new Date().toISOString();
      state.current_phase = phaseNum;
      saveState(projectRoot, state);

      appendAudit(projectRoot, state.run_id, {
        event: "phase_enter",
        payload: {
          phase: phaseNum,
          attempt: state.phases[phaseNum].attempt,
          revision_round: state.phases[phaseNum].revision_round,
        },
      });

      try {
        const handler = PHASE_HANDLERS[phaseNum];
        await handler(state, req);

        // Phase completed successfully
        state.phases[phaseNum].status = "completed";
        state.phases[phaseNum].completed_at = new Date().toISOString();
        state.budget.consecutive_failures = 0;

        appendAudit(projectRoot, state.run_id, {
          event: "phase_exit",
          payload: {
            phase: phaseNum,
            attempt: state.phases[phaseNum].attempt,
            outcome: "completed",
            failure_reason: null,
            output_hash: state.phases[phaseNum].artifact_envelope.output_hash,
          },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);

        // VerifyReentrySignal: Phase 5 verification failed but reentry budget
        // allows retrying Phase 4. This is NOT a failure — don't increment
        // consecutive_failures. Phase 4/5 status was already reset by p5.
        if (err instanceof VerifyReentrySignal) {
          appendAudit(projectRoot, state.run_id, {
            event: "phase_exit",
            payload: {
              phase: phaseNum,
              attempt: state.phases[phaseNum].attempt,
              outcome: "reentry",
              failure_reason: reason,
              output_hash: state.phases[phaseNum].artifact_envelope.output_hash,
            },
          });
          saveState(projectRoot, state);
          continue; // runner loop will re-visit Phase 4 (now pending)
        }

        if (err instanceof AdmissionPendingSignal) {
          state.phases[phaseNum].status = "pending";
          state.phases[phaseNum].failure_reason = null;
          appendAudit(projectRoot, state.run_id, {
            event: "phase_exit",
            payload: {
              phase: phaseNum,
              attempt: state.phases[phaseNum].attempt,
              outcome: "pending_approval",
              failure_reason: reason,
              output_hash: state.phases[phaseNum].artifact_envelope.output_hash,
            },
          });
          saveState(projectRoot, state);
          ctx.ui.notify(
            `Composed-lite run ${state.run_id} is waiting for admission approval. Re-run with --approve or --reject.`,
            "info",
          );
          return;
        }

        // Check if this is a fuse-triggering error
        if (isFuseError(err)) {
          const fuseReason = extractFuseReason(err);
          fuse(state, fuseReason, projectRoot);
          state.phases[phaseNum].status = "fused";
          state.phases[phaseNum].failure_reason = reason;
        } else {
          state.phases[phaseNum].status = "failed";
          state.phases[phaseNum].failure_reason = reason;
          state.budget.consecutive_failures++;

          // Check consecutive failures budget
          if (state.budget.consecutive_failures >= state.budget.max_consecutive_failures) {
            fuse(state, "consecutive_failures", projectRoot);
          }
        }

        appendAudit(projectRoot, state.run_id, {
          event: "phase_exit",
          payload: {
            phase: phaseNum,
            attempt: state.phases[phaseNum].attempt,
            outcome: state.phases[phaseNum].status === "fused" ? "fused" : "failed",
            failure_reason: reason,
            output_hash: null,
          },
        });

        saveState(projectRoot, state);

        if (!state.fuse_reason && state.phases[phaseNum].status === "failed") {
          ctx.ui.notify(
            `Composed-lite run ${state.run_id} stopped at phase ${phaseNum} (${PHASE_NAMES[phaseNum]}) after a non-fuse failure. ` +
            `Fix the issue and re-run with /gsd start resume.`,
            "warning",
          );
          return;
        }
      }

      // Update elapsed time
      syncElapsedBudgetMinutes(state);

      saveState(projectRoot, state);
    }

    // ── Set final status ────────────────────────────────────────────────
    if (!state.fuse_reason) {
      state.status = "completed";
    }
    // fuse_reason already set status to "fused" via fuse()
    state.updated_at = new Date().toISOString();
    saveState(projectRoot, state);

    ctx.ui.notify(
      `Composed-lite run ${state.run_id} finished: ${state.status}` +
      (state.fuse_reason ? ` (fuse: ${state.fuse_reason})` : ""),
      state.status === "completed" ? "info" : "warning",
    );

  } finally {
    releaseLock(projectRoot);
  }
}

// ─── Error classification ────────────────────────────────────────────────────

function isFuseError(err: unknown): err is ComposedLiteFuseError {
  return err instanceof ComposedLiteFuseError;
}

function extractFuseReason(err: ComposedLiteFuseError): FuseReason {
  return err.fuseReason;
}
