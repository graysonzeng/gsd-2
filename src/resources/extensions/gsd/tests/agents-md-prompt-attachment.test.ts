import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildPlanMilestonePrompt,
  buildPlanSlicePrompt,
  buildRefineSlicePrompt,
  buildExecuteTaskPrompt,
  buildCompleteSlicePrompt,
  buildCompleteMilestonePrompt,
} from "../auto-prompts.ts";
import { buildExtractLearningsPrompt } from "../commands-extract-learnings.ts";
import { openDatabase, closeDatabase, insertMilestone, insertSlice, insertTask } from "../gsd-db.ts";
import { clearPathCache } from "../paths.ts";
import { clearParseCache } from "../files.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, "..", "prompts");

function makeBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-agents-prompt-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  return base;
}

function writeDocsMap(base: string): void {
  writeFileSync(join(base, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\nPrompt attachment identity.\n\n## Constraints\n\nKeep docs-map additive.\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nOnly one docs-map block per prompt.\n\n<!-- task-type: testing -->\nPrefer test-first execution.\n`, "utf-8");
  mkdirSync(join(base, ".docs-map"), { recursive: true });
  writeFileSync(join(base, ".docs-map", "testing.md"), "Testing addendum for prompts.", "utf-8");
}

function writeArtifacts(base: string): void {
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-CONTEXT.md"), "# Context\n\nMilestone context.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-RESEARCH.md"), "# Research\n\nMilestone research.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), "# M001: Test Milestone\n\n## Slices\n\n- [ ] **S01: Test Slice** `risk:low` `depends:[]`\n  > Demo\n", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-SUMMARY.md"), "# Summary\n\nDone.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-CONTEXT.md"), "# Slice Context\n\nDiscussion context.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-RESEARCH.md"), "# Slice Research\n\nSlice research.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"), "# Slice Plan\n\nVerification: run tests.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-SUMMARY.md"), "# Slice Summary\n\nDelivered.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-UAT.md"), "# UAT\n\nDo it.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-PLAN.md"), "# Task Plan\n\nImplement tests.", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md"), "# Task Summary\n\nDone.", "utf-8");
}

function openTestDb(base: string): void {
  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "Test Milestone", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Test Slice", status: "active", risk: "low", depends: [] });
  insertTask({
    id: "T01",
    sliceId: "S01",
    milestoneId: "M001",
    title: "Write testing coverage",
    status: "pending",
    planning: {
      files: ["src/foo.test.ts", "src/foo.ts"],
      verify: "npm test",
      expectedOutput: ["src/foo.test.ts"],
    },
  });
}

function cleanup(base: string): void {
  clearPathCache();
  clearParseCache();
  try { closeDatabase(); } catch { /* ignore */ }
  rmSync(base, { recursive: true, force: true });
}

test("execute-task prompt template consumes inlinedTemplates", () => {
  const prompt = readFileSync(join(promptsDir, "execute-task.md"), "utf-8");
  assert.match(prompt, /\{\{inlinedTemplates\}\}/);
});

test("plan/refine/execute/complete prompts attach docs-map at approved points", async () => {
  const base = makeBase();
  try {
    writeDocsMap(base);
    writeArtifacts(base);
    openTestDb(base);

    const milestonePrompt = await buildPlanMilestonePrompt("M001", "Test Milestone", base);
    const planSlicePrompt = await buildPlanSlicePrompt("M001", "Test Milestone", "S01", "Testing Slice", base);
    const refineSlicePrompt = await buildRefineSlicePrompt("M001", "Test Milestone", "S01", "Testing Slice", base);
    const executePrompt = await buildExecuteTaskPrompt("M001", "S01", "Testing Slice", "T01", "Write testing coverage", base);
    const completeSlicePrompt = await buildCompleteSlicePrompt("M001", "Test Milestone", "S01", "Testing Slice", base);
    const completeMilestonePrompt = await buildCompleteMilestonePrompt("M001", "Test Milestone", base);

    assert.match(milestonePrompt, /## AGENTS\.md Context/);
    assert.doesNotMatch(milestonePrompt, /## Docs-Map Addendum/);

    assert.match(planSlicePrompt, /## AGENTS\.md Context/);
    assert.match(planSlicePrompt, /## Docs-Map Addendum/);

    assert.match(refineSlicePrompt, /## AGENTS\.md Context/);
    assert.match(refineSlicePrompt, /## Docs-Map Addendum/);

    assert.match(executePrompt, /## AGENTS\.md Context/);
    assert.match(executePrompt, /## Docs-Map Addendum/);
    assert.match(executePrompt, /Testing addendum for prompts/);

    assert.match(completeSlicePrompt, /## AGENTS\.md Context/);
    assert.doesNotMatch(completeSlicePrompt, /## Docs-Map Addendum/);

    assert.match(completeMilestonePrompt, /## AGENTS\.md Context/);
    assert.doesNotMatch(completeMilestonePrompt, /## Docs-Map Addendum/);
    assert.equal((completeMilestonePrompt.match(/## AGENTS\.md Context/g) ?? []).length, 1);
  } finally {
    cleanup(base);
  }
});

test("execute-task prompt omits addendum when task hint is null", async () => {
  const base = makeBase();
  try {
    writeDocsMap(base);
    writeArtifacts(base);
    openDatabase(join(base, ".gsd", "gsd.db"));
    insertMilestone({ id: "M001", title: "Test Milestone", status: "active" });
    insertSlice({ id: "S01", milestoneId: "M001", title: "Test Slice", status: "active", risk: "low", depends: [] });
    insertTask({
      id: "T01",
      sliceId: "S01",
      milestoneId: "M001",
      title: "Implement backend flow",
      status: "pending",
      planning: { files: ["src/server.ts"], verify: "npm test", expectedOutput: ["src/server.ts"] },
    });

    const prompt = await buildExecuteTaskPrompt("M001", "S01", "Backend Slice", "T01", "Implement backend flow", base);
    assert.match(prompt, /## AGENTS\.md Context/);
    assert.doesNotMatch(prompt, /## Docs-Map Addendum/);
  } finally {
    cleanup(base);
  }
});

test("buildExtractLearningsPrompt can carry L0-only docs-map context", () => {
  const prompt = buildExtractLearningsPrompt({
    milestoneId: "M001",
    milestoneName: "Test Milestone",
    outputPath: "/tmp/M001-LEARNINGS.md",
    relativeOutputPath: ".gsd/milestones/M001/M001-LEARNINGS.md",
    roadmapContent: "# Roadmap",
    summaryContent: "# Summary",
    verificationContent: null,
    uatContent: null,
    missingArtifacts: [],
    projectName: "Proj",
    agentsContext: "## AGENTS.md Context\n\nL0 only.",
  });

  assert.match(prompt, /## AGENTS\.md Context/);
  assert.doesNotMatch(prompt, /## Docs-Map Addendum/);
});
