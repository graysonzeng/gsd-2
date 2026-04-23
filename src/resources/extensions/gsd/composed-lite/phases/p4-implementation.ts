/**
 * Phase 4 — Implementation
 *
 * Executes impl-plan steps sequentially via worker subagent.
 * Contract C5: git diff is truth source (empty diff → fuse).
 */

import { execSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as yamlParse } from "yaml";

import type { ArtifactEnvelope, ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR, buildRunScopedRawLogFileName } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { saveState } from "../state.js";
import { runReview, type ReviewResult } from "../review-harness.js";
import { ComposedLiteFuseError } from "../types.js";
import { resolveMainModelArg } from "../model-arg.js";
import { formatCarryForwardReviewContext, markPendingReviewFindingsResolved, recordPendingReviewFindings } from "../pending-review-findings.js";
import { spawnGsdSubagent } from "../subagent-spawn.js";

const MAX_REVISION_ROUNDS = 2;

interface AcceptanceAssertion extends Record<string, unknown> {
  kind?: string;
  target?: string;
  pattern?: string;
  node?: string;
  test_name?: string;
}

interface ImplementationStep {
  title: string;
  files: string[];
  acceptance: AcceptanceAssertion[];
}

interface RoundSummary {
  body: string;
  envelope: ArtifactEnvelope;
}

async function spawnWorker(
  projectRoot: string,
  task: string,
  modelArg: string | null,
): Promise<Awaited<ReturnType<typeof spawnGsdSubagent>>> {
  return spawnGsdSubagent({
    projectRoot,
    task,
    modelArg,
  });
}

function normalizeGitPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return "";
  const renameParts = trimmed.split(" -> ");
  return renameParts[renameParts.length - 1]?.trim() ?? "";
}

function isRelevantPath(filePath: string): boolean {
  return Boolean(filePath) && filePath !== ".gsd" && !filePath.startsWith(".gsd/");
}

export function getGitDiffStats(projectRoot: string, baselineSha: string): { files: string[]; insertions: number; deletions: number } {
  try {
    const numstat = execSync(
      `git diff --numstat ${baselineSha}`,
      { cwd: projectRoot, encoding: "utf-8" },
    ).trim();

    let insertions = 0;
    let deletions = 0;
    const files = new Set<string>();

    if (numstat) {
      for (const line of numstat.split("\n")) {
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const ins = parseInt(parts[0], 10) || 0;
          const del = parseInt(parts[1], 10) || 0;
          const file = normalizeGitPath(parts[2]);
          if (!isRelevantPath(file)) continue;
          insertions += ins;
          deletions += del;
          files.add(file);
        }
      }
    }

    const statusOutput = execSync(
      "git status --porcelain",
      { cwd: projectRoot, encoding: "utf-8" },
    ).trim();

    if (statusOutput) {
      for (const line of statusOutput.split("\n")) {
        if (!line.trim()) continue;
        const file = normalizeGitPath(line.slice(3));
        if (!isRelevantPath(file)) continue;
        if (file) files.add(file);
      }
    }

    return { files: [...files].sort(), insertions, deletions };
  } catch {
    return { files: [], insertions: 0, deletions: 0 };
  }
}

function parseImplementationSteps(implPlanBody: string): ImplementationStep[] {
  let parsed: unknown;
  try {
    parsed = yamlParse(implPlanBody);
  } catch {
    throw new Error("Failed to parse impl-plan YAML");
  }

  const obj = parsed as Record<string, unknown>;
  const steps = obj.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("impl-plan must contain a non-empty steps array");
  }

  return steps.map((step, index) => {
    const item = step as Record<string, unknown>;
    if (!item.title || typeof item.title !== "string") {
      throw new Error(`impl-plan step ${index} is missing a valid title`);
    }
    return {
      title: item.title,
      files: Array.isArray(item.files) ? item.files.map(String) : [],
      acceptance: Array.isArray(item.acceptance) ? item.acceptance as AcceptanceAssertion[] : [],
    };
  });
}

function formatAcceptance(assertions: AcceptanceAssertion[]): string {
  if (assertions.length === 0) return "- (none)";
  return assertions.map(assertion => `- ${JSON.stringify(assertion)}`).join("\n");
}

function formatReviewFeedback(reviewResult: ReviewResult | null): string {
  if (!reviewResult) return "";

  const findings = [
    ...reviewResult.critical.map(item => `- [critical] ${item.id} | target=${item.target} | ${item.rationale}`),
    ...reviewResult.important.map(item => `- [important] ${item.id} | target=${item.target} | ${item.rationale}`),
  ];

  const effectiveFindings = findings.length > 0
    ? findings
    : reviewResult.minor.map(item => `- [minor] ${item.id} | target=${item.target} | ${item.rationale}`);

  return [
    "Code review findings to address before continuing:",
    ...(effectiveFindings.length > 0 ? effectiveFindings : ["- No concrete findings were provided."]),
    reviewResult.rationale ? `Reviewer rationale: ${reviewResult.rationale}` : "",
  ].filter(Boolean).join("\n");
}

