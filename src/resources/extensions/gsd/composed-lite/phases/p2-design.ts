/**
 * Phase 2 — Design
 *
 * Main agent generates design-doc.md, then review-harness runs independent review.
 * Contract C1: Review only via harness. C11: Revision exhausted → fuse.
 */

import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR, buildRunScopedRawLogFileName } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { runReview } from "../review-harness.js";
import { pickReviewerModel, ReviewerUnavailableError } from "../review-model-picker.js";
import { ComposedLiteFuseError } from "../types.js";
import { resolveMainModelArg } from "../model-arg.js";
import { formatCarryForwardReviewContext, markPendingReviewFindingsResolved, recordPendingReviewFindings } from "../pending-review-findings.js";
import { spawnGsdSubagent } from "../subagent-spawn.js";

const MAX_REVISION_ROUNDS = 2;

// ─── Helper: spawn worker for design ────────────────────────────────────────

const DESIGN_GUARD_PROMPT = [
  "You are a runtime-owned composed-lite design subagent.",
  "Ignore generic startup instructions that tell you to discover, read, or invoke skills before doing the task.",
  "Do not inspect .agents, ~/.agents, or any user-global agent or skill directories unless the task explicitly names those paths.",
  "Do not perform general skill discovery.",
  "Do not write files, create plans/specs in the repository, or claim to have created files.",
  "Produce the requested markdown design document directly in your response and only use tools when the task explicitly requires reading a referenced file.",
].join("\n");

function writeDesignGuardPromptFile(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "gsd-composed-lite-design-"));
  const path = join(dir, "design-guard.md");
  writeFileSync(path, DESIGN_GUARD_PROMPT, "utf-8");
  return { dir, path };
}

