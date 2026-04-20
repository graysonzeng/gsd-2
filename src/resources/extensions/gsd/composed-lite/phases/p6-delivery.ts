/**
 * Phase 6 — Delivery
 *
 * Precise git commit using nativeAddPaths (not smartStage).
 * Contract C7: Only allowlisted files committed.
 */

import { execSync } from "node:child_process";
import { parse as yamlParse } from "yaml";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { writeArtifact, readArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { saveState } from "../state.js";

export async function runPhase6(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 6: Delivery — committing changes...", "info");

  // Get list of changed files from git
  let changedFiles: string[] = [];
  if (state.git.baseline_sha && state.git.baseline_sha !== "unknown") {
    try {
      const diffOutput = execSync(
        `git diff --name-only ${state.git.baseline_sha}..HEAD`,
        { cwd: projectRoot, encoding: "utf-8" },
      ).trim();
      changedFiles = diffOutput ? diffOutput.split("\n") : [];
    } catch { /* ignore */ }
  }

  // Also get unstaged/untracked changes
  try {
    const statusOutput = execSync(
      "git status --porcelain",
      { cwd: projectRoot, encoding: "utf-8" },
    ).trim();
    for (const line of statusOutput.split("\n")) {
      if (!line.trim()) continue;
      const file = line.slice(3).trim();
      if (file && !changedFiles.includes(file)) {
        changedFiles.push(file);
      }
    }
  } catch { /* ignore */ }

  // Build allowlist from impl-plan
  const implPlan = readArtifact(projectRoot, "impl-plan");
  let allowlist = new Set<string>();
  if (implPlan) {
    try {
      const parsed = yamlParse(implPlan.body) as Record<string, unknown>;
      const steps = (parsed.steps || []) as Array<Record<string, unknown>>;
      for (const step of steps) {
        const files = step.files;
        if (Array.isArray(files)) {
          for (const f of files) {
            allowlist.add(String(f));
          }
        }
      }
    } catch { /* ignore */ }
  }

  // If no allowlist from impl-plan, use all changed files (minus .gsd/)
  if (allowlist.size === 0) {
    allowlist = new Set(changedFiles);
  }

  // Filter: only commit files that are both changed AND in allowlist
  // Exclude .gsd/ files
  const filesToCommit = changedFiles.filter(f =>
    !f.startsWith(".gsd/") &&
    (allowlist.has(f) || allowlist.size === 0)
  );

  if (filesToCommit.length === 0) {
    ctx.ui.notify("Phase 6: No files to commit.", "warning");
    // Still write delivery report
    const body = `committed: false\nreason: no eligible files to commit\n`;
    writeArtifact(projectRoot, "delivery-report", body, {
      schema_version: 1,
      run_id: state.run_id,
      phase: 6,
      attempt: state.phases[6].attempt,
      artifact_kind: "delivery-report",
      producer_kind: "runtime",
      producer_id: "runtime",
      provider: null,
      model: null,
      admission_hash: state.admission.admission_hash || "",
      prev_phase_output_hash: state.phases[5].artifact_envelope.output_hash,
      input_hash: sha256(""),
      raw_log_hash: sha256(""),
      raw_log_path: "",
    });
    return;
  }

  // Stage files precisely
  try {
    execSync(
      `git add ${filesToCommit.map(f => `"${f}"`).join(" ")}`,
      { cwd: projectRoot, encoding: "utf-8" },
    );
  } catch (err) {
    throw new Error(`Failed to stage files: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Determine commit type
  const commitType = state.requirement.toLowerCase().includes("fix") ? "fix" : "feat";
  const summary = state.requirement.length > 60
    ? state.requirement.slice(0, 57) + "..."
    : state.requirement;
  const commitMessage = `${commitType}(composed-lite): ${summary}`;

  // Commit
  try {
    execSync(
      `git commit -m "${commitMessage.replace(/"/g, '\\"')}"`,
      { cwd: projectRoot, encoding: "utf-8" },
    );
  } catch (err) {
    throw new Error(`Failed to commit: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Get commit SHA
  let commitSha = "";
  try {
    commitSha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
  } catch { /* ignore */ }

  state.git.commit_created = true;
  state.git.commit_sha = commitSha;
  state.git.committed_files = filesToCommit;

  appendAudit(projectRoot, state.run_id, {
    event: "git_commit",
    payload: { sha: commitSha, committed_files: filesToCommit },
  });

  // Write delivery report
  const body = [
    `committed: true`,
    `commit_sha: "${commitSha}"`,
    `commit_message: "${commitMessage}"`,
    `files_committed: ${filesToCommit.length}`,
    `files:`,
    ...filesToCommit.map(f => `  - "${f}"`),
  ].join("\n");

  const envelope = writeArtifact(projectRoot, "delivery-report", body, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 6,
    attempt: state.phases[6].attempt,
    artifact_kind: "delivery-report",
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: state.phases[5].artifact_envelope.output_hash,
    input_hash: sha256(filesToCommit.join(",")),
    raw_log_hash: sha256(""),
    raw_log_path: "",
  });

  state.phases[6].artifact_envelope = {
    path: "delivery-report",
    output_hash: envelope.output_hash,
    producer_kind: "runtime",
    producer_id: "runtime",
    provider: null,
    model: null,
  };

  ctx.ui.notify(
    `Phase 6: Committed ${filesToCommit.length} files (${commitSha.slice(0, 8)}).\nNot pushed — run git push manually.`,
    "info",
  );
}
