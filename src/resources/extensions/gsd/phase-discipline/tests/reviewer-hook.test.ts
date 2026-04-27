import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPhaseDisciplineReviewerHook } from "../../phase-discipline/reviewer-hook.ts";
import { ReviewerCoreError } from "../../shared-harness/reviewer-core.ts";
import type { ReviewAttempt, ReviewResult, RunReviewResult } from "../../shared-harness/reviewer-core.ts";
import type { SubagentTerminalResult } from "../../shared-harness/subagent-terminal.ts";

function stubTerminalResult(overrides?: Partial<SubagentTerminalResult>): SubagentTerminalResult {
  return {
    outputText: "",
    stopReason: "end_turn",
    errorMessage: null,
    provider: null,
    model: null,
    terminalError: null,
    assistantStarted: true,
    messageUpdateCount: 0,
    toolExecutionCount: 0,
    ...overrides,
  };
}

function stubAttempt(overrides?: Partial<ReviewAttempt>): ReviewAttempt {
  return {
    attempt: 0,
    freshSpawnIndex: 0,
    phase: "initial",
    correctionRound: 0,
    rawOutput: "",
    stderrOutput: "",
    exitCode: 0,
    terminalResult: stubTerminalResult(),
    parsed: null,
    parseError: null,
    ...overrides,
  };
}

function stubRunReviewResult(review: ReviewResult, overrides?: Partial<RunReviewResult>): RunReviewResult {
  return {
    review,
    inputHash: "h",
    task: "review",
    attempts: [],
    formatRepairSucceeded: false,
    correctionRounds: 0,
    ...overrides,
  };
}

function createBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-phase-reviewer-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  return base;
}

