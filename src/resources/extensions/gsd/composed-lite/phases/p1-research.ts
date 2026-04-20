/**
 * Phase 1 — Research
 *
 * Spawns 2-3 scout subagents in parallel for codebase exploration.
 * Runtime assembles research-brief.yaml from scout outputs.
 */

import { spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR } from "../types.js";
import { writeArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { resolveGsdBin } from "../resolve-bin.js";

// ─── Scout tasks ─────────────────────────────────────────────────────────────

const SCOUT_TASKS = [
  {
    focus: "codebase_scan",
    task: "Scan the codebase structure, identify key modules, entry points, and architectural patterns. Report file tree, main dependencies, and technology stack.",
  },
  {
    focus: "constraints_risks",
    task: "Identify constraints, risks, and potential blockers for the requirement. Look at existing tests, CI config, linting rules, and any known issues.",
  },
  {
    focus: "prior_art",
    task: "Search for existing code patterns, similar implementations, or prior art in the repository that relates to the requirement. Identify reusable components.",
  },
];

// ─── Subagent spawn ──────────────────────────────────────────────────────────

async function runScout(
  projectRoot: string,
  task: string,
  focus: string,
): Promise<{ output: string; rawOutput: string; exitCode: number }> {
  const args: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--tools", "read,grep,find,ls,bash",
    `Task: ${task}`,
  ];

  const bundledPaths = (process.env.GSD_BUNDLED_EXTENSION_PATHS ?? "")
    .split(delimiter)
    .map(s => s.trim())
    .filter(Boolean);
  const extensionArgs = bundledPaths.flatMap(p => ["--extension", p]);

  return new Promise((resolve) => {
    const gsdBin = resolveGsdBin();
    if (!gsdBin) {
      resolve({ output: "", rawOutput: "", exitCode: 1 });
      return;
    }
    const proc = spawn(
      process.execPath,
      [gsdBin, ...extensionArgs, ...args],
      { cwd: projectRoot, shell: false, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", () => { /* discard */ });

    proc.on("close", (code) => {
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
      resolve({ output, rawOutput: stdout, exitCode: code ?? 1 });
    });

    proc.on("error", () => {
      resolve({ output: "", rawOutput: "", exitCode: 1 });
    });
  });
}

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase1(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 1: Research — spawning scout agents for codebase analysis...", "info");

  // Customize scout tasks with the requirement
  const tasks = SCOUT_TASKS.map(s => ({
    focus: s.focus,
    task: `Context requirement: "${state.requirement}"\n\n${s.task}`,
  }));

  // Run scouts in parallel
  const results = await Promise.all(
    tasks.map(async (t) => {
      const producerId = `scout-${t.focus}-${state.phases[1].attempt}`;

      appendAudit(projectRoot, state.run_id, {
        event: "subagent_call",
        payload: {
          phase: 1,
          agent: "scout",
          model: "default",
          provider: "default",
          input_hash: sha256(t.task),
        },
      });

      const result = await runScout(projectRoot, t.task, t.focus);

      // Write raw log
      const rawLogPath = join(
        projectRoot, RAW_LOGS_DIR,
        `1-${state.phases[1].attempt}-scout-${t.focus}.jsonl`,
      );
      const rawLogDir = dirname(rawLogPath);
      if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
      writeFileSync(rawLogPath, result.rawOutput);
      const rawLogHash = sha256(result.rawOutput);

      appendAudit(projectRoot, state.run_id, {
        event: "subagent_result",
        payload: {
          phase: 1,
          agent: `scout-${t.focus}`,
          raw_log_hash: rawLogHash,
          parsed_ok: result.exitCode === 0,
        },
      });

      return {
        focus: t.focus,
        output: result.output || "(no output)",
        producerId,
        rawLogHash,
      };
    }),
  );

  // Assemble research brief
  const briefSections = results.map(r =>
    `## ${r.focus}\n\n${r.output}`
  ).join("\n\n---\n\n");

  const brief = [
    `# Research Brief`,
    ``,
    `Requirement: ${state.requirement}`,
    `Run: ${state.run_id}`,
    `Scouts: ${results.map(r => r.focus).join(", ")}`,
    ``,
    briefSections,
  ].join("\n");

  const derivedFrom = results.map(r => ({
    producer_id: r.producerId,
    raw_log_hash: r.rawLogHash,
  }));

  const body = `derived_from:\n${derivedFrom.map(d =>
    `  - producer_id: ${d.producer_id}\n    raw_log_hash: ${d.raw_log_hash}`
  ).join("\n")}\n\n${brief}`;

  const envelope = writeArtifact(projectRoot, "research-brief", body, {
    schema_version: 1,
    run_id: state.run_id,
    phase: 1,
    attempt: state.phases[1].attempt,
    artifact_kind: "research-brief",
    producer_kind: "main_agent",
    producer_id: "runtime-assembler",
    provider: null,
    model: null,
    admission_hash: state.admission.admission_hash || "",
    prev_phase_output_hash: state.phases[0].artifact_envelope.output_hash,
    input_hash: sha256(state.requirement),
    raw_log_hash: sha256(results.map(r => r.rawLogHash).join(",")),
    raw_log_path: `logs/raw/1-${state.phases[1].attempt}-scout-*.jsonl`,
  });

  state.phases[1].artifact_envelope = {
    path: "research-brief",
    output_hash: envelope.output_hash,
    producer_kind: "main_agent",
    producer_id: "runtime-assembler",
    provider: null,
    model: null,
  };

  ctx.ui.notify("Phase 1: Research complete.", "info");
}
