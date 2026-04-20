/**
 * Phase 2 — Design
 *
 * Main agent generates design-doc.md, then review-harness runs independent review.
 * Contract C1: Review only via harness. C11: Revision exhausted → fuse.
 */

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { saveState } from "../state.js";
import { runReview, type ReviewResult } from "../review-harness.js";
import { pickReviewerModel, ReviewerUnavailableError } from "../review-model-picker.js";
import { ComposedLiteFuseError } from "../types.js";
import { resolveGsdBin } from "../resolve-bin.js";

const MAX_REVISION_ROUNDS = 2;

// ─── Helper: spawn worker for design ────────────────────────────────────────

async function generateDesign(
  projectRoot: string,
  task: string,
): Promise<{ output: string; rawOutput: string }> {
  const args: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    `Task: ${task}`,
  ];

  const bundledPaths = (process.env.GSD_BUNDLED_EXTENSION_PATHS ?? "")
    .split(delimiter).map(s => s.trim()).filter(Boolean);
  const extensionArgs = bundledPaths.flatMap(p => ["--extension", p]);

  return new Promise((resolve) => {
    const gsdBin = resolveGsdBin();
    if (!gsdBin) {
      resolve({ output: "", rawOutput: "" });
      return;
    }
    const proc = spawn(
      process.execPath,
      [gsdBin, ...extensionArgs, ...args],
      { cwd: projectRoot, shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", () => {});

    proc.on("close", () => {
      let output = "";
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "message_end" && event.message?.role === "assistant") {
            for (const part of event.message.content) {
              if (part.type === "text") output = part.text;
            }
          }
        } catch { /* skip */ }
      }
      resolve({ output, rawOutput: stdout });
    });

    proc.on("error", () => {
      resolve({ output: "", rawOutput: "" });
    });
  });
}

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase2(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  // ── Setup reviewer ──────────────────────────────────────────────────────
  try {
    const pickerResult = pickReviewerModel({
      mainModel: state.review.main_model || "unknown",
      env: process.env,
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

  // ── Design + Review loop ────────────────────────────────────────────────
  ctx.ui.notify("Phase 2: Design — generating design document...", "info");

  for (let round = 0; round <= MAX_REVISION_ROUNDS; round++) {
    state.phases[2].revision_round = round;

    // Generate design
    const designTask = round === 0
      ? `Based on the following requirement and research, create a comprehensive design document.\n\nRequirement: ${state.requirement}\n\nResearch:\n${researchContext}\n\nOutput a markdown design document covering: overview, approach, key decisions, file changes needed, edge cases, and testing strategy.`
      : `Revise the design document based on the reviewer feedback. Address all critical and important issues.\n\nPrevious design:\n${readArtifact(projectRoot, "design-doc")?.body || "(missing)"}\n\nReviewer feedback:\n${readArtifact(projectRoot, "design-review")?.body || "(missing)"}\n\nOutput the complete revised design document.`;

    const designResult = await generateDesign(projectRoot, designTask);

    // Write raw log
    const rawLogPath = join(projectRoot, RAW_LOGS_DIR, `2-${state.phases[2].attempt}-design-${round}.jsonl`);
    const rawLogDir = dirname(rawLogPath);
    if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
    writeFileSync(rawLogPath, designResult.rawOutput);

    // Write design artifact
    const designBody = designResult.output || "# Design Document\n\n(empty)";
    const designEnvelope = writeArtifact(projectRoot, "design-doc", designBody, {
      schema_version: 1,
      run_id: state.run_id,
      phase: 2,
      attempt: state.phases[2].attempt,
      revision_round: round,
      artifact_kind: "design-doc",
      producer_kind: "main_agent",
      producer_id: `design-agent-${round}`,
      provider: null,
      model: null,
      admission_hash: state.admission.admission_hash || "",
      prev_phase_output_hash: state.phases[1].artifact_envelope.output_hash,
      input_hash: sha256(designTask),
      raw_log_hash: sha256(designResult.rawOutput),
      raw_log_path: `logs/raw/2-${state.phases[2].attempt}-design-${round}.jsonl`,
    });

    // ── Run review ──────────────────────────────────────────────────────
    ctx.ui.notify(`Phase 2: Running independent design review (round ${round + 1})...`, "info");

    const reviewResult = await runReview({
      state,
      req,
      phase: 2,
      artifactKind: "design-review",
      reviewPrompt: "Review this design document for correctness, completeness, edge cases, and whether the proposed approach will work.",
      targetContent: designBody,
    });

    if (reviewResult.overall_assessment === "pass") {
      // Update phase envelope to point to design-doc (not review)
      state.phases[2].artifact_envelope = {
        path: "design-doc",
        output_hash: designEnvelope.output_hash,
        producer_kind: "main_agent",
        producer_id: `design-agent-${round}`,
        provider: null,
        model: null,
      };
      ctx.ui.notify("Phase 2: Design review passed.", "info");
      return;
    }

    const issueCount = reviewResult.critical.length + reviewResult.important.length;
    ctx.ui.notify(
      `Phase 2: Design review — ${reviewResult.overall_assessment} (${issueCount} issues). ` +
      (round < MAX_REVISION_ROUNDS ? "Revising..." : "Max revisions reached."),
      round < MAX_REVISION_ROUNDS ? "info" : "warning",
    );
  }

  // C11: Revision exhausted → fuse
  throw new ComposedLiteFuseError(
    "design_review_exhausted",
    `Design review did not pass after ${MAX_REVISION_ROUNDS + 1} rounds`,
  );
}
