/**
 * composed-lite/review-harness.ts — Reviewer subagent invocation wrapper.
 *
 * Contract C1: Main agent never executes review — only this harness can.
 * Contract C2: Reviewer must be cross-provider (via picker).
 * Contract C12: Subagent identity injected by harness, not forgeable.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { parse as yamlParse } from "yaml";

import type {
  ComposedLiteState,
  ArtifactEnvelope,
  ArtifactKind,
  PhaseNumber,
  ComposedLiteRunRequest,
} from "./types.js";
import { RAW_LOGS_DIR, buildRunScopedRawLogFileName } from "./types.js";
import { writeArtifact, sha256 } from "./artifacts.js";
import { appendAudit } from "./audit-log.js";
import { ComposedLiteFuseError } from "./types.js";
import { buildModelArg } from "./model-arg.js";
import { spawnGsdSubagent } from "./subagent-spawn.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewResult {
  overall_assessment: "pass" | "issues" | "fail";
  critical: Array<{ id: string; target: string; rationale: string }>;
  important: Array<{ id: string; target: string; rationale: string }>;
  minor: Array<{ id: string; target: string; rationale: string }>;
  rationale: string;
}

interface ReviewHarnessInput {
  state: ComposedLiteState;
  req: ComposedLiteRunRequest;
  phase: PhaseNumber;
  artifactKind: ArtifactKind;
  reviewPrompt: string;
  targetContent: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writePromptToTempFile(name: string, prompt: string): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "cl-reviewer-"));
  const filePath = join(tmpDir, `prompt-${name}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

/**
 * Spawn a subagent process and capture its output.
 *
 * `buildModelArg` is imported from `model-arg.js` so the same
 * provider-qualification rule applies to reviewer + main-agent subagents.
 */
async function spawnReviewer(
  projectRoot: string,
  reviewer: { model: string; provider: string | null | undefined },
  task: string,
  systemPromptPath: string,
 ): Promise<Awaited<ReturnType<typeof spawnGsdSubagent>>> {
  const modelArg = buildModelArg(reviewer.model, reviewer.provider);
  return spawnGsdSubagent({
    projectRoot,
    task,
    modelArg,
    extraArgs: ["--append-system-prompt", systemPromptPath],
  });
}

/**
 * Parse reviewer YAML output with strict schema validation.
 */
