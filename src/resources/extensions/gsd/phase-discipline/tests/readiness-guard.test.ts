import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { evaluatePhaseDisciplineReadinessGuard } from "../../phase-discipline/readiness-guard.ts";
import { resetRegistry } from "../../rule-registry.ts";
import { runPreDispatchHooks } from "../../post-unit-hooks.ts";
import { closeDatabase, insertMilestone, insertSlice, insertTask, openDatabase, upsertTaskPlanning } from "../../gsd-db.ts";

function createBase(): string {
  return mkdtempSync(join(tmpdir(), "gsd-readiness-guard-"));
}

function cleanup(base: string): void {
  resetRegistry();
  try { closeDatabase(); } catch { /* noop */ }
  rmSync(base, { recursive: true, force: true });
}

function writePreferences(base: string): void {
  mkdirSync(join(base, ".gsd"), { recursive: true });
  writeFileSync(
    join(base, ".gsd", "PREFERENCES.md"),
    [
      "---",
      'milestone_profile: "phase-discipline-8step"',
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
}

function seedDb(base: string): void {
  openDatabase(join(base, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "Test Milestone", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Test Slice", status: "active", risk: "low", depends: [] });
}

test("readiness-guard advises research-slice when plan-slice lacks RESEARCH.md", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01"), { recursive: true });

    const result = evaluatePhaseDisciplineReadinessGuard({
      unitType: "plan-slice",
      unitId: "M001/S01",
      prompt: "plan",
      basePath: base,
    });

    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "research-slice");
    assert.ok(result.issues?.some((issue) => issue.code === "research_artifact_missing" && issue.stage === "readiness-guard"));
  } finally {
    cleanup(base);
  }
});

test("readiness-guard blocks execute-task when unitId is missing task segment", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01"), { recursive: true });

    const result = evaluatePhaseDisciplineReadinessGuard({
      unitType: "execute-task",
      unitId: "M001/S01",
      prompt: "execute",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "error");
    assert.ok(result.issues?.some((issue) => issue.code === "invalid_unit_id" && issue.stage === "readiness-guard"));
  } finally {
    cleanup(base);
  }
});

test("readiness-guard warning-blocks execute-task when slice plan is missing", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });

    const result = evaluatePhaseDisciplineReadinessGuard({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "execute",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "warning");
    assert.ok(result.issues?.some((issue) => issue.code === "plan_artifact_missing"));
  } finally {
    cleanup(base);
  }
});

test("readiness-guard warning-blocks execute-task when DB task is missing", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
    writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"), "# plan\n", "utf8");
    seedDb(base);

    const result = evaluatePhaseDisciplineReadinessGuard({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "execute",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "warning");
    assert.ok(result.issues?.some((issue) => issue.code === "task_not_found"));
  } finally {
    cleanup(base);
  }
});

test("readiness-guard warning-blocks execute-task when task plan artifact is missing", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
    writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"), "# plan\n", "utf8");
    seedDb(base);
    insertTask({
      milestoneId: "M001",
      sliceId: "S01",
      id: "T01",
      title: "Task 1",
      planning: {
        description: "desc",
        estimate: "10m",
        files: ["src/example.ts"],
        verify: "npm test",
        inputs: ["src/example.ts"],
        expectedOutput: ["src/example.ts"],
      },
    });
    upsertTaskPlanning("M001", "S01", "T01", { fullPlanMd: "# T01 plan" });

    const result = evaluatePhaseDisciplineReadinessGuard({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "execute",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "warning");
    assert.ok(result.issues?.some((issue) => issue.code === "task_plan_missing"));
  } finally {
    cleanup(base);
  }
});

test("readiness-guard proceeds when research, slice plan, DB task, and task plan artifact all exist", () => {
  const base = createBase();
  try {
    const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
    const tasksDir = join(sliceDir, "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(join(sliceDir, "S01-RESEARCH.md"), "# research\n", "utf8");
    writeFileSync(join(sliceDir, "S01-PLAN.md"), "# plan\n", "utf8");
    writeFileSync(join(tasksDir, "T01-PLAN.md"), "# task plan\n", "utf8");
    seedDb(base);
    insertTask({
      milestoneId: "M001",
      sliceId: "S01",
      id: "T01",
      title: "Task 1",
      planning: {
        description: "desc",
        estimate: "10m",
        files: ["src/example.ts"],
        verify: "npm test",
        inputs: ["src/example.ts"],
        expectedOutput: ["src/example.ts"],
      },
    });
    upsertTaskPlanning("M001", "S01", "T01", { fullPlanMd: "# T01 plan" });

    const planResult = evaluatePhaseDisciplineReadinessGuard({
      unitType: "plan-slice",
      unitId: "M001/S01",
      prompt: "plan",
      basePath: base,
    });
    const executeResult = evaluatePhaseDisciplineReadinessGuard({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "execute",
      basePath: base,
    });

    assert.equal(planResult.action, "proceed");
    assert.equal(executeResult.action, "proceed");
  } finally {
    cleanup(base);
  }
});

test("readiness-guard runs before profile-dispatch in preset hooks", () => {
  const base = createBase();
  try {
    writePreferences(base);
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
    writeFileSync(
      join(base, ".gsd", "STATE.md"),
      [
        "# GSD State",
        "",
        "**Active Milestone:** M001: Test Milestone",
        "**Active Slice:** S01: Test Slice",
        "**Phase:** executing",
        "",
      ].join("\n"),
      "utf8",
    );

    resetRegistry();
    const result = runPreDispatchHooks("execute-task", "M001/S01/T01", "execute", base);

    assert.equal(result.action, "block");
    assert.deepEqual(result.firedHooks, ["phase-discipline-readiness-guard"]);
    assert.ok(result.issues?.some((issue) => issue.code === "plan_artifact_missing"));
  } finally {
    cleanup(base);
  }
});