test("reviewer-hook writes artifact and retry marker when merged assessment is not pass", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        retry_on: "CODE-REVIEW-RETRY.md",
        cross_review: 2,
        model: "gpt-5.4",
        provider: "openai",
      },
      pickReviewers: () => [{ model: "claude-sonnet-4-6", provider: "anthropic" }],
      runReviewImpl: async ({ modelArg }) => stubRunReviewResult(
        modelArg.includes("claude")
          ? {
              overall_assessment: "issues",
              critical: [{ id: "C1", target: "task-summary", rationale: "needs follow-up" }],
              important: [],
              minor: [],
              rationale: "cross reviewer found issues",
            }
          : {
              overall_assessment: "pass",
              critical: [],
              important: [],
              minor: [],
              rationale: "primary reviewer passes",
            },
        { inputHash: modelArg },
      ),
    });

    assert.equal(result.overallAssessment, "issues");
    assert.equal(result.retryRequested, true);
    assert.ok(existsSync(result.artifactPath));
    assert.ok(existsSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-CODE-REVIEW-RETRY.md")));
    assert.ok(existsSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json")));
    assert.match(readFileSync(result.artifactPath, "utf8"), /Overall Assessment: issues/);
    assert.match(readFileSync(result.artifactPath, "utf8"), /needs follow-up/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook respects provider-qualified configured models over provider fallback", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const seenModelArgs: string[] = [];
    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 2,
        model: "claude-code/claude-opus-4-6",
        provider: "openai",
        cross_review_models: ["gpt-5.4"],
      },
      runReviewImpl: async ({ modelArg }) => {
        seenModelArgs.push(modelArg);
        return stubRunReviewResult(
          {
            overall_assessment: "pass",
            critical: [],
            important: [],
            minor: [],
            rationale: "qualified models respected",
          },
          { inputHash: modelArg },
        );
      },
    });

    assert.equal(result.overallAssessment, "pass");
    assert.deepEqual(seenModelArgs, ["claude-code/claude-opus-4-6", "openai/gpt-5.4"]);
    const observability = JSON.parse(readFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json"), "utf8"));
    assert.deepEqual(observability.reviewers, [
      { provider: "claude-code", model: "claude-opus-4-6" },
      { provider: "openai", model: "gpt-5.4" },
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook records reviewer_unavailable when all reviewers fail and writes BLOCKED sentinel instead of retry_on", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        retry_on: "CODE-REVIEW-RETRY.md",
        cross_review: 2,
        model: "gpt-5.4",
        provider: "openai",
      },
      pickReviewers: () => [{ model: "claude-opus-4-6", provider: "claude-code" }],
      runReviewImpl: async () => {
        throw new Error("401");
      },
    });

    assert.equal(result.overallAssessment, "fail");
    // Subsystem failure must NOT request a trigger-unit retry — re-running
    // the task cannot fix provider/credentials issues. Block instead.
    assert.equal(result.retryRequested, false);
    assert.equal(result.blockedReason, "reviewer_unavailable");
    assert.ok(result.blockedArtifactPath, "blockedArtifactPath should be populated");
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    assert.ok(existsSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md")), "BLOCKED sentinel must be written");
    assert.equal(existsSync(join(tasksDir, "T01-CODE-REVIEW-RETRY.md")), false, "retry_on must NOT be written for subsystem failures");
    const artifact = readFileSync(result.artifactPath, "utf8");
    assert.match(artifact, /Overall Assessment: reviewer_unavailable/);
    const blocked = readFileSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md"), "utf8");
    assert.match(blocked, /Block Reason: reviewer_unavailable/);
    assert.match(blocked, /Operator Action/);
    const observability = JSON.parse(readFileSync(join(tasksDir, ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json"), "utf8"));
    assert.equal(observability.overall, "reviewer_unavailable");
    assert.equal(observability.failed.length, 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook clears stale BLOCKED sentinel when reviewers later succeed", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    const blockedPath = join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md");
    // Pre-seed a stale BLOCKED sentinel from an earlier unavailable run.
    writeFileSync(blockedPath, "# stale", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 1,
        model: "gpt-5.4",
        provider: "openai",
      },
      runReviewImpl: async () =>
        stubRunReviewResult({ overall_assessment: "pass" as const, critical: [], important: [], minor: [], rationale: "clean" }),
    });

    assert.equal(result.overallAssessment, "pass");
    assert.equal(result.blockedReason, undefined);
    assert.equal(existsSync(blockedPath), false, "stale BLOCKED sentinel must be cleared on a passing run");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("OQ-7: observability log includes wallClockMs and reviewerMetrics", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 1,
        model: "gpt-5.4",
        provider: "openai",
      },
      runReviewImpl: async () =>
        stubRunReviewResult(
          { overall_assessment: "pass" as const, critical: [], important: [], minor: [], rationale: "" },
          {
            attempts: [
              stubAttempt({
                rawOutput: "raw-content-here",
                parsed: { overall_assessment: "pass", critical: [], important: [], minor: [], rationale: "" },
              }),
            ],
          },
        ),
    });

    const logPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json");
    const log = JSON.parse(readFileSync(logPath, "utf8"));
    assert.equal(typeof log.wallClockMs, "number");
    assert.ok(log.wallClockMs >= 0);
    assert.ok(Array.isArray(log.reviewerMetrics));
    assert.equal(log.reviewerMetrics.length, 1);
    assert.equal(log.reviewerMetrics[0].status, "succeeded");
    assert.equal(log.reviewerMetrics[0].outputChars, 16); // "raw-content-here".length
    assert.equal(log.reviewerMetrics[0].attempts, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("OQ-10: reviewer raw stdout/stderr logs are written to .phase-discipline/", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 1,
        model: "gpt-5.4",
        provider: "openai",
      },
      runReviewImpl: async () =>
        stubRunReviewResult(
          { overall_assessment: "pass" as const, critical: [], important: [], minor: [], rationale: "" },
          {
            attempts: [
              stubAttempt({
                rawOutput: "stdout-payload",
                stderrOutput: "stderr-payload",
                parsed: { overall_assessment: "pass", critical: [], important: [], minor: [], rationale: "" },
              }),
            ],
          },
        ),
    });

    const logDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline");
    const stdoutLog = readFileSync(join(logDir, "phase-discipline-code-review-M001-S01-T01-reviewer0-stdout.log"), "utf8");
    const stderrLog = readFileSync(join(logDir, "phase-discipline-code-review-M001-S01-T01-reviewer0-stderr.log"), "utf8");
    assert.equal(stdoutLog, "stdout-payload");
    assert.equal(stderrLog, "stderr-payload");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("OQ-4: model_fallbacks are tried when all primary reviewers fail", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const seenModelArgs: string[] = [];
    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 1,
        model: "gpt-5.4",
        provider: "openai",
        model_fallbacks: ["anthropic/claude-sonnet-4-6"],
      },
      runReviewImpl: async ({ modelArg }) => {
        seenModelArgs.push(modelArg);
        if (modelArg.includes("gpt")) {
          throw new Error("auth failure");
        }
        return stubRunReviewResult(
          { overall_assessment: "pass" as const, critical: [], important: [], minor: [], rationale: "fallback worked" },
          {
            inputHash: modelArg,
            attempts: [stubAttempt({ rawOutput: "fallback-ok" })],
          },
        );
      },
    });

    assert.equal(result.overallAssessment, "pass");
    assert.deepEqual(seenModelArgs, ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"]);
    const logPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json");
    const log = JSON.parse(readFileSync(logPath, "utf8"));
    assert.equal(log.overall, "pass");
    assert.ok(log.reviewerMetrics.some((m: any) => m.status === "fallback_succeeded"));
    assert.ok(log.succeeded.includes("anthropic/claude-sonnet-4-6"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("OQ-4: all fallbacks exhausted still produces reviewer_unavailable and writes BLOCKED sentinel", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        retry_on: "CODE-REVIEW-RETRY.md",
        cross_review: 1,
        model: "gpt-5.4",
        provider: "openai",
        model_fallbacks: ["anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro"],
      },
      runReviewImpl: async () => {
        throw new Error("all providers down");
      },
    });

    assert.equal(result.overallAssessment, "fail");
    assert.equal(result.retryRequested, false);
    assert.equal(result.blockedReason, "reviewer_unavailable");
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    assert.ok(existsSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md")));
    assert.equal(existsSync(join(tasksDir, "T01-CODE-REVIEW-RETRY.md")), false);
    const artifact = readFileSync(result.artifactPath, "utf8");
    assert.match(artifact, /reviewer_unavailable/);
    const logPath = join(tasksDir, ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json");
    const log = JSON.parse(readFileSync(logPath, "utf8"));
    assert.equal(log.overall, "reviewer_unavailable");
    // 1 primary + 2 fallbacks = 3 total failed
    assert.equal(log.failed.length, 3);
    assert.ok(log.failed.some((f: any) => f.reviewer.includes("fallback:")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook falls back to current runtime model when hook config omits model/provider", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const seenModelArgs: string[] = [];
    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 1,
      },
      currentModel: { id: "claude-opus-4-6", provider: "anthropic" },
      runReviewImpl: async ({ modelArg }) => {
        seenModelArgs.push(modelArg);
        return stubRunReviewResult(
          {
            overall_assessment: "pass",
            critical: [],
            important: [],
            minor: [],
            rationale: "runtime model fallback used",
          },
          { inputHash: modelArg },
        );
      },
    });

    assert.equal(result.overallAssessment, "pass");
    assert.deepEqual(seenModelArgs, ["anthropic/claude-opus-4-6"]);
    const observability = JSON.parse(readFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json"), "utf8"));
    assert.equal(observability.overall, "pass");
    assert.deepEqual(observability.succeeded, ["anthropic/claude-opus-4-6"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook writes reviewer_format_invalid BLOCKED sentinel when all reviewers fail with parse_exhausted", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        retry_on: "CODE-REVIEW-RETRY.md",
        cross_review: 2,
        model: "gpt-5.4",
        provider: "openai",
      },
      pickReviewers: () => [{ model: "claude-opus-4-6", provider: "claude-code" }],
      runReviewImpl: async () => {
        // Both reviewers exhausted their format repair loops.
        throw new ReviewerCoreError(
          "parse_exhausted",
          "Failed to parse reviewer output after retries and format repair",
          [
            stubAttempt({
              rawOutput: "not yaml",
              parseError: { kind: "yaml_syntax_error", message: "YAML parse error: unexpected token" },
            }),
          ],
        );
      },
    });

    assert.equal(result.overallAssessment, "fail");
    assert.equal(result.retryRequested, false);
    assert.equal(result.blockedReason, "reviewer_format_invalid");
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    assert.ok(existsSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md")), "BLOCKED sentinel must be written");
    assert.equal(existsSync(join(tasksDir, "T01-CODE-REVIEW-RETRY.md")), false, "retry_on must NOT be written for format failures");
    const blocked = readFileSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md"), "utf8");
    assert.match(blocked, /Block Reason: reviewer_format_invalid/);
    // Operator action language must steer away from "check provider credentials" —
    // that guidance is wrong for format failures.
    assert.match(blocked, /reviewer model\(s\) failed to produce valid YAML/);
    const artifact = readFileSync(result.artifactPath, "utf8");
    assert.match(artifact, /Overall Assessment: reviewer_format_invalid/);
    const observability = JSON.parse(readFileSync(join(tasksDir, ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json"), "utf8"));
    assert.equal(observability.overall, "reviewer_format_invalid");
    // Every failed reviewer must have parseErrorKind recorded.
    assert.ok(
      observability.reviewerMetrics.every((m: any) =>
        m.status !== "failed" || m.failureKind === "parse_exhausted"
      ),
      "failed reviewers due to parse_exhausted must be tagged",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook: mixed subprocess_failure + parse_exhausted → reviewer_unavailable (infra problem preempts format)", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 2,
        model: "gpt-5.4",
        provider: "openai",
      },
      pickReviewers: () => [{ model: "claude-opus-4-6", provider: "claude-code" }],
      runReviewImpl: async ({ modelArg }) => {
        if (modelArg.includes("gpt")) {
          throw new ReviewerCoreError("subprocess_failure", "401 auth", []);
        }
        throw new ReviewerCoreError(
          "parse_exhausted",
          "unparseable",
          [stubAttempt({ parseError: { kind: "missing_assessment", message: "overall_assessment is required" } })],
        );
      },
    });

    // An infrastructure problem co-existing with a format problem must surface
    // as reviewer_unavailable — the operator needs to see "my provider is down"
    // first, not "my reviewer model is misbehaving". Hiding the infra signal
    // under a format label would delay the real diagnosis.
    assert.equal(result.blockedReason, "reviewer_unavailable");
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    const blocked = readFileSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md"), "utf8");
    assert.match(blocked, /Block Reason: reviewer_unavailable/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("reviewer-hook: one reviewer parse_exhausted + one succeeded → uses successful verdict (no BLOCKED)", async () => {
  const base = createBase();
  try {
    const summaryPath = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md");
    writeFileSync(summaryPath, "implemented task", "utf8");

    const result = await runPhaseDisciplineReviewerHook({
      hookName: "phase-discipline-code-review",
      triggerUnitType: "execute-task",
      triggerUnitId: "M001/S01/T01",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-code-review",
        after: ["execute-task"],
        prompt: "review task",
        artifact: "CODE-REVIEW.md",
        cross_review: 2,
        model: "gpt-5.4",
        provider: "openai",
      },
      pickReviewers: () => [{ model: "claude-opus-4-6", provider: "claude-code" }],
      runReviewImpl: async ({ modelArg }) => {
        if (modelArg.includes("gpt")) {
          return stubRunReviewResult(
            { overall_assessment: "pass", critical: [], important: [], minor: [], rationale: "looks good" },
            { inputHash: modelArg },
          );
        }
        throw new ReviewerCoreError(
          "parse_exhausted",
          "unparseable",
          [stubAttempt({ parseError: { kind: "yaml_syntax_error", message: "bad yaml" } })],
        );
      },
    });

    // Even one parseable verdict is enough — merged findings carry. No BLOCKED.
    assert.equal(result.blockedReason, undefined);
    assert.equal(result.overallAssessment, "pass");
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    assert.equal(existsSync(join(tasksDir, "T01-CODE-REVIEW-BLOCKED.md")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
