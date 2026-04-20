/**
 * Phase 4 — Implementation
 *
 * Executes impl-plan steps sequentially via worker subagent.
 * Contract C5: git diff is truth source (empty diff → fuse).
 */

import { spawn, execSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { parse as yamlParse } from "yaml";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { saveState } from "../state.js";
import { runReview } from "../review-harness.js";
import { ComposedLiteFuseError } from "../types.js";
import { resolveGsdBin } from "../resolve-bin.js";

const MAX_REVISION_ROUNDS = 2;

async function spawnWorker(
  projectRoot: string,
  task: string,
): Promise<{ output: string; rawOutput: string }> {
  const args: string[] = [
    "--mode", "json", "-p", "--no-session",
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
    proc.on("error", () => resolve({ output: "", rawOutput: "" }));
  });
}

function getGitDiffStats(projectRoot: string, baselineSha: string): { files: string[]; insertions: number; deletions: number } {
  try {
    const numstat = execSync(
      `git diff --numstat ${baselineSha}..HEAD`,
      { cwd: projectRoot, encoding: "utf-8" },
    ).trim();

    if (!numstat) return { files: [], insertions: 0, deletions: 0 };

    let insertions = 0;
    let deletions = 0;
    const files: string[] = [];

    for (const line of numstat.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const ins = parseInt(parts[0], 10) || 0;
        const del = parseInt(parts[1], 10) || 0;
        insertions += ins;
        deletions += del;
        files.push(parts[2]);
      }
    }

    return { files, insertions, deletions };
  } catch {
    return { files: [], insertions: 0, deletions: 0 };
  }
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
  saveState(projectRoot, state);

  ctx.ui.notify("Phase 4: Implementation — executing implementation steps...", "info");

  // Read impl-plan
  const implPlan = readArtifact(projectRoot, "impl-plan");
  if (!implPlan) throw new Error("impl-plan artifact not found");

  let parsed: unknown;
  try {
    parsed = yamlParse(implPlan.body);
  } catch {
    throw new Error("Failed to parse impl-plan YAML");
  }

  const obj = parsed as Record<string, unknown>;
  const steps = (obj.steps || []) as Array<Record<string, unknown>>;

  // Carry forward last verify failure if any
  const lastFailure = state.last_verify_failure;
  const failureContext = lastFailure
    ? `\n\nIMPORTANT: Previous verification failed with: ${lastFailure}\nMake sure to fix this issue in your implementation.`
    : "";

  // Execute steps sequentially
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const title = step.title as string;
    const files = Array.isArray(step.files) ? step.files : [];

    ctx.ui.notify(`  Step ${i + 1}/${steps.length}: ${title}`, "info");

    const task = `Implement the following step:\n\nTitle: ${title}\nFiles to modify: ${files.join(", ")}\n\nContext requirement: ${state.requirement}${failureContext}\n\nMake the necessary code changes. Do not just describe what to do — actually edit the files.`;

    appendAudit(projectRoot, state.run_id, {
      event: "subagent_call",
      payload: {
        phase: 4,
        agent: "worker",
        model: "default",
        provider: "default",
        input_hash: sha256(task),
      },
    });

    const result = await spawnWorker(projectRoot, task);

    // Write raw log
    const rawLogPath = join(projectRoot, RAW_LOGS_DIR, `4-${state.phases[4].attempt}-worker-step${i}.jsonl`);
    const rawLogDir = dirname(rawLogPath);
    if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
    writeFileSync(rawLogPath, result.rawOutput);

    appendAudit(projectRoot, state.run_id, {
      event: "subagent_result",
      payload: {
        phase: 4,
        agent: `worker-step-${i}`,
        raw_log_hash: sha256(result.rawOutput),
        parsed_ok: true,
      },
    });
  }

  // ── C5: Git diff truth source ───────────────────────────────────────────
  if (state.git.baseline_sha && state.git.baseline_sha !== "unknown") {
    const diff = getGitDiffStats(projectRoot, state.git.baseline_sha);

    if (diff.files.length === 0) {
      throw new ComposedLiteFuseError(
        "implementation_empty_diff",
        "No file changes detected after implementation (git diff is empty)",
      );
    }

    // Build implementation summary
    const summaryBody = [
      `# Implementation Summary`,
      ``,
      `Steps completed: ${steps.length}`,
      `Files changed: ${diff.files.length}`,
      `Insertions: +${diff.insertions}`,
      `Deletions: -${diff.deletions}`,
      ``,
      `## Changed files`,
      ...diff.files.map(f => `- ${f}`),
    ].join("\n");

    const summaryEnvelope = writeArtifact(projectRoot, "implementation-summary", summaryBody, {
      schema_version: 1,
      run_id: state.run_id,
      phase: 4,
      attempt: state.phases[4].attempt,
      artifact_kind: "implementation-summary",
      producer_kind: "runtime",
      producer_id: "runtime",
      provider: null,
      model: null,
      admission_hash: state.admission.admission_hash || "",
      prev_phase_output_hash: state.phases[3].artifact_envelope.output_hash,
      input_hash: sha256(steps.map(s => (s as Record<string, unknown>).title).join(",")),
      raw_log_hash: sha256(""),
      raw_log_path: "",
    });

    state.phases[4].artifact_envelope = {
      path: "implementation-summary",
      output_hash: summaryEnvelope.output_hash,
      producer_kind: "runtime",
      producer_id: "runtime",
      provider: null,
      model: null,
    };
  }

  // ── Code review ─────────────────────────────────────────────────────────
  ctx.ui.notify("Phase 4: Running independent code review...", "info");

  const summaryArt = readArtifact(projectRoot, "implementation-summary");
  const summaryContent = summaryArt ? summaryArt.body : "(no summary)";

  for (let round = 0; round <= MAX_REVISION_ROUNDS; round++) {
    state.phases[4].revision_round = round;

    const reviewResult = await runReview({
      state,
      req,
      phase: 4,
      artifactKind: "code-review",
      reviewPrompt: "Review this implementation for correctness, security, and contract adherence.",
      targetContent: summaryContent,
    });

    if (reviewResult.overall_assessment === "pass") {
      ctx.ui.notify("Phase 4: Code review passed.", "info");
      return;
    }

    if (round >= MAX_REVISION_ROUNDS) {
      throw new ComposedLiteFuseError(
        "code_review_exhausted",
        `Code review did not pass after ${MAX_REVISION_ROUNDS + 1} rounds`,
      );
    }

    ctx.ui.notify(`Phase 4: Code review — ${reviewResult.overall_assessment}. Revising...`, "info");
    // TODO: Re-run implementation with review feedback
  }
}
