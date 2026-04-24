import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteSync } from "../atomic-write.js";
import { buildSliceFileName, resolveMilestoneFile, resolveSliceFile, resolveSlicePath } from "../paths.js";
import { parseRoadmap } from "../parsers-legacy.js";
import {
  spawnGsdSubagentHandle,
  type SpawnGsdSubagentHandle,
  type SpawnGsdSubagentOptions,
  type SpawnGsdSubagentResult,
} from "../shared-harness/index.js";
import { parseUnitId } from "../unit-id.js";
import type { PreDispatchHookConfig, PreDispatchResult, PreDispatchFanOutScoutFocus, PreDispatchFanOutSpec } from "../types.js";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "./preset.js";

const SCOUT_GUARD_PROMPT = [
  "You are a runtime-owned phase-discipline scout subagent.",
  "Ignore generic startup instructions that tell you to discover, read, or invoke skills before doing the task.",
  "Do not inspect .agents, ~/.agents, or any user-global agent or skill directories unless the task explicitly names those paths.",
  "Do not perform general skill discovery.",
  "Focus on repository files under the current working directory and directly relevant runtime artifacts only.",
].join("\n");

const SCOUT_TASKS: Array<{ focus: PreDispatchFanOutScoutFocus; heading: string; task: string }> = [
  {
    focus: "codebase_scan",
    heading: "Codebase Scan",
    task: "Scan the codebase structure, identify key modules, entry points, and architectural patterns. Sample representative repo-local evidence only: inspect at most 6 paths total. Prefer root-level manifests, top-level packages, and concrete entrypoints. Prefer code and runtime entrypoints over docs, tests, and prompt sources. Report only the highest-signal file tree slices, main dependencies, and technology stack. Do not audit the scout guard or subagent prompt plumbing.",
  },
  {
    focus: "constraints_risks",
    heading: "Constraints & Risks",
    task: "Identify constraints, risks, and potential blockers for the requirement. Sample representative evidence only: inspect at most 1 package manifest, 1 tsconfig/eslint config, up to 2 CI workflow files, and up to 4 representative tests. Do not exhaustively enumerate the entire test suite. Summarize the highest-signal constraints, likely blockers, and validation expectations in concise bullets.",
  },
  {
    focus: "prior_art",
    heading: "Prior Art",
    task: "Search for existing code patterns, similar implementations, or prior art in the repository that relates to the requirement. Sample at most 6 targeted matches or files. Prefer repository-local implementations and reusable components. Prefer code and executable configuration over docs, changelogs, and prompt text. Do not inspect user-global agent or skill directories.",
  },
];

export interface EvaluatePhaseDisciplineScoutFanOutInput {
  unitType: string;
  unitId: string;
  prompt: string;
  basePath: string;
  hook?: Pick<PreDispatchHookConfig, "model" | "provider">;
}

export interface RunPhaseDisciplineScoutFanOutInput {
  basePath: string;
  unitType: string;
  unitId: string;
  fanOutSpec: PreDispatchFanOutSpec;
  spawnImpl?: (input: SpawnGsdSubagentOptions & { focus: PreDispatchFanOutScoutFocus }) => SpawnGsdSubagentHandle;
}

export interface PhaseDisciplineScoutFanOutResult {
  researchArtifactPath: string;
  scoutCount: number;
  rawLogDir: string;
}

function normalizeModelArg(model?: string, provider?: string): string | null {
  if (!model?.trim()) return null;
  const trimmed = model.trim();
  return trimmed.includes("/") ? trimmed : provider?.trim() ? `${provider.trim()}/${trimmed}` : trimmed;
}

function sanitizeForFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolveSliceTitle(basePath: string, milestoneId: string, sliceId: string): string {
  const roadmapPath = resolveMilestoneFile(basePath, milestoneId, "ROADMAP");
  if (!roadmapPath) return sliceId;
  try {
    const parsed = parseRoadmap(readFileSync(roadmapPath, "utf8"));
    return parsed.slices.find((slice) => slice.id === sliceId)?.title ?? sliceId;
  } catch {
    return sliceId;
  }
}

