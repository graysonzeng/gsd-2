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

export type ParseErrorKind =
  | "empty_output"
  | "yaml_syntax_error"
  | "not_object"
  | "missing_assessment"
  | "invalid_assessment_value"
  | "invalid_finding_list"
  | "malformed_finding_item";

export interface ParseError {
  kind: ParseErrorKind;
  message: string;
  offendingValue?: string;
}

export interface ParseResult {
  parsed: ReviewResult | null;
  error: ParseError | null;
}

export interface RunReviewInput {
  projectRoot: string;
  modelArg: string;
  systemPrompt: string;
  reviewPrompt: string;
  targetContent: string;
  /** Fresh-spawn retries (default 2). Each fresh spawn also runs its own format repair loop. */
  maxRetries?: number;
  /** Format repair rounds inside each fresh spawn (default 1). Total attempts per fresh = 1 + maxCorrectionRounds. */
  maxCorrectionRounds?: number;
  /** Cancellation signal. Abort stops the outer loop and best-effort kills in-flight spawns. */
  signal?: AbortSignal;
  spawn?: (options: {
    projectRoot: string;
    task: string;
    modelArg?: string | null;
    extraArgs?: string[];
  }) => Promise<SpawnGsdSubagentResult>;
}

export interface ReviewAttempt {
  attempt: number;
  /** Zero-based fresh-spawn index this attempt belongs to. */
  freshSpawnIndex: number;
  /** Which phase of the per-fresh-spawn cycle this attempt is. */
  phase: "initial" | "repair";
  /**
   * Repair round within the current fresh spawn. 0 for `initial`, 1..N for the
   * subsequent repair rounds. Carried alongside `phase` so consumers can tell
   * "repair round 2 of fresh spawn 1" unambiguously.
   */
  correctionRound: number;
  rawOutput: string;
  stderrOutput: string;
  exitCode: number;
  terminalResult: SubagentTerminalResult;
  parsed: ReviewResult | null;
  parseError: ParseError | null;
}

export interface RunReviewResult {
  review: ReviewResult;
  inputHash: string;
  task: string;
  attempts: ReviewAttempt[];
  /** True when the accepted verdict came from a format-repair attempt rather than the initial spawn. */
  formatRepairSucceeded: boolean;
  /** Total number of repair rounds actually executed across all fresh spawns. */
  correctionRounds: number;
}

export class ReviewerCoreError extends Error {
  kind: "subprocess_failure" | "parse_exhausted" | "aborted";
  attempts: ReviewAttempt[];

  constructor(
    kind: "subprocess_failure" | "parse_exhausted" | "aborted",
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

/**
 * Coerce a finding list with strict validation. Returns the list on success or
 * a `ParseError` describing why validation failed.
 *
 * Behavior change from prior revisions: malformed items are no longer silently
 * dropped. A single invalid item surfaces as `malformed_finding_item` so the
 * reviewer-core repair loop can feed the diagnostic back to the model. Silently
 * dropping findings would weaken the review gate without the loop noticing.
 */
function coerceFindingListStrict(
  field: "critical" | "important" | "minor",
  raw: unknown,
): { ok: true; value: Array<{ id: string; target: string; rationale: string }> } | { ok: false; error: ParseError } {
  if (raw === undefined || raw === null) {
    // Treat absent/null lists as empty lists — matches existing permissive
    // behavior for top-level omission; repair only triggers when the list is
    // present but malformed.
    return { ok: true, value: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        kind: "invalid_finding_list",
        message: `${field} must be a YAML list; got ${typeof raw === "object" ? "object" : typeof raw}`,
      },
    };
  }
  const out: Array<{ id: string; target: string; rationale: string }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const coerced = coerceFindingItem(raw[i]);
    if (!coerced) {
      return {
        ok: false,
        error: {
          kind: "malformed_finding_item",
          message: `${field}[${i}] must be an object with string fields id, target, rationale`,
        },
      };
    }
    out.push(coerced);
  }
  return { ok: true, value: out };
}

