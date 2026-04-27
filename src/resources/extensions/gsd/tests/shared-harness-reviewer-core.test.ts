import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ReviewerCoreError,
  parseReviewerOutput,
  runReview,
} from "../shared-harness/reviewer-core.js";
import type {
  ParseResult,
  ReviewAttempt,
  RunReviewInput,
} from "../shared-harness/reviewer-core.js";
import type { SubagentTerminalResult } from "../shared-harness/subagent-terminal.js";
import type { SpawnGsdSubagentResult } from "../shared-harness/subagent-spawn.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "shared-harness", "reviewer-core.ts"), "utf-8");

function stubTerminal(overrides?: Partial<SubagentTerminalResult>): SubagentTerminalResult {
  return {
    outputText: "",
    stopReason: "stop",
    errorMessage: null,
    provider: "claude-code",
    model: "claude-opus-4-6",
    terminalError: null,
    assistantStarted: true,
    messageUpdateCount: 0,
    toolExecutionCount: 0,
    ...overrides,
  };
}

function spawnResultOf(output: string): SpawnGsdSubagentResult {
  return {
    rawOutput: output,
    stderrOutput: "",
    exitCode: 0,
    terminalResult: stubTerminal({ outputText: output, messageUpdateCount: 1 }),
  };
}

function spawnResultTerminalError(message: string): SpawnGsdSubagentResult {
  return {
    rawOutput: "",
    stderrOutput: message,
    exitCode: 1,
    terminalResult: stubTerminal({
      outputText: "",
      stopReason: "error",
      errorMessage: message,
      terminalError: message,
      assistantStarted: false,
    }),
  };
}

const VALID_YAML_PASS = [
  "overall_assessment: pass",
  "critical: []",
  "important: []",
  "minor: []",
  "rationale: ok",
].join("\n");