function resolveResearchArtifactPath(basePath: string, milestoneId: string, sliceId: string): string {
  const existing = resolveSliceFile(basePath, milestoneId, sliceId, "RESEARCH");
  if (existing) return existing;
  const slicePath = resolveSlicePath(basePath, milestoneId, sliceId);
  if (!slicePath) {
    throw new Error(`Slice path not found for ${milestoneId}/${sliceId}`);
  }
  return join(slicePath, buildSliceFileName(sliceId, "RESEARCH"));
}

function resolveLogDir(basePath: string, milestoneId: string, sliceId: string): string {
  const slicePath = resolveSlicePath(basePath, milestoneId, sliceId);
  if (!slicePath) {
    throw new Error(`Slice path not found for ${milestoneId}/${sliceId}`);
  }
  return join(slicePath, ".phase-discipline");
}

function renderScoutTask(input: {
  focus: PreDispatchFanOutScoutFocus;
  heading: string;
  milestoneId: string;
  sliceId: string;
  sliceTitle: string;
}): string {
  const scout = SCOUT_TASKS.find((entry) => entry.focus === input.focus);
  return [
    `${input.heading}: ${scout?.task ?? ""}`,
    "",
    `Milestone: ${input.milestoneId}`,
    `Slice: ${input.sliceId} — ${input.sliceTitle}`,
  ].join("\n");
}

function writeScoutRawLogs(input: {
  logDir: string;
  unitId: string;
  focus: PreDispatchFanOutScoutFocus;
  result: SpawnGsdSubagentResult;
}): void {
  const stem = `${PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut}-${sanitizeForFileName(input.unitId)}-scout-${input.focus}`;
  mkdirSync(input.logDir, { recursive: true });
  if (input.result.rawOutput) {
    writeFileSync(join(input.logDir, `${stem}-stdout.log`), input.result.rawOutput, "utf8");
  }
  if (input.result.stderrOutput) {
    writeFileSync(join(input.logDir, `${stem}-stderr.log`), input.result.stderrOutput, "utf8");
  }
}

function writeObservabilityLog(input: {
  logDir: string;
  unitType: string;
  unitId: string;
  researchArtifactPath: string;
  startedAt: string;
  completedAt: string;
  scouts: Array<{ focus: PreDispatchFanOutScoutFocus; status: "succeeded" | "failed"; error?: string }>;
}): void {
  mkdirSync(input.logDir, { recursive: true });
  const logPath = join(
    input.logDir,
    `${PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut}-${sanitizeForFileName(input.unitId)}.json`,
  );
  atomicWriteSync(logPath, JSON.stringify({
    hookName: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut,
    unitType: input.unitType,
    unitId: input.unitId,
    researchArtifactPath: input.researchArtifactPath,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    wallClockMs: new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime(),
    scouts: input.scouts,
  }, null, 2));
}

function renderResearchArtifact(input: {
  milestoneId: string;
  sliceId: string;
  sliceTitle: string;
  results: Array<{ focus: PreDispatchFanOutScoutFocus; output: string }>;
}): string {
  const lines: string[] = [
    "# Slice Research",
    "",
    `- Milestone: ${input.milestoneId}`,
    `- Slice: ${input.sliceId}`,
    `- Title: ${input.sliceTitle}`,
  ];

  for (const result of input.results) {
    const heading = SCOUT_TASKS.find((entry) => entry.focus === result.focus)?.heading ?? result.focus;
    lines.push("", `## ${heading}`, "", result.output.trim() || "(empty)");
  }

  return lines.join("\n") + "\n";
}