export function parseReviewerOutput(raw: string): ParseResult {
  if (!raw || !raw.trim()) {
    return { parsed: null, error: { kind: "empty_output", message: "reviewer output was empty" } };
  }

  let yamlContent = raw;
  const fenceMatch = raw.match(/```(?:yaml)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    yamlContent = fenceMatch[1];
  }

  let parsed: unknown;
  try {
    parsed = yamlParse(yamlContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { parsed: null, error: { kind: "yaml_syntax_error", message: `YAML parse error: ${message}` } };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      parsed: null,
      error: { kind: "not_object", message: "reviewer output did not parse into a YAML object" },
    };
  }
  const obj = parsed as Record<string, unknown>;

  const assessment = obj.overall_assessment;
  if (assessment === undefined || assessment === null) {
    return {
      parsed: null,
      error: { kind: "missing_assessment", message: "overall_assessment is required" },
    };
  }
  if (assessment !== "pass" && assessment !== "issues" && assessment !== "fail") {
    return {
      parsed: null,
      error: {
        kind: "invalid_assessment_value",
        message: "overall_assessment must be one of: pass, issues, fail",
        offendingValue: typeof assessment === "string" ? assessment : JSON.stringify(assessment),
      },
    };
  }

  const critical = coerceFindingListStrict("critical", obj.critical);
  if (!critical.ok) return { parsed: null, error: critical.error };
  const important = coerceFindingListStrict("important", obj.important);
  if (!important.ok) return { parsed: null, error: important.error };
  const minor = coerceFindingListStrict("minor", obj.minor);
  if (!minor.ok) return { parsed: null, error: minor.error };

  return {
    parsed: {
      overall_assessment: assessment,
      critical: critical.value,
      important: important.value,
      minor: minor.value,
      rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    },
    error: null,
  };
}

const REPAIR_MAX_PREVIOUS_CHARS = 6000;

function truncateForRepair(text: string): string {
  if (text.length <= REPAIR_MAX_PREVIOUS_CHARS) return text;
  return `${text.slice(0, REPAIR_MAX_PREVIOUS_CHARS)}\n...[truncated]`;
}

function buildRepairTask(previousOutput: string, parseError: ParseError): string {
  const offending = parseError.offendingValue ? ` (offending value: ${parseError.offendingValue})` : "";
  return [
    "Your previous reviewer output could not be parsed.",
    `Parse error: ${parseError.message}${offending}`,
    "",
    "Required schema:",
    "  overall_assessment: pass | issues | fail",
    "  critical: array of { id: string, target: string, rationale: string }",
    "  important: array of { id: string, target: string, rationale: string }",
    "  minor: array of { id: string, target: string, rationale: string }",
    "  rationale: string",
    "",
    "Do NOT change your underlying verdict, findings, or rationale. Only fix the",
    "formatting so the YAML schema above parses. Output only the corrected YAML.",
    "",
    "--- PREVIOUS OUTPUT ---",
    truncateForRepair(previousOutput),
    "--- END PREVIOUS OUTPUT ---",
  ].join("\n");
}

function throwIfAborted(signal: AbortSignal | undefined, attempts: ReviewAttempt[]): void {
  if (signal?.aborted) {
    throw new ReviewerCoreError("aborted", "reviewer run aborted", attempts);
  }
}

export async function runReview(input: RunReviewInput): Promise<RunReviewResult> {
  const maxRetries = Math.max(1, input.maxRetries ?? 2);
  const maxCorrectionRounds = Math.max(0, input.maxCorrectionRounds ?? 1);
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

  let attemptCounter = 0;
  let totalCorrectionRounds = 0;

  try {
    for (let freshIndex = 0; freshIndex < maxRetries; freshIndex += 1) {
      throwIfAborted(input.signal, attempts);

      // ── Initial spawn for this fresh attempt ───────────────────────────
      const initialSpawn = await spawn({
        projectRoot: input.projectRoot,
        task,
        modelArg: input.modelArg,
        extraArgs: ["--append-system-prompt", tmp.filePath, "--tools", "read"],
      });
      const initialParse = initialSpawn.terminalResult.terminalError
        ? { parsed: null, error: null as ParseError | null }
        : parseReviewerOutput(initialSpawn.terminalResult.outputText);
      const initialAttempt: ReviewAttempt = {
        attempt: attemptCounter++,
        freshSpawnIndex: freshIndex,
        phase: "initial",
        correctionRound: 0,
        rawOutput: initialSpawn.rawOutput,
        stderrOutput: initialSpawn.stderrOutput,
        exitCode: initialSpawn.exitCode,
        terminalResult: initialSpawn.terminalResult,
        parsed: initialParse.parsed,
        parseError: initialParse.error,
      };
      attempts.push(initialAttempt);

      if (initialSpawn.terminalResult.terminalError) {
        throw new ReviewerCoreError(
          "subprocess_failure",
          initialSpawn.terminalResult.errorMessage ?? initialSpawn.terminalResult.terminalError,
          attempts,
        );
      }

      if (initialParse.parsed) {
        return {
          review: initialParse.parsed,
          inputHash,
          task,
          attempts,
          formatRepairSucceeded: false,
          correctionRounds: totalCorrectionRounds,
        };
      }

      // ── Format repair loop within this fresh spawn ─────────────────────
      let previousOutput = initialSpawn.terminalResult.outputText;
      let previousError = initialParse.error;

      for (let round = 1; round <= maxCorrectionRounds; round += 1) {
        if (!previousError) break; // defensive; should always be set when parsed is null
        throwIfAborted(input.signal, attempts);

        const repairTask = buildRepairTask(previousOutput, previousError);
        const repairSpawn = await spawn({
          projectRoot: input.projectRoot,
          task: repairTask,
          modelArg: input.modelArg,
          extraArgs: ["--append-system-prompt", tmp.filePath, "--tools", "read"],
        });
        totalCorrectionRounds += 1;

        const repairParse = repairSpawn.terminalResult.terminalError
          ? { parsed: null, error: null as ParseError | null }
          : parseReviewerOutput(repairSpawn.terminalResult.outputText);
        const repairAttempt: ReviewAttempt = {
          attempt: attemptCounter++,
          freshSpawnIndex: freshIndex,
          phase: "repair",
          correctionRound: round,
          rawOutput: repairSpawn.rawOutput,
          stderrOutput: repairSpawn.stderrOutput,
          exitCode: repairSpawn.exitCode,
          terminalResult: repairSpawn.terminalResult,
          parsed: repairParse.parsed,
          parseError: repairParse.error,
        };
        attempts.push(repairAttempt);

        if (repairSpawn.terminalResult.terminalError) {
          // Infrastructure failure during repair is still infrastructure failure —
          // do not demote to parse_exhausted.
          throw new ReviewerCoreError(
            "subprocess_failure",
            repairSpawn.terminalResult.errorMessage ?? repairSpawn.terminalResult.terminalError,
            attempts,
          );
        }

        if (repairParse.parsed) {
          return {
            review: repairParse.parsed,
            inputHash,
            task,
            attempts,
            formatRepairSucceeded: true,
            correctionRounds: totalCorrectionRounds,
          };
        }

        previousOutput = repairSpawn.terminalResult.outputText;
        previousError = repairParse.error;
      }
      // Repair rounds exhausted for this fresh spawn; outer loop may try another.
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
    "Failed to parse reviewer output after retries and format repair",
    attempts,
  );
}