test("reviewer-core exports ReviewResult, parseReviewerOutput, runReview, ParseResult", () => {
  assert.match(source, /export interface ReviewResult/);
  assert.match(source, /export function parseReviewerOutput\(/);
  assert.match(source, /export async function runReview\(/);
  assert.match(source, /export interface ParseResult/);
});

test("parseReviewerOutput accepts fenced YAML verdicts and returns { parsed, error: null }", () => {
  const result: ParseResult = parseReviewerOutput([
    "```yaml",
    "overall_assessment: issues",
    "critical:",
    "  - id: C1",
    "    target: src/foo.ts",
    "    rationale: Needs a fix",
    "important: []",
    "minor: []",
    "rationale: reviewer summary",
    "```",
  ].join("\n"));

  assert.equal(result.error, null);
  assert.ok(result.parsed);
  assert.equal(result.parsed?.overall_assessment, "issues");
  assert.equal(result.parsed?.critical.length, 1);
});

test("parseReviewerOutput returns empty_output error for blank input", () => {
  const result = parseReviewerOutput("");
  assert.equal(result.parsed, null);
  assert.equal(result.error?.kind, "empty_output");
});

test("parseReviewerOutput returns yaml_syntax_error for malformed YAML", () => {
  // Unbalanced braces / bad indentation. yaml.parse throws.
  const result = parseReviewerOutput("{this is: not: valid yaml");
  assert.equal(result.parsed, null);
  assert.equal(result.error?.kind, "yaml_syntax_error");
});

test("parseReviewerOutput returns missing_assessment when overall_assessment is absent", () => {
  const result = parseReviewerOutput([
    "critical: []",
    "important: []",
    "minor: []",
    "rationale: no assessment",
  ].join("\n"));
  assert.equal(result.parsed, null);
  assert.equal(result.error?.kind, "missing_assessment");
});

test("parseReviewerOutput returns invalid_assessment_value with offendingValue", () => {
  const result = parseReviewerOutput([
    "overall_assessment: approved",
    "critical: []",
    "important: []",
    "minor: []",
    "rationale: x",
  ].join("\n"));
  assert.equal(result.parsed, null);
  assert.equal(result.error?.kind, "invalid_assessment_value");
  assert.equal(result.error?.offendingValue, "approved");
});

test("parseReviewerOutput returns invalid_finding_list when critical is not an array", () => {
  const result = parseReviewerOutput([
    "overall_assessment: pass",
    "critical: {}",
    "important: []",
    "minor: []",
    "rationale: x",
  ].join("\n"));
  assert.equal(result.parsed, null);
  assert.equal(result.error?.kind, "invalid_finding_list");
});

// Behavior change: prior versions silently dropped malformed finding items.
// That quietly weakened the review gate — a reviewer that returned 5 findings
// with 4 malformed entries would be "accepted" with just 1 finding. The new
// behavior surfaces the problem so the in-session format repair loop can
// prompt the model to correct its output; only if repair fails does the
// failure bubble up.
test("parseReviewerOutput returns malformed_finding_item (strict) when any item is invalid", () => {
  const result = parseReviewerOutput([
    "overall_assessment: issues",
    "critical:",
    "  - id: C1",
    "    target: src/foo.ts",
    "    rationale: valid",
    "  - id: 1",
    "    target: src/bar.ts",
    "    rationale: invalid id (number not string)",
    "important: []",
    "minor: []",
    "rationale: summary",
  ].join("\n"));
  assert.equal(result.parsed, null);
  assert.equal(result.error?.kind, "malformed_finding_item");
  assert.match(result.error?.message ?? "", /critical\[1\]/);
});

test("runReview returns the parsed result on first attempt without repair", async () => {
  let callCount = 0;
  const input: RunReviewInput = {
    projectRoot: "/tmp/project",
    modelArg: "claude-code/claude-opus-4-6",
    systemPrompt: "system",
    reviewPrompt: "review",
    targetContent: "target",
    spawn: async (options) => {
      callCount += 1;
      assert.match(options.extraArgs?.join(" ") ?? "", /--append-system-prompt/);
      assert.match(options.extraArgs?.join(" ") ?? "", /--tools read/);
      return spawnResultOf(VALID_YAML_PASS);
    },
  };
  const result = await runReview(input);
  assert.equal(callCount, 1);
  assert.equal(result.review.overall_assessment, "pass");
  assert.equal(result.formatRepairSucceeded, false);
  assert.equal(result.correctionRounds, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.phase, "initial");
});

test("runReview repairs within the same fresh-spawn: initial invalid → repair valid (no fresh retry)", async () => {
  const spawnedTasks: string[] = [];
  const result = await runReview({
    projectRoot: "/tmp/project",
    modelArg: "claude-code/claude-opus-4-6",
    systemPrompt: "system",
    reviewPrompt: "review",
    targetContent: "target",
    maxRetries: 2,
    maxCorrectionRounds: 1,
    spawn: async (options) => {
      spawnedTasks.push(options.task);
      if (spawnedTasks.length === 1) {
        return spawnResultOf("not yaml at all");
      }
      // Repair spawn must be called with the repair prompt carrying the prior
      // output and the concrete parse error.
      assert.match(options.task, /Your previous reviewer output could not be parsed/);
      assert.match(options.task, /PREVIOUS OUTPUT/);
      return spawnResultOf(VALID_YAML_PASS);
    },
  });

  assert.equal(spawnedTasks.length, 2);
  assert.equal(result.review.overall_assessment, "pass");
  assert.equal(result.formatRepairSucceeded, true);
  assert.equal(result.correctionRounds, 1);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.phase, "initial");
  // "not yaml at all" parses as a plain YAML string, so it trips the not_object
  // guard (we require the top-level value to be an object with fields). This
  // still routes through the repair path identically — the kind just isn't
  // yaml_syntax_error.
  assert.equal(result.attempts[0]?.parseError?.kind, "not_object");
  assert.equal(result.attempts[1]?.phase, "repair");
  assert.equal(result.attempts[1]?.correctionRound, 1);
});

test("runReview does NOT attempt repair when spawn reports terminalError — it's still subprocess_failure", async () => {
  let callCount = 0;
  await assert.rejects(
    () =>
      runReview({
        projectRoot: "/tmp/project",
        modelArg: "claude-code/claude-opus-4-6",
        systemPrompt: "system",
        reviewPrompt: "review",
        targetContent: "target",
        maxRetries: 2,
        maxCorrectionRounds: 2,
        spawn: async () => {
          callCount += 1;
          return spawnResultTerminalError("boom: 401 unauthorized");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewerCoreError);
      assert.equal(error.kind, "subprocess_failure");
      // Crucially, no repair spawn. Infrastructure failures can't be fixed by
      // asking the model to "reformat its output".
      assert.equal(callCount, 1);
      return true;
    },
  );
});

test("runReview bubbles subprocess_failure when terminalError appears during repair (not parse_exhausted)", async () => {
  let callCount = 0;
  await assert.rejects(
    () =>
      runReview({
        projectRoot: "/tmp/project",
        modelArg: "claude-code/claude-opus-4-6",
        systemPrompt: "system",
        reviewPrompt: "review",
        targetContent: "target",
        maxRetries: 2,
        maxCorrectionRounds: 2,
        spawn: async () => {
          callCount += 1;
          if (callCount === 1) return spawnResultOf("not yaml");
          return spawnResultTerminalError("network down during repair");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewerCoreError);
      // Key invariant: a transient infra blip inside the repair loop must NOT
      // be demoted to parse_exhausted. Operators need to see "provider dropped"
      // even if it happened mid-repair.
      assert.equal(error.kind, "subprocess_failure");
      return true;
    },
  );
});

test("runReview exhausts repair rounds and fresh spawns → parse_exhausted with all attempts attached", async () => {
  let callCount = 0;
  await assert.rejects(
    () =>
      runReview({
        projectRoot: "/tmp/project",
        modelArg: "claude-code/claude-opus-4-6",
        systemPrompt: "system",
        reviewPrompt: "review",
        targetContent: "target",
        maxRetries: 2,
        maxCorrectionRounds: 1,
        spawn: async () => {
          callCount += 1;
          return spawnResultOf("never valid");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewerCoreError);
      assert.equal(error.kind, "parse_exhausted");
      // 2 fresh spawns * (1 initial + 1 repair) = 4 attempts total.
      assert.equal(error.attempts.length, 4);
      const phases = error.attempts.map((a: ReviewAttempt) => `${a.freshSpawnIndex}:${a.phase}`);
      assert.deepEqual(phases, ["0:initial", "0:repair", "1:initial", "1:repair"]);
      return true;
    },
  );
});

test("runReview respects AbortSignal — no further spawns after abort", async () => {
  const controller = new AbortController();
  let callCount = 0;
  await assert.rejects(
    () =>
      runReview({
        projectRoot: "/tmp/project",
        modelArg: "claude-code/claude-opus-4-6",
        systemPrompt: "system",
        reviewPrompt: "review",
        targetContent: "target",
        maxRetries: 3,
        maxCorrectionRounds: 2,
        signal: controller.signal,
        spawn: async () => {
          callCount += 1;
          // Abort during the initial fresh spawn. The repair loop and
          // subsequent fresh retries must not fire.
          controller.abort();
          return spawnResultOf("not yaml");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewerCoreError);
      assert.equal(error.kind, "aborted");
      assert.equal(callCount, 1);
      return true;
    },
  );
});

test("reviewer-core keeps reviewer subprocess restricted to --tools read", () => {
  assert.match(source, /"--tools",\s*"read"/);
});