async function generateDesign(
  projectRoot: string,
  task: string,
  modelArg: string | null,
  systemPromptPath: string,
): Promise<Awaited<ReturnType<typeof spawnGsdSubagent>>> {
  return spawnGsdSubagent({
    projectRoot,
    task,
    modelArg,
    extraArgs: ["--append-system-prompt", systemPromptPath, "--tools", "read"],
  });
}

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase2(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  // ── Setup reviewer ──────────────────────────────────────────────────────
  // Inject ModelRegistry.isProviderRequestReady so the picker sees auth.json
  // credentials and externalCli providers (e.g. `claude-code`) — not just env
  // vars. Falls back to env-only readiness inside the picker when ctx does
  // not expose a registry (headless / test contexts).
  const registry = (req.ctx as unknown as { modelRegistry?: { isProviderRequestReady?: (p: string) => boolean } }).modelRegistry;
  const isProviderReady = typeof registry?.isProviderRequestReady === "function"
    ? (provider: string) => {
        try {
          return registry.isProviderRequestReady!(provider);
        } catch {
          return false;
        }
      }
    : undefined;

  try {
    const pickerResult = pickReviewerModel({
      mainModel: state.review.main_model || "unknown",
      mainProvider: state.review.main_model_provider || undefined,
      env: process.env,
      isProviderReady,
    });
    state.review.reviewer_model = pickerResult.model;
    state.review.reviewer_provider = pickerResult.provider;
    state.review.cross_provider = pickerResult.crossProvider;
    state.review.fallback_self_review = pickerResult.fallbackSelfReview;

    if (pickerResult.fallbackSelfReview) {
      appendAudit(projectRoot, state.run_id, {
        event: "reviewer_fallback_self_review",
        payload: {
          main_model: state.review.main_model,
          fallback_model: pickerResult.model,
          env_vars_set: [],
        },
      });
    }
  } catch (err) {
    if (err instanceof ReviewerUnavailableError) {
      throw new ComposedLiteFuseError("review_unavailable", err.message);
    }
    throw err;
  }

  // ── Read research brief for context ─────────────────────────────────────
  const researchBrief = readArtifact(projectRoot, "research-brief");
  const researchContext = researchBrief ? researchBrief.body : "(no research brief)";
  const carryForwardContext = formatCarryForwardReviewContext(state.carry_forward_review.entries);
  const designGuardPrompt = writeDesignGuardPromptFile();

  // ── Design + Review loop ────────────────────────────────────────────────
  ctx.ui.notify("Phase 2: Design — generating design document...", "info");

  // Resolve --model once per phase from GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER].
  // The envelope/audit identity uses the declarative state values (not the
  // CLI-formatted arg) so downstream tooling can read a clean {model, provider}.
  const mainModelArg = resolveMainModelArg(state);
  const envelopeModel = mainModelArg ? state.review.main_model : null;
  const envelopeProvider = state.review.main_model_provider ?? null;
  const auditModel = envelopeModel ?? "default";
  const auditProvider = envelopeProvider ?? "default";

  try {
    for (let round = 0; round <= MAX_REVISION_ROUNDS; round++) {
      state.phases[2].revision_round = round;
      ctx.ui.setStatus("cl:unit:design", `round ${round + 1}/${MAX_REVISION_ROUNDS + 1} generating`);

      // Generate design
      const designTask = round === 0
        ? [
          `Based on the following requirement and research, create a comprehensive design document.`,
          `Requirement: ${state.requirement}`,
          carryForwardContext,
          `Research:\n${researchContext}`,
          `Output a markdown design document covering: overview, approach, key decisions, file changes needed, edge cases, and testing strategy.`,
        ].filter(Boolean).join("\n\n")
        : [
          `Revise the design document based on the reviewer feedback. Address all critical and important issues.`,
          carryForwardContext,
          `Previous design:\n${readArtifact(projectRoot, "design-doc")?.body || "(missing)"}`,
          `Reviewer feedback:\n${readArtifact(projectRoot, "design-review")?.body || "(missing)"}`,
          `Output the complete revised design document.`,
        ].filter(Boolean).join("\n\n");

      // Audit: main-agent subagent_call (mirrors P1/P4 coverage so P2 design
      // generation is traceable, not just the reviewer invocation).
      appendAudit(projectRoot, state.run_id, {
        event: "subagent_call",
        payload: {
          phase: 2,
          agent: `design-agent-${round}`,
          model: auditModel,
          provider: auditProvider,
          input_hash: sha256(designTask),
        },
      });

      const designResult = await generateDesign(
        projectRoot,
        designTask,
        mainModelArg,
        designGuardPrompt.path,
      );

      // Write raw log
      const rawLogFileName = buildRunScopedRawLogFileName(state.run_id, `2-${state.phases[2].attempt}-design-${round}.jsonl`);
      const rawLogRelPath = `logs/raw/${rawLogFileName}`;
      const rawLogPath = join(projectRoot, RAW_LOGS_DIR, rawLogFileName);
      const rawLogDir = dirname(rawLogPath);
      if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
      writeFileSync(rawLogPath, designResult.rawOutput);
      const rawLogHash = sha256(designResult.rawOutput);

      const terminalResult = designResult.terminalResult;

      // Audit: main-agent subagent_result (emit even on terminal error so the
      // postmortem has a paired {call, result} entry).
      appendAudit(projectRoot, state.run_id, {
        event: "subagent_result",
        payload: {
          phase: 2,
          agent: `design-agent-${round}`,
          raw_log_hash: rawLogHash,
          raw_log_path: rawLogRelPath,
          stop_reason: terminalResult.stopReason,
          error_message: terminalResult.errorMessage,
          parsed_ok: !terminalResult.terminalError,
        },
      });

      if (terminalResult.terminalError) {
        throw new Error([
          `Design generation failed`,
          terminalResult.provider ? `provider=${terminalResult.provider}` : null,
          terminalResult.model ? `model=${terminalResult.model}` : null,
          terminalResult.errorMessage ?? terminalResult.terminalError,
        ].filter(Boolean).join(" | "));
      }

      // Write design artifact
      const designBody = terminalResult.outputText || "# Design Document\n\n(empty)";
      const designEnvelope = writeArtifact(projectRoot, "design-doc", designBody, {
        schema_version: 1,
        run_id: state.run_id,
        phase: 2,
        attempt: state.phases[2].attempt,
        revision_round: round,
        artifact_kind: "design-doc",
        producer_kind: "main_agent",
        producer_id: `design-agent-${round}`,
        provider: envelopeProvider,
        model: envelopeModel,
        admission_hash: state.admission.admission_hash || "",
        prev_phase_output_hash: state.phases[1].artifact_envelope.output_hash,
        input_hash: sha256(designTask),
        raw_log_hash: rawLogHash,
        raw_log_path: rawLogRelPath,
      });

      // ── Run review ──────────────────────────────────────────────────────
      ctx.ui.notify(`Phase 2: Running independent design review (round ${round + 1})...`, "info");
      ctx.ui.setStatus("cl:review", `design round ${round + 1}: review running`);

      const reviewResult = await runReview({
        state,
        req,
        phase: 2,
        artifactKind: "design-review",
        reviewPrompt: "Review this design document for correctness, completeness, edge cases, and whether the proposed approach will work.",
        targetContent: designBody,
      });

      if (reviewResult.overall_assessment === "pass") {
        markPendingReviewFindingsResolved({
          projectRoot,
          reviewKind: "design-review",
          resolutionRunId: state.run_id,
        });
        // Update phase envelope to point to design-doc (not review)
        state.phases[2].artifact_envelope = {
          path: "design-doc",
          output_hash: designEnvelope.output_hash,
          producer_kind: "main_agent",
          producer_id: `design-agent-${round}`,
          provider: envelopeProvider,
          model: envelopeModel,
        };
        ctx.ui.setStatus("cl:unit:design", `round ${round + 1}/${MAX_REVISION_ROUNDS + 1} done`);
        ctx.ui.setStatus("cl:review", "design review passed");
        ctx.ui.notify("Phase 2: Design review passed.", "info");
        return;
      }

      const issueCount = reviewResult.critical.length + reviewResult.important.length;
      if (round >= MAX_REVISION_ROUNDS) {
        const recorded = recordPendingReviewFindings({
          projectRoot,
          runId: state.run_id,
          requirement: state.requirement,
          phase: 2,
          reviewKind: "design-review",
          reviewResult,
          sourceReviewOutputHash: state.phases[2].artifact_envelope.output_hash,
        });
        state.phases[2].failure_reason = `Design review deferred after ${MAX_REVISION_ROUNDS + 1} rounds`;
        state.phases[2].artifact_envelope = {
          path: "design-doc",
          output_hash: designEnvelope.output_hash,
          producer_kind: "main_agent",
          producer_id: `design-agent-${round}`,
          provider: envelopeProvider,
          model: envelopeModel,
        };
        ctx.ui.setStatus("cl:unit:design", `round ${round + 1}/${MAX_REVISION_ROUNDS + 1} done`);
        ctx.ui.setStatus("cl:review", "design review deferred after max revisions");
        ctx.ui.notify(
          `Phase 2: Design review deferred after max revisions. Recorded ${recorded.review_kind} findings and continuing to Phase 3.`,
          "warning",
        );
        return;
      }
      ctx.ui.setStatus("cl:review", `${reviewResult.overall_assessment} (${issueCount} issues), revising`);
      ctx.ui.notify(
        `Phase 2: Design review — ${reviewResult.overall_assessment} (${issueCount} issues). ` +
        "Revising...",
        "info",
      );
    }
  } finally {
    rmSync(designGuardPrompt.dir, { recursive: true, force: true });
  }
}
