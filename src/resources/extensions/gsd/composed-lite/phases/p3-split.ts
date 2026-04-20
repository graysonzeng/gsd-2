/**
 * Phase 3 — Split
 *
 * Splits the design into ≤8 ordered implementation steps.
 * Contract C14: impl-plan.acceptance must be strong schema.
 */

import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { parse as yamlParse } from "yaml";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { resolveGsdBin } from "../resolve-bin.js";

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

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase3(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 3: Split — breaking design into implementation steps...", "info");

  const designDoc = readArtifact(projectRoot, "design-doc");
  const designContent = designDoc ? designDoc.body : "(no design)";

  const task = `Based on this design document, create an implementation plan with ordered steps.

Design:
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

  const args: string[] = [
    "--mode", "json", "-p", "--no-session",
    `Task: ${task}`,
  ];

  const bundledPaths = (process.env.GSD_BUNDLED_EXTENSION_PATHS ?? "")
    .split(delimiter).map(s => s.trim()).filter(Boolean);
  const extensionArgs = bundledPaths.flatMap(p => ["--extension", p]);

  const result = await new Promise<{ output: string; rawOutput: string }>((resolve) => {
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

    proc.on("error", () => resolve({ output: "", rawOutput: "" }));
  });

  // Write raw log
  const rawLogPath = join(projectRoot, RAW_LOGS_DIR, `3-${state.phases[3].attempt}-split.jsonl`);
  const rawLogDir = dirname(rawLogPath);
  if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
  writeFileSync(rawLogPath, result.rawOutput);

  // Parse YAML from output
  let yamlContent = result.output;
  const fenceMatch = result.output.match(/```(?:yaml)?\s*\n([\s\S]*?)```/);
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
    provider: null,
    model: null,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: state.phases[2].artifact_envelope.output_hash,
    input_hash: sha256(task),
    raw_log_hash: sha256(result.rawOutput),
    raw_log_path: `logs/raw/3-${state.phases[3].attempt}-split.jsonl`,
  });

  state.phases[3].artifact_envelope = {
    path: "impl-plan",
    output_hash: envelope.output_hash,
    producer_kind: "main_agent",
    producer_id: `split-agent-${state.phases[3].attempt}`,
    provider: null,
    model: null,
  };

  ctx.ui.notify(
    `Phase 3: Split complete — ${validation.steps.length} implementation steps defined.`,
    "info",
  );
}