async function executeImplementationRound(input: {
  state: ComposedLiteState;
  req: ComposedLiteRunRequest;
  steps: ImplementationStep[];
  round: number;
  reviewFeedback: ReviewResult | null;
  previousSummary: string | null;
}): Promise<RoundSummary> {
  const {
    state,
    req,
    steps,
    round,
    reviewFeedback,
    previousSummary,
  } = input;
  const { projectRoot, ctx } = req;

  const lastFailure = state.last_verify_failure;
  const failureContext = lastFailure
    ? `\n\nIMPORTANT: Previous verification failed with: ${lastFailure}\nMake sure to fix this issue in your implementation.`
    : "";
  const reviewContext = reviewFeedback
    ? `\n\n${formatReviewFeedback(reviewFeedback)}`
    : "";
  const summaryContext = previousSummary
    ? `\n\nCurrent implementation summary from the previous round:\n${previousSummary}`
    : "";
  const revisionContext = round > 0
    ? `\n\nYou are in revision round ${round} after an independent code review. Keep good existing changes, fix the reported issues, and do not regress completed work.`
    : "";
  const carryForwardContext = state.carry_forward_review.entries.length > 0
    ? `\n\n${formatCarryForwardReviewContext(state.carry_forward_review.entries)}`
    : "";

  const rawLogHashes: string[] = [];

  // Resolve --model once per round from GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER].
  const modelArg = resolveMainModelArg(state);
  const auditModel = modelArg ?? "default";
  const auditProvider = state.review.main_model_provider ?? "default";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const workerStatusKey = "cl:unit:worker";

    ctx.ui.notify(`  Step ${i + 1}/${steps.length}: ${step.title}`, "info");
    ctx.ui.setStatus(workerStatusKey, `step ${i + 1}/${steps.length} started: ${step.title}`);

    const task = [
      "Implement the following step:",
      "",
      `Title: ${step.title}`,
      `Files to modify: ${step.files.join(", ") || "(not specified)"}`,
      "Acceptance assertions:",
      formatAcceptance(step.acceptance),
      "",
      `Context requirement: ${state.requirement}`,
      failureContext,
      revisionContext,
      reviewContext,
      carryForwardContext,
      summaryContext,
      "",
      "Make the necessary code changes. Do not just describe what to do — actually edit the files.",
    ].filter(Boolean).join("\n");

    appendAudit(projectRoot, state.run_id, {
      event: "subagent_call",
      payload: {
        phase: 4,
        agent: `worker-step-${i}-r${round}`,
        model: auditModel,
        provider: auditProvider,
        input_hash: sha256(task),
      },
    });

    const result = await spawnWorker(projectRoot, task, modelArg);

    const rawLogFileName = buildRunScopedRawLogFileName(state.run_id, `4-${state.phases[4].attempt}-worker-step${i}-r${round}.jsonl`);
    const rawLogRelPath = `logs/raw/${rawLogFileName}`;
    const rawLogPath = join(projectRoot, RAW_LOGS_DIR, rawLogFileName);
    const rawLogDir = dirname(rawLogPath);
    if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
    writeFileSync(rawLogPath, result.rawOutput);

    const rawLogHash = sha256(result.rawOutput);
    rawLogHashes.push(rawLogHash);
    const terminalResult = result.terminalResult;

    appendAudit(projectRoot, state.run_id, {
      event: "subagent_result",
      payload: {
        phase: 4,
        agent: `worker-step-${i}-r${round}`,
        raw_log_hash: rawLogHash,
        raw_log_path: rawLogRelPath,
        stop_reason: terminalResult.stopReason,
        error_message: terminalResult.errorMessage,
        parsed_ok: !terminalResult.terminalError,
      },
    });

    if (terminalResult.terminalError) {
      ctx.ui.setStatus(workerStatusKey, `step ${i + 1}/${steps.length} failed: ${step.title}`);
      throw new Error([
        `Worker step ${i + 1} failed`,
        terminalResult.provider ? `provider=${terminalResult.provider}` : null,
        terminalResult.model ? `model=${terminalResult.model}` : null,
        terminalResult.errorMessage ?? terminalResult.terminalError,
      ].filter(Boolean).join(" | "));
    }

    ctx.ui.setStatus(workerStatusKey, `step ${i + 1}/${steps.length} done: ${step.title}`);
  }

  if (!state.git.baseline_sha || state.git.baseline_sha === "unknown") {
    throw new Error("Phase 4 baseline SHA unavailable");
  }

  const diff = getGitDiffStats(projectRoot, state.git.baseline_sha);
  if (diff.files.length === 0) {
    throw new ComposedLiteFuseError(
      "implementation_empty_diff",
      "No file changes detected after implementation (git diff is empty)",
    );
  }

  const summaryBody = [
    `# Implementation Summary`,
    ``,
    `Revision round: ${round}`,
    `Steps completed: ${steps.length}`,
    `Files changed: ${diff.files.length}`,
    `Insertions: +${diff.insertions}`,
    `Deletions: -${diff.deletions}`,
    ``,
    `## Changed files`,
    ...diff.files.map(file => `- ${file}`),
  ].join("\n");

  const summaryEnvelope = writeArtifact(projectRoot, "implementation-summary", summaryBody, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 4,
    attempt: state.phases[4].attempt,
    revision_round: round,
    artifact_kind: "implementation-summary",
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: state.phases[3].artifact_envelope.output_hash,
    input_hash: sha256(steps.map(step => step.title).join(",")),
    raw_log_hash: sha256(rawLogHashes.join(",")),
    raw_log_path: `logs/raw/${buildRunScopedRawLogFileName(state.run_id, `4-${state.phases[4].attempt}-worker-step*-r${round}.jsonl`)}`,
  });

  state.phases[4].artifact_envelope = {
    path: "implementation-summary",
    output_hash: summaryEnvelope.output_hash,
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
  };

  return {
    body: summaryBody,
    envelope: summaryEnvelope,
  };
}