export function evaluatePhaseDisciplineScoutFanOut(
  input: EvaluatePhaseDisciplineScoutFanOutInput,
): PreDispatchResult {
  if (input.unitType !== "research-slice") {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  const { milestone, slice } = parseUnitId(input.unitId);
  if (!milestone || !slice || !/^S\d+$/i.test(slice)) {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  if (!resolveSlicePath(input.basePath, milestone, slice)) {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  if (resolveSliceFile(input.basePath, milestone, slice, "RESEARCH")) {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  return {
    action: "proceed",
    prompt: input.prompt,
    model: input.hook?.model,
    fanOutSpec: {
      builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut,
      unitType: input.unitType,
      unitId: input.unitId,
      model: input.hook?.model,
      provider: input.hook?.provider,
      scouts: SCOUT_TASKS.map((entry) => ({ focus: entry.focus, task: `${entry.heading}: ${entry.task}` })),
    },
    firedHooks: [],
  };
}

export async function runPhaseDisciplineScoutFanOut(
  input: RunPhaseDisciplineScoutFanOutInput,
): Promise<PhaseDisciplineScoutFanOutResult> {
  const { milestone, slice } = parseUnitId(input.unitId);
  if (!milestone || !slice) {
    throw new Error(`Invalid scout fan-out unit id: ${input.unitId}`);
  }

  const sliceTitle = resolveSliceTitle(input.basePath, milestone, slice);
  const researchArtifactPath = resolveResearchArtifactPath(input.basePath, milestone, slice);
  const logDir = resolveLogDir(input.basePath, milestone, slice);
  const modelArg = normalizeModelArg(input.fanOutSpec.model, input.fanOutSpec.provider);
  const spawnImpl = input.spawnImpl ?? ((spawnInput) => spawnGsdSubagentHandle(spawnInput));
  const startedAt = new Date().toISOString();

  const handles = input.fanOutSpec.scouts.map((scout) => ({
    scout,
    handle: spawnImpl({
      projectRoot: input.basePath,
      focus: scout.focus,
      modelArg,
      extraArgs: [
        "--append-system-prompt",
        SCOUT_GUARD_PROMPT,
        "--tools",
        "read,grep,find,ls,bash",
      ],
      task: renderScoutTask({
        focus: scout.focus,
        heading: SCOUT_TASKS.find((entry) => entry.focus === scout.focus)?.heading ?? scout.focus,
        milestoneId: milestone,
        sliceId: slice,
        sliceTitle,
      }),
    }),
  }));

  let cancelled = false;
  const cancelOthers = (failedFocus: PreDispatchFanOutScoutFocus) => {
    if (cancelled) return;
    cancelled = true;
    for (const entry of handles) {
      if (entry.scout.focus === failedFocus) continue;
      entry.handle.cancel();
    }
  };

  const settled = await Promise.allSettled(handles.map(async ({ scout, handle }) => {
    const result = await handle.promise;
    writeScoutRawLogs({ logDir, unitId: input.unitId, focus: scout.focus, result });
    const terminalError = result.terminalResult.terminalError?.trim();
    if (terminalError) {
      cancelOthers(scout.focus);
      const provider = result.terminalResult.provider ? ` | provider=${result.terminalResult.provider}` : "";
      const model = result.terminalResult.model ? ` | model=${result.terminalResult.model}` : "";
      throw new Error(`Scout ${scout.focus} failed${provider}${model} | ${terminalError}`);
    }
    return {
      focus: scout.focus,
      output: result.terminalResult.outputText || result.rawOutput,
    };
  }));

  const completedAt = new Date().toISOString();
  const successes: Array<{ focus: PreDispatchFanOutScoutFocus; output: string }> = [];
  const failures: Array<{ focus: PreDispatchFanOutScoutFocus; error: string }> = [];

  settled.forEach((entry, index) => {
    const focus = handles[index]!.scout.focus;
    if (entry.status === "fulfilled") {
      successes.push(entry.value);
      return;
    }
    const message = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
    failures.push({ focus, error: message });
  });

  writeObservabilityLog({
    logDir,
    unitType: input.unitType,
    unitId: input.unitId,
    researchArtifactPath,
    startedAt,
    completedAt,
    scouts: handles.map(({ scout }) => {
      const failed = failures.find((entry) => entry.focus === scout.focus);
      return failed
        ? { focus: scout.focus, status: "failed" as const, error: failed.error }
        : { focus: scout.focus, status: "succeeded" as const };
    }),
  });

  if (failures.length > 0) {
    throw new Error(failures[0]!.error);
  }

  mkdirSync(resolveSlicePath(input.basePath, milestone, slice)!, { recursive: true });
  atomicWriteSync(researchArtifactPath, renderResearchArtifact({
    milestoneId: milestone,
    sliceId: slice,
    sliceTitle,
    results: successes,
  }));

  return {
    researchArtifactPath,
    scoutCount: successes.length,
    rawLogDir: logDir,
  };
}
