import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPhaseDisciplineReviewerHook } from "../../phase-discipline/reviewer-hook.ts";

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
      runReviewImpl: async ({ modelArg }) => ({
        inputHash: modelArg,
        task: "review",
        attempts: [],
        review: modelArg.includes("claude")
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
      }),
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
        return {
          inputHash: modelArg,
          task: "review",
          attempts: [],
          review: {
            overall_assessment: "pass",
            critical: [],
            important: [],
            minor: [],
            rationale: "qualified models respected",
          },
        };
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

test("reviewer-hook records reviewer_unavailable when all reviewers fail", async () => {
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
    assert.equal(result.retryRequested, true);
    const artifact = readFileSync(result.artifactPath, "utf8");
    assert.match(artifact, /Overall Assessment: reviewer_unavailable/);
    const observability = JSON.parse(readFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", ".phase-discipline", "phase-discipline-code-review-M001-S01-T01.json"), "utf8"));
    assert.equal(observability.overall, "reviewer_unavailable");
    assert.equal(observability.failed.length, 2);
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
        return {
          inputHash: modelArg,
          task: "review",
          attempts: [],
          review: {
            overall_assessment: "pass",
            critical: [],
            important: [],
            minor: [],
            rationale: "runtime model fallback used",
          },
        };
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