export async function runPhase4(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  // Record baseline SHA
  try {
    state.git.baseline_sha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
  } catch {
    state.git.baseline_sha = "unknown";
  }
  state.phases[4].revision_round = 0;
  state.phases[4].failure_reason = null;
  saveState(projectRoot, state);

  ctx.ui.notify("Phase 4: Implementation — executing implementation steps...", "info");

  // Read impl-plan
  const implPlan = readArtifact(projectRoot, "impl-plan");
  if (!implPlan) throw new Error("impl-plan artifact not found");

  const steps = parseImplementationSteps(implPlan.body);
  let reviewFeedback: ReviewResult | null = null;
  let previousSummary: string | null = null;

  for (let round = 0; round <= MAX_REVISION_ROUNDS; round++) {
    state.phases[4].revision_round = round;
    saveState(projectRoot, state);

    if (round > 0) {
      ctx.ui.notify(`Phase 4: Re-running implementation for revision round ${round}...`, "info");
    }

    const summary = await executeImplementationRound({
      state,
      req,
      steps,
      round,
      reviewFeedback,
      previousSummary,
    });
    previousSummary = summary.body;

    ctx.ui.notify("Phase 4: Running independent code review...", "info");
    ctx.ui.setStatus("cl:review", `code review round ${round + 1}: running`);
    const reviewResult = await runReview({
      state,
      req,
      phase: 4,
      artifactKind: "code-review",
      reviewPrompt: "Review this implementation for correctness, security, and contract adherence.",
      targetContent: summary.body,
    });

    if (reviewResult.overall_assessment === "pass") {
      markPendingReviewFindingsResolved({
        projectRoot,
        reviewKind: "code-review",
        resolutionRunId: state.run_id,
      });
      state.phases[4].artifact_envelope = {
        path: "implementation-summary",
        output_hash: summary.envelope.output_hash,
        producer_kind: "runtime",
        producer_id: "runtime",
        provider: null,
        model: null,
      };
      ctx.ui.setStatus("cl:review", "code review passed");
      ctx.ui.notify("Phase 4: Code review passed.", "info");
      return;
    }

    if (round >= MAX_REVISION_ROUNDS) {
      const recorded = recordPendingReviewFindings({
        projectRoot,
        runId: state.run_id,
        requirement: state.requirement,
        phase: 4,
        reviewKind: "code-review",
        reviewResult,
        sourceReviewOutputHash: state.phases[4].artifact_envelope.output_hash,
      });
      state.phases[4].failure_reason = `Code review deferred after ${MAX_REVISION_ROUNDS + 1} rounds`;
      state.phases[4].artifact_envelope = {
        path: "implementation-summary",
        output_hash: summary.envelope.output_hash,
        producer_kind: "runtime",
        producer_id: "runtime",
        provider: null,
        model: null,
      };
      ctx.ui.setStatus("cl:review", "code review deferred after max revisions");
      ctx.ui.notify(
        `Phase 4: Code review deferred after max revisions. Recorded ${recorded.review_kind} findings and continuing to Phase 5.`,
        "warning",
      );
      return;
    }

    reviewFeedback = reviewResult;
    const issueCount = reviewResult.critical.length + reviewResult.important.length;
    ctx.ui.setStatus("cl:review", `${reviewResult.overall_assessment} (${issueCount} blocking issues), rerunning implementation`);
    ctx.ui.notify(
      `Phase 4: Code review — ${reviewResult.overall_assessment} (${issueCount} blocking issues). Re-running implementation...`,
      "warning",
    );
  }
}
