import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildSourceFilePaths,
  buildValidateMilestoneReviewProtocol,
  shouldUseSequentialMilestoneValidationReview,
} from "../auto-prompts.ts";

// Regression test for #4416: the fallback string must not mention `rg` because
// auto-mode runs on systems where ripgrep is not installed (e.g. Windows).
test("buildSourceFilePaths fallback does not reference rg or ripgrep", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-prompts-fallback-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  // No GSD files exist in tmp — forces the fallback branch.
  const result = buildSourceFilePaths(tmp, "M001");

  assert.ok(
    !result.includes("rg ") && !result.includes("`rg`") && !result.includes("ripgrep"),
    `Fallback string must not reference rg/ripgrep. Got: ${result}`,
  );
  assert.ok(result.length > 0, "Fallback string must not be empty");
});

test("buildSourceFilePaths with sid also produces rg-free fallback", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "gsd-prompts-fallback-sid-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  const result = buildSourceFilePaths(tmp, "M001", "S01");

  assert.ok(
    !result.includes("rg ") && !result.includes("`rg`") && !result.includes("ripgrep"),
    `Fallback string must not reference rg/ripgrep. Got: ${result}`,
  );
});

test("validate-milestone review protocol defaults to subagent fan-out", () => {
  const protocol = buildValidateMilestoneReviewProtocol({
    milestoneId: "M001",
    workingDirectory: "/repo",
    roadmapPath: ".gsd/milestones/M001/M001-ROADMAP.md",
    useSubagents: true,
  });

  assert.match(protocol, /Dispatch Parallel Reviewers/);
  assert.match(protocol, /Call `subagent`/);
  assert.match(protocol, /Reviewer A/);
  assert.match(protocol, /Reviewer B/);
  assert.match(protocol, /Reviewer C/);
});

test("validate-milestone review protocol can avoid subagent fan-out", () => {
  const protocol = buildValidateMilestoneReviewProtocol({
    milestoneId: "M001",
    workingDirectory: "/repo",
    roadmapPath: ".gsd/milestones/M001/M001-ROADMAP.md",
    useSubagents: false,
  });

  assert.match(protocol, /Run Reviewers Sequentially/);
  assert.match(protocol, /Do not call the `subagent` tool/);
  assert.match(protocol, /compatibility fallback/);
  assert.match(protocol, /Keep each reviewer output compact/);
  assert.match(protocol, /Reviewer A/);
  assert.match(protocol, /Reviewer B/);
  assert.match(protocol, /Reviewer C/);
  assert.doesNotMatch(protocol, /Call `subagent` with `tasks/);
});

test("headless environment selects sequential milestone validation review", () => {
  assert.equal(shouldUseSequentialMilestoneValidationReview({ GSD_HEADLESS: "1" }), true);
  assert.equal(shouldUseSequentialMilestoneValidationReview({ GSD_DISABLE_SUBAGENT_FANOUT: "1" }), true);
  assert.equal(shouldUseSequentialMilestoneValidationReview({ GSD_VALIDATE_MILESTONE_REVIEW_MODE: "sequential" }), true);
  assert.equal(shouldUseSequentialMilestoneValidationReview({}), false);
});
