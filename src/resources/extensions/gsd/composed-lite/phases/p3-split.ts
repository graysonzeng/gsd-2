/**
 * Phase 3 — Split
 *
 * Splits the design into ≤8 ordered implementation steps.
 * Contract C14: impl-plan.acceptance must be strong schema.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as yamlParse } from "yaml";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR, buildRunScopedRawLogFileName } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { resolveMainModelArg } from "../model-arg.js";
import { formatCarryForwardReviewContext } from "../pending-review-findings.js";
import { spawnGsdSubagent } from "../subagent-spawn.js";

// ─── Acceptance assertion schema ─────────────────────────────────────────────

const VALID_ASSERTION_KINDS = new Set([
  "file_exists", "file_contains", "grep", "ast_match", "test_pass",
]);

interface AcceptanceAssertion {
  kind: string;
  target?: string;
  pattern?: string;
  node?: string;
  test_name?: string;
}

interface ImplStep {
  title: string;
  files: string[];
  acceptance: AcceptanceAssertion[];
  rollback_hint?: string;
}

function validateImplPlan(parsed: unknown): { valid: true; steps: ImplStep[] } | { valid: false; reason: string } {
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, reason: "impl-plan is not an object" };
  }

  const obj = parsed as Record<string, unknown>;
  const steps = obj.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, reason: "impl-plan must have a non-empty steps array" };
  }

  if (steps.length > 8) {
    return { valid: false, reason: `impl-plan has ${steps.length} steps (max 8)` };
  }

  const validatedSteps: ImplStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown>;
    if (!step.title || typeof step.title !== "string") {
      return { valid: false, reason: `Step ${i}: missing title` };
    }

    const acceptance = step.acceptance;
    if (!Array.isArray(acceptance) || acceptance.length === 0) {
      return { valid: false, reason: `Step ${i} ("${step.title}"): must have at least 1 acceptance assertion` };
    }

    for (const a of acceptance) {
      const assertion = a as AcceptanceAssertion;
      if (!assertion.kind || !VALID_ASSERTION_KINDS.has(assertion.kind)) {
        return {
          valid: false,
          reason: `Step ${i} ("${step.title}"): invalid acceptance kind "${assertion.kind}". Valid: ${[...VALID_ASSERTION_KINDS].join(", ")}`,
        };
      }
    }

    validatedSteps.push({
      title: step.title as string,
      files: Array.isArray(step.files) ? step.files.map(String) : [],
      acceptance: acceptance as AcceptanceAssertion[],
      rollback_hint: typeof step.rollback_hint === "string" ? step.rollback_hint : undefined,
    });
  }

  return { valid: true, steps: validatedSteps };
}

async function spawnSplitPlanner(
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

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase3(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 3: Split — breaking design into implementation steps...", "info");

  const designDoc = readArtifact(projectRoot, "design-doc");
  const designContent = designDoc ? designDoc.body : "(no design)";
  const carryForwardContext = formatCarryForwardReviewContext(state.carry_forward_review.entries);

  const task = `Based on this design document, create an implementation plan with ordered steps.

${carryForwardContext ? `${carryForwardContext}

` : ""}Design:
${designContent}

Output EXACTLY one YAML document with this structure:
\`\`\`yaml
steps:
  - title: "Step title"
    files:
      - "path/to/file.ts"
    acceptance:
      - kind: file_exists
        target: "path/to/file.ts"
      - kind: file_contains
        target: "path/to/file.ts"
        pattern: "export function"
    rollback_hint: "Revert changes to file.ts"
\`\`\`

Valid acceptance kinds: file_exists, file_contains, grep, ast_match, test_pass
Each step MUST have at least 1 acceptance assertion.
Maximum 8 steps. Order them by dependency.`;

  const modelArg = resolveMainModelArg(state);
  const envelopeModel = modelArg ? state.review.main_model : null;
  const envelopeProvider = state.review.main_model_provider ?? null;
  const auditModel = envelopeModel ?? "default";
  const auditProvider = envelopeProvider ?? "default";

  // Audit: main-agent subagent_call (parity with P1/P2/P4 so split is
  // traceable in the audit log).
  appendAudit(projectRoot, state.run_id, {
    event: "subagent_call",
    payload: {
      phase: 3,
      agent: `split-agent-${state.phases[3].attempt}`,
      model: auditModel,
      provider: auditProvider,
      input_hash: sha256(task),
    },
  });

  const result = await spawnSplitPlanner(projectRoot, task, modelArg);

  // Write raw log
  const rawLogFileName = buildRunScopedRawLogFileName(state.run_id, `3-${state.phases[3].attempt}-split.jsonl`);
  const rawLogRelPath = `logs/raw/${rawLogFileName}`;
  const rawLogPath = join(projectRoot, RAW_LOGS_DIR, rawLogFileName);
  const rawLogDir = dirname(rawLogPath);
  if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
  writeFileSync(rawLogPath, result.rawOutput);
  const rawLogHash = sha256(result.rawOutput);

  const terminalResult = result.terminalResult;

  // Audit: main-agent subagent_result. `parsed_ok` here reflects terminal
  // health only; strong-schema validation happens below and is treated as
  // a separate validation error (not a subagent failure).
  appendAudit(projectRoot, state.run_id, {
    event: "subagent_result",
    payload: {
      phase: 3,
      agent: `split-agent-${state.phases[3].attempt}`,
      raw_log_hash: rawLogHash,
      raw_log_path: rawLogRelPath,
      stop_reason: terminalResult.stopReason,
      error_message: terminalResult.errorMessage,
      parsed_ok: !terminalResult.terminalError,
    },
  });

  if (terminalResult.terminalError) {
    throw new Error([
      `Split generation failed`,
      terminalResult.provider ? `provider=${terminalResult.provider}` : null,
      terminalResult.model ? `model=${terminalResult.model}` : null,
      terminalResult.errorMessage ?? terminalResult.terminalError,
    ].filter(Boolean).join(" | "));
  }

  // Parse YAML from output (prefer terminal-parser's extracted text for parity
  // with P1/P2; fall back to the legacy direct output for older subagent logs).
  const sourceOutput = terminalResult.outputText;
  let yamlContent = sourceOutput;
  const fenceMatch = sourceOutput.match(/```(?:yaml)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) yamlContent = fenceMatch[1];

  let parsed: unknown;
  try {
    parsed = yamlParse(yamlContent);
  } catch {
    throw new Error("Failed to parse impl-plan YAML from agent output");
  }

  // Validate strong schema (C14)
  const validation = validateImplPlan(parsed);
  if (!validation.valid) {
    throw new Error(`impl-plan validation failed: ${validation.reason}`);
  }

  // Write impl-plan artifact
  const body = yamlContent;
  const envelope = writeArtifact(projectRoot, "impl-plan", body, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 3,
    attempt: state.phases[3].attempt,
    artifact_kind: "impl-plan",
    producer_kind: "main_agent",
    producer_id: `split-agent-${state.phases[3].attempt}`,
    provider: envelopeProvider,
    model: envelopeModel,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: state.phases[2].artifact_envelope.output_hash,
    input_hash: sha256(task),
    raw_log_hash: rawLogHash,
    raw_log_path: rawLogRelPath,
  });

  state.phases[3].artifact_envelope = {
    path: "impl-plan",
    output_hash: envelope.output_hash,
    producer_kind: "main_agent",
    producer_id: `split-agent-${state.phases[3].attempt}`,
    provider: envelopeProvider,
    model: envelopeModel,
  };

  ctx.ui.notify(
    `Phase 3: Split complete — ${validation.steps.length} implementation steps defined.`,
    "info",
  );
}
