import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runPhaseDisciplineImplPlanValidatorHook,
  validateImplPlan,
} from "../../phase-discipline/impl-plan-validator.ts";

function createBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-impl-plan-validator-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  return base;
}

function validTaskPlan(): string {
  return [
    "---",
    "estimated_steps: 2",
    "estimated_files: 1",
    "skills_used: []",
    "rollback_hint: revert src/example.ts",
    "acceptance: feature behaves as planned",
    "files:",
    "  - src/example.ts",
    "---",
    "",
    "# T01: Example",
    "",
    "## Inputs",
    "",
    "- `src/example.ts`",
    "",
    "## Expected Output",
    "",
    "- `src/example.ts`",
  ].join("\n");
}

test("validateImplPlan passes when rollback_hint acceptance and files[] exist", () => {
  const result = validateImplPlan(validTaskPlan());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateImplPlan reports missing structural fields", () => {
  const result = validateImplPlan([
    "---",
    "estimated_steps: 2",
    "estimated_files: 1",
    "skills_used: []",
    "---",
    "",
    "# T01: Example",
  ].join("\n"));

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["missing rollback_hint", "missing acceptance", "missing files[]"]);
});

test("impl-plan validator hook writes artifact and retry marker when any task plan is invalid", async () => {
  const base = createBase();
  try {
    const tasksDir = join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks");
    writeFileSync(join(tasksDir, "T01-PLAN.md"), validTaskPlan(), "utf8");
    writeFileSync(join(tasksDir, "T02-PLAN.md"), "---\nskills_used: []\n---\n\n# T02: Broken\n", "utf8");

    const result = await runPhaseDisciplineImplPlanValidatorHook({
      basePath: base,
      hookName: "phase-discipline-impl-plan-validator",
      triggerUnitType: "plan-slice",
      triggerUnitId: "M001/S01",
      hookConfig: {
        name: "phase-discipline-impl-plan-validator",
        after: ["plan-slice"],
        prompt: "validate implementation plan",
        artifact: "IMPL-PLAN-VALIDATION.md",
        retry_on: "IMPL-PLAN-RETRY.md",
      },
    });

    assert.equal(result.retryRequested, true);
    assert.ok(existsSync(result.artifactPath));
    assert.ok(existsSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "IMPL-PLAN-RETRY.md")));
    const artifact = readFileSync(result.artifactPath, "utf8");
    assert.match(artifact, /Result: fail/);
    assert.match(artifact, /T02-PLAN\.md: missing rollback_hint/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("impl-plan validator hook clears stale retry marker after a valid rerun", async () => {
  const base = createBase();
  try {
    const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
    const tasksDir = join(sliceDir, "tasks");
    const retryPath = join(sliceDir, "IMPL-PLAN-RETRY.md");
    writeFileSync(join(tasksDir, "T01-PLAN.md"), validTaskPlan(), "utf8");
    writeFileSync(retryPath, "stale retry\n", "utf8");

    const result = await runPhaseDisciplineImplPlanValidatorHook({
      basePath: base,
      hookName: "phase-discipline-impl-plan-validator",
      triggerUnitType: "plan-slice",
      triggerUnitId: "M001/S01",
      hookConfig: {
        name: "phase-discipline-impl-plan-validator",
        after: ["plan-slice"],
        prompt: "validate implementation plan",
        artifact: "IMPL-PLAN-VALIDATION.md",
        retry_on: "IMPL-PLAN-RETRY.md",
      },
    });

    assert.equal(result.retryRequested, false);
    assert.equal(existsSync(retryPath), false);
    assert.match(readFileSync(result.artifactPath, "utf8"), /Result: pass/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
