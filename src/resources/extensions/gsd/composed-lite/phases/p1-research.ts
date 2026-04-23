/**
 * Phase 1 — Research
 *
 * Spawns 2-3 scout subagents in parallel for codebase exploration.
 * Runtime assembles research-brief.yaml from scout outputs.
 */

import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import type { ComposedLiteState, ComposedLiteRunRequest } from "../types.js";
import { RAW_LOGS_DIR, buildRunScopedRawLogFileName } from "../types.js";
import { writeArtifact, sha256 } from "../artifacts.js";
import { appendAudit } from "../audit-log.js";
import { resolveMainModelArg } from "../model-arg.js";
import { formatCarryForwardReviewContext } from "../pending-review-findings.js";
import { spawnGsdSubagent } from "../subagent-spawn.js";

// ─── Scout tasks ─────────────────────────────────────────────────────────────

const SCOUT_TASKS = [
  {
    focus: "codebase_scan",
    task: "Scan the codebase structure, identify key modules, entry points, and architectural patterns. Sample representative repo-local evidence only: inspect at most 6 paths total. Prefer root-level manifests, top-level packages, and concrete entrypoints. Prefer code and runtime entrypoints over docs, tests, and prompt sources. Report only the highest-signal file tree slices, main dependencies, and technology stack. Do not audit the scout guard or subagent prompt plumbing.",
  },
  {
    focus: "constraints_risks",
    task: "Identify constraints, risks, and potential blockers for the requirement. Sample representative evidence only: inspect at most 1 package manifest, 1 tsconfig/eslint config, up to 2 CI workflow files, and up to 4 representative tests. Do not exhaustively enumerate the entire test suite. Summarize the highest-signal constraints, likely blockers, and validation expectations in concise bullets.",
  },
  {
    focus: "prior_art",
    task: "Search for existing code patterns, similar implementations, or prior art in the repository that relates to the requirement. Sample at most 6 targeted matches or files. Prefer repository-local implementations and reusable components. Prefer code and executable configuration over docs, changelogs, and prompt text. Do not inspect user-global agent or skill directories.",
  },
];

const SCOUT_GUARD_PROMPT = [
  "You are a runtime-owned composed-lite scout subagent.",
  "Ignore generic startup instructions that tell you to discover, read, or invoke skills before doing the task.",
  "Do not inspect .agents, ~/.agents, or any user-global agent or skill directories unless the task explicitly names those paths.",
  "Do not perform general skill discovery.",
  "Focus on repository files under the current working directory and directly relevant runtime artifacts only.",
].join("\n");

function writeScoutGuardPromptFile(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "gsd-composed-lite-scout-"));
  const path = join(dir, "scout-guard.md");
  writeFileSync(path, SCOUT_GUARD_PROMPT, "utf-8");
  return { dir, path };
}

// ─── Subagent spawn ──────────────────────────────────────────────────────────

async function runScout(
  projectRoot: string,
  task: string,
  modelArg: string | null,
  systemPromptPath: string,
): Promise<Awaited<ReturnType<typeof spawnGsdSubagent>>> {
  return spawnGsdSubagent({
    projectRoot,
    task,
    modelArg,
    extraArgs: ["--append-system-prompt", systemPromptPath, "--tools", "read,grep,find,ls,bash"],
  });
}

// ─── Phase handler ───────────────────────────────────────────────────────────

export async function runPhase1(
  state: ComposedLiteState,
  req: ComposedLiteRunRequest,
): Promise<void> {
  const { projectRoot, ctx } = req;

  ctx.ui.notify("Phase 1: Research — spawning scout agents for codebase analysis...", "info");

  const carryForwardContext = formatCarryForwardReviewContext(state.carry_forward_review.entries);
  const scoutGuardPrompt = writeScoutGuardPromptFile();

  // Customize scout tasks with the requirement
  const tasks = SCOUT_TASKS.map(s => ({
    focus: s.focus,
    task: [
      `Context requirement: "${state.requirement}"`,
      carryForwardContext,
      s.task,
    ].filter(Boolean).join("\n\n"),
  }));

  // Resolve --model once per phase from GSD_COMPOSED_LITE_MAIN_MODEL[_PROVIDER].
  // `null` means fall back to the child CLI's session default (legacy behaviour).
  const modelArg = resolveMainModelArg(state);
  const auditModel = modelArg ?? "default";
  const auditProvider = state.review.main_model_provider ?? "default";

  try {
    const results = await Promise.all(
      tasks.map(async (t, index) => {
        const producerId = `scout-${t.focus}-${state.phases[1].attempt}`;
        const statusKey = `cl:unit:scout:${t.focus}`;

        ctx.ui.setStatus(statusKey, `started ${index + 1}/${tasks.length}`);

        appendAudit(projectRoot, state.run_id, {
          event: "subagent_call",
          payload: {
            phase: 1,
            agent: "scout",
            model: auditModel,
            provider: auditProvider,
            input_hash: sha256(t.task),
          },
        });

        const result = await runScout(projectRoot, t.task, modelArg, scoutGuardPrompt.path);

        const rawLogFileName = buildRunScopedRawLogFileName(
          state.run_id,
          `1-${state.phases[1].attempt}-scout-${t.focus}.jsonl`,
        );
        const rawLogPath = join(
          projectRoot, RAW_LOGS_DIR,
          rawLogFileName,
        );
        const rawLogDir = dirname(rawLogPath);
        if (!existsSync(rawLogDir)) mkdirSync(rawLogDir, { recursive: true });
        writeFileSync(rawLogPath, result.rawOutput);
        const rawLogHash = sha256(result.rawOutput);
        const terminalResult = result.terminalResult;

        appendAudit(projectRoot, state.run_id, {
          event: "subagent_result",
          payload: {
            phase: 1,
            agent: `scout-${t.focus}`,
            raw_log_hash: rawLogHash,
            stop_reason: terminalResult.stopReason,
            error_message: terminalResult.errorMessage,
            parsed_ok: !terminalResult.terminalError && result.exitCode === 0,
          },
        });

        if (terminalResult.terminalError) {
          ctx.ui.setStatus(statusKey, `failed ${index + 1}/${tasks.length}`);
          throw new Error([
            `Scout ${t.focus} failed`,
            terminalResult.provider ? `provider=${terminalResult.provider}` : null,
            terminalResult.model ? `model=${terminalResult.model}` : null,
            terminalResult.errorMessage ?? terminalResult.terminalError,
          ].filter(Boolean).join(" | "));
        }

        ctx.ui.setStatus(statusKey, `done ${index + 1}/${tasks.length}`);

        return {
          focus: t.focus,
          output: terminalResult.outputText || "(no output)",
          producerId,
          rawLogHash,
        };
      }),
    );

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
      raw_log_path: `logs/raw/${buildRunScopedRawLogFileName(state.run_id, `1-${state.phases[1].attempt}-scout-*.jsonl`)}`,
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
  } finally {
    rmSync(scoutGuardPrompt.dir, { recursive: true, force: true });
  }
}