function parseReviewerOutput(raw: string): ReviewResult | null {
  // Extract YAML from possible markdown code fences
  let yamlContent = raw;
  const fenceMatch = raw.match(/```(?:yaml)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    yamlContent = fenceMatch[1];
  }

  try {
    const parsed = yamlParse(yamlContent) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const assessment = parsed.overall_assessment;
    if (assessment !== "pass" && assessment !== "issues" && assessment !== "fail") return null;

    return {
      overall_assessment: assessment,
      critical: Array.isArray(parsed.critical) ? parsed.critical : [],
      important: Array.isArray(parsed.important) ? parsed.important : [],
      minor: Array.isArray(parsed.minor) ? parsed.minor : [],
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the review harness. This is the ONLY valid path for producing review artifacts.
 *
 * - Spawns composed-lite-reviewer subagent with the picked model
 * - Parses output strictly
 * - Retries once on parse failure
 * - Writes review artifact via writeArtifact
 * - Returns the review result
 */
export async function runReview(input: ReviewHarnessInput): Promise<ReviewResult> {
  const { state, req, phase, artifactKind, reviewPrompt, targetContent } = input;
  const { projectRoot } = req;

  const reviewerModel = state.review.reviewer_model;
  const reviewerProvider = state.review.reviewer_provider;

  if (!reviewerModel || !reviewerProvider) {
    throw new ComposedLiteFuseError("review_unavailable", "No reviewer model configured");
  }

  // Build the task prompt
  const task = [
    reviewPrompt,
    "",
    "--- TARGET CONTENT ---",
    targetContent,
    "--- END TARGET CONTENT ---",
  ].join("\n");

  const inputHash = sha256(task);

  // Build reviewer system prompt inline (matches composed-lite-reviewer.md agent spec)
  const reviewerSystemPrompt = `You are an independent reviewer for the composed-lite workflow.
Output EXACTLY one YAML document with these keys:
- overall_assessment: pass | issues | fail
- critical: list of {id, target, rationale}
- important: list of {id, target, rationale}
- minor: list of {id, target, rationale}
- rationale: string

Do not propose implementation unless needed to explain a defect.
Do not claim to have executed commands.`;

  const tmp = writePromptToTempFile("reviewer", reviewerSystemPrompt);

  // Audit: subagent call
  appendAudit(projectRoot, state.run_id, {
    event: "subagent_call",
    payload: {
      phase,
      agent: "composed-lite-reviewer",
      model: reviewerModel,
      provider: reviewerProvider,
      input_hash: inputHash,
    },
  });

  let result: ReviewResult | null = null;
  let rawLogHash = "";
  let rawLogRelPath = "";
  const maxRetries = 2;
  let terminalFailure: string | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const spawnResult = await spawnReviewer(
      projectRoot,
      { model: reviewerModel, provider: reviewerProvider },
      task,
      tmp.filePath,
    );

    // Write raw log
    const rawLogFileName = buildRunScopedRawLogFileName(
      state.run_id,
      `${phase}-${state.phases[phase].attempt}-reviewer-${attempt}.jsonl`,
    );
    const rawLogPath = join(
      projectRoot,
      RAW_LOGS_DIR,
      rawLogFileName,
    );
    rawLogRelPath = `logs/raw/${rawLogFileName}`;
    const rawLogDir = dirname(rawLogPath);
    if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
    writeFileSync(rawLogPath, spawnResult.rawOutput);
    rawLogHash = sha256(spawnResult.rawOutput);

    const terminalResult = spawnResult.terminalResult;
    if (terminalResult.terminalError) {
      terminalFailure = [
        `Reviewer invocation failed`,
        terminalResult.provider ? `provider=${terminalResult.provider}` : null,
        terminalResult.model ? `model=${terminalResult.model}` : null,
        terminalResult.errorMessage ?? terminalResult.terminalError,
      ].filter(Boolean).join(" | ");
    }

    result = terminalFailure ? null : parseReviewerOutput(terminalResult.outputText);

    // Audit: subagent result
    appendAudit(projectRoot, state.run_id, {
      event: "subagent_result",
      payload: {
        phase,
        agent: "composed-lite-reviewer",
        raw_log_hash: rawLogHash,
        stop_reason: terminalResult.stopReason,
        error_message: terminalResult.errorMessage,
        parsed_ok: Boolean(result),
      },
    });

    if (terminalFailure) {
      break;
    }

    if (result) {
      appendAudit(projectRoot, state.run_id, {
        event: "reviewer_verdict",
        payload: {
          phase,
          overall_assessment: result.overall_assessment,
          critical_count: result.critical.length,
          important_count: result.important.length,
        },
      });
      break;
    }
  }

  // Cleanup temp files
  try { fs.unlinkSync(tmp.filePath); } catch { /* ignore */ }
  try { fs.rmSync(tmp.dir, { recursive: true }); } catch { /* ignore */ }

  if (terminalFailure) {
    throw new ComposedLiteFuseError("review_unavailable", terminalFailure);
  }

  if (!result) {
    throw new ComposedLiteFuseError(
      "review_parse_exhausted",
      "Failed to parse reviewer output after retries",
    );
  }

  // Write review artifact
  const body = `overall_assessment: ${result.overall_assessment}
critical:
${result.critical.map(c => `  - id: ${c.id}\n    target: "${c.target}"\n    rationale: "${c.rationale}"`).join("\n") || "  []"}
important:
${result.important.map(c => `  - id: ${c.id}\n    target: "${c.target}"\n    rationale: "${c.rationale}"`).join("\n") || "  []"}
minor:
${result.minor.map(c => `  - id: ${c.id}\n    target: "${c.target}"\n    rationale: "${c.rationale}"`).join("\n") || "  []"}
rationale: "${result.rationale}"
`;

  const envelope = writeArtifact(projectRoot, artifactKind, body, {
    schema_version: 1,
    run_id: state.run_id,
    phase,
    attempt: state.phases[phase].attempt,
    revision_round: state.phases[phase].revision_round,
    artifact_kind: artifactKind,
    producer_kind: "subagent_reviewer",
    producer_id: `reviewer-${phase}-${state.phases[phase].attempt}`,
    provider: reviewerProvider,
    model: reviewerModel,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: null, // filled by caller if needed
    input_hash: inputHash,
    raw_log_hash: rawLogHash,
    raw_log_path: rawLogRelPath,
  });

  // Update phase envelope in state
  state.phases[phase].artifact_envelope = {
    path: artifactKind,
    output_hash: envelope.output_hash,
    producer_kind: "subagent_reviewer",
    producer_id: envelope.producer_id,
    provider: reviewerProvider,
    model: reviewerModel,
  };

  return result;
}
