import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ReviewerCoreError, parseReviewerOutput, runReview } from "../shared-harness/reviewer-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "shared-harness", "reviewer-core.ts"), "utf-8");

test("reviewer-core exports ReviewResult, parseReviewerOutput, and runReview", () => {
  assert.match(source, /export interface ReviewResult/);
  assert.match(source, /export function parseReviewerOutput\(/);
  assert.match(source, /export async function runReview\(/);
});

test("parseReviewerOutput accepts fenced YAML verdicts", () => {
  const parsed = parseReviewerOutput([
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

  assert.ok(parsed);
  assert.equal(parsed?.overall_assessment, "issues");
  assert.equal(parsed?.critical.length, 1);
});

test("parseReviewerOutput drops malformed finding items", () => {
  const parsed = parseReviewerOutput([
    "overall_assessment: issues",
    "critical:",
    "  - id: C1",
    "    target: src/foo.ts",
    "    rationale: valid",
    "  - id: 1",
    "    target: src/bar.ts",
    "    rationale: invalid id",
    "important:",
    "  - nope",
    "minor: []",
    "rationale: summary",
  ].join("\n"));

  assert.ok(parsed);
  assert.deepEqual(parsed?.critical, [
    { id: "C1", target: "src/foo.ts", rationale: "valid" },
  ]);
  assert.deepEqual(parsed?.important, []);
});

test("runReview retries after parse failure and returns the second successful attempt", async () => {
  let callCount = 0;
  const result = await runReview({
    projectRoot: "/tmp/project",
    modelArg: "claude-code/claude-opus-4-6",
    systemPrompt: "system",
    reviewPrompt: "review",
    targetContent: "target",
    maxRetries: 2,
    spawn: async (options) => {
      callCount += 1;
      assert.match(options.extraArgs?.join(" ") ?? "", /--append-system-prompt/);
      assert.match(options.extraArgs?.join(" ") ?? "", /--tools read/);
      if (callCount === 1) {
        return {
          rawOutput: "not yaml",
          stderrOutput: "",
          exitCode: 0,
          terminalResult: {
            outputText: "not yaml",
            stopReason: "stop",
            errorMessage: null,
            provider: "claude-code",
            model: "claude-opus-4-6",
            terminalError: null,
            assistantStarted: true,
            messageUpdateCount: 0,
            toolExecutionCount: 0,
          },
        };
      }
      return {
        rawOutput: [
          "overall_assessment: pass",
          "critical: []",
          "important: []",
          "minor: []",
          "rationale: ok",
        ].join("\n"),
        stderrOutput: "",
        exitCode: 0,
        terminalResult: {
          outputText: [
            "overall_assessment: pass",
            "critical: []",
            "important: []",
            "minor: []",
            "rationale: ok",
          ].join("\n"),
          stopReason: "stop",
          errorMessage: null,
          provider: "claude-code",
          model: "claude-opus-4-6",
          terminalError: null,
          assistantStarted: true,
          messageUpdateCount: 1,
          toolExecutionCount: 0,
        },
      };
    },
  });

  assert.equal(callCount, 2);
  assert.equal(result.review.overall_assessment, "pass");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.parsed, null);
  assert.equal(result.attempts[1]?.parsed?.overall_assessment, "pass");
});

test("runReview throws parse_exhausted with all attempts attached", async () => {
  await assert.rejects(
    () => runReview({
      projectRoot: "/tmp/project",
      modelArg: "claude-code/claude-opus-4-6",
      systemPrompt: "system",
      reviewPrompt: "review",
      targetContent: "target",
      maxRetries: 2,
      spawn: async () => ({
        rawOutput: "not yaml",
        stderrOutput: "",
        exitCode: 0,
        terminalResult: {
          outputText: "not yaml",
          stopReason: "stop",
          errorMessage: null,
          provider: "claude-code",
          model: "claude-opus-4-6",
          terminalError: null,
          assistantStarted: true,
          messageUpdateCount: 0,
          toolExecutionCount: 0,
        },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewerCoreError);
      assert.equal(error.kind, "parse_exhausted");
      assert.equal(error.attempts.length, 2);
      return true;
    },
  );
});

test("runReview throws subprocess_failure when subagent returns terminalError", async () => {
  await assert.rejects(
    () => runReview({
      projectRoot: "/tmp/project",
      modelArg: "claude-code/claude-opus-4-6",
      systemPrompt: "system",
      reviewPrompt: "review",
      targetContent: "target",
      maxRetries: 2,
      spawn: async () => ({
        rawOutput: "",
        stderrOutput: "boom",
        exitCode: 1,
        terminalResult: {
          outputText: "",
          stopReason: "error",
          errorMessage: "boom",
          provider: "claude-code",
          model: "claude-opus-4-6",
          terminalError: "boom",
          assistantStarted: false,
          messageUpdateCount: 0,
          toolExecutionCount: 0,
        },
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ReviewerCoreError);
      assert.equal(error.kind, "subprocess_failure");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0]?.terminalResult.terminalError, "boom");
      return true;
    },
  );
});

test("reviewer-core keeps reviewer subprocess restricted to --tools read", () => {
  assert.match(source, /"--tools",\s*"read"/);
});
