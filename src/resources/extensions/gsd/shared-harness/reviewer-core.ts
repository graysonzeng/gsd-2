import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parse as yamlParse } from "yaml";

import { spawnGsdSubagent } from "./subagent-spawn.js";
import type { SpawnGsdSubagentResult } from "./subagent-spawn.js";
import type { SubagentTerminalResult } from "./subagent-terminal.js";

export interface ReviewResult {
  overall_assessment: "pass" | "issues" | "fail";
  critical: Array<{ id: string; target: string; rationale: string }>;
  important: Array<{ id: string; target: string; rationale: string }>;
  minor: Array<{ id: string; target: string; rationale: string }>;
  rationale: string;
}

export interface RunReviewInput {
  projectRoot: string;
  modelArg: string;
  systemPrompt: string;
  reviewPrompt: string;
  targetContent: string;
  maxRetries?: number;
  spawn?: (options: {
    projectRoot: string;
    task: string;
    modelArg?: string | null;
    extraArgs?: string[];
  }) => Promise<SpawnGsdSubagentResult>;
}

export interface ReviewAttempt {
  attempt: number;
  rawOutput: string;
  stderrOutput: string;
  exitCode: number;
  terminalResult: SubagentTerminalResult;
  parsed: ReviewResult | null;
}

export interface RunReviewResult {
  review: ReviewResult;
  inputHash: string;
  task: string;
  attempts: ReviewAttempt[];
}

export class ReviewerCoreError extends Error {
  kind: "subprocess_failure" | "parse_exhausted";
  attempts: ReviewAttempt[];

  constructor(
    kind: "subprocess_failure" | "parse_exhausted",
    message: string,
    attempts: ReviewAttempt[],
  ) {
    super(message);
    this.name = "ReviewerCoreError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function writePromptToTempFile(name: string, prompt: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "shared-reviewer-"));
  const filePath = join(dir, `prompt-${name}.md`);
  writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir, filePath };
}

function coerceFindingItem(raw: unknown): { id: string; target: string; rationale: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as { id?: unknown; target?: unknown; rationale?: unknown };
  if (typeof item.id !== "string" || typeof item.target !== "string" || typeof item.rationale !== "string") {
    return null;
  }
  return {
    id: item.id,
    target: item.target,
    rationale: item.rationale,
  };
}

function coerceFindingList(raw: unknown): Array<{ id: string; target: string; rationale: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const coerced = coerceFindingItem(item);
    return coerced ? [coerced] : [];
  });
}

export function parseReviewerOutput(raw: string): ReviewResult | null {
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
      critical: coerceFindingList(parsed.critical),
      important: coerceFindingList(parsed.important),
      minor: coerceFindingList(parsed.minor),
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return null;
  }
}

export async function runReview(input: RunReviewInput): Promise<RunReviewResult> {
  const maxRetries = Math.max(1, input.maxRetries ?? 2);
  const spawn = input.spawn ?? spawnGsdSubagent;
  const task = [
    input.reviewPrompt,
    "",
    "--- TARGET CONTENT ---",
    input.targetContent,
    "--- END TARGET CONTENT ---",
  ].join("\n");
  const inputHash = sha256(task);
  const attempts: ReviewAttempt[] = [];
  const tmp = writePromptToTempFile("reviewer", input.systemPrompt);

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const spawnResult = await spawn({
        projectRoot: input.projectRoot,
        task,
        modelArg: input.modelArg,
        extraArgs: ["--append-system-prompt", tmp.filePath, "--tools", "read"],
      });
      const parsed = spawnResult.terminalResult.terminalError
        ? null
        : parseReviewerOutput(spawnResult.terminalResult.outputText);
      const reviewAttempt: ReviewAttempt = {
        attempt,
        rawOutput: spawnResult.rawOutput,
        stderrOutput: spawnResult.stderrOutput,
        exitCode: spawnResult.exitCode,
        terminalResult: spawnResult.terminalResult,
        parsed,
      };
      attempts.push(reviewAttempt);

      if (spawnResult.terminalResult.terminalError) {
        throw new ReviewerCoreError(
          "subprocess_failure",
          spawnResult.terminalResult.errorMessage ?? spawnResult.terminalResult.terminalError,
          attempts,
        );
      }

      if (parsed) {
        return {
          review: parsed,
          inputHash,
          task,
          attempts,
        };
      }
    }
  } finally {
    try {
      unlinkSync(tmp.filePath);
    } catch {
    }
    try {
      rmSync(tmp.dir, { recursive: true, force: true });
    } catch {
    }
  }

  throw new ReviewerCoreError(
    "parse_exhausted",
    "Failed to parse reviewer output after retries",
    attempts,
  );
}
