import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { evaluatePhaseDisciplineProfileDispatch } from "../../phase-discipline/profile-dispatch.ts";

function createBase(): string {
  return mkdtempSync(join(tmpdir(), "gsd-phase-dispatch-"));
}

test("profile-dispatch advises plan-slice when execute-task is chosen before an active slice plan exists", () => {
  const base = createBase();
  try {
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

    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "do the task",
      basePath: base,
    });

    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "plan-slice");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("profile-dispatch advises execute-task when validate-milestone is chosen with no task summaries", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
    writeFileSync(
      join(base, ".gsd", "STATE.md"),
      [
        "# GSD State",
        "",
        "**Active Milestone:** M001: Test Milestone",
        "**Active Slice:** None",
        "**Phase:** validating-milestone",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "validate-milestone",
      unitId: "M001",
      prompt: "validate",
      basePath: base,
    });

    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "execute-task");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("profile-dispatch advises plan-slice when execute-task is chosen before impl-plan validation artifact exists", () => {
  const base = createBase();
  try {
    const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
    mkdirSync(join(sliceDir, "tasks"), { recursive: true });
    writeFileSync(join(sliceDir, "S01-PLAN.md"), "# S01: Test Slice\n", "utf8");
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

    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "do the task",
      basePath: base,
    });

    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "plan-slice");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("profile-dispatch advises plan-slice when impl-plan validation artifact exists but recorded Result: fail", () => {
  const base = createBase();
  try {
    const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
    mkdirSync(join(sliceDir, "tasks"), { recursive: true });
    writeFileSync(join(sliceDir, "S01-PLAN.md"), "# S01: Test Slice\n", "utf8");
    writeFileSync(
      join(sliceDir, "IMPL-PLAN-VALIDATION.md"),
      [
        "# phase-discipline-impl-plan-validator",
        "",
        "- Trigger: plan-slice M001/S01",
        "- Result: fail",
      ].join("\n"),
      "utf8",
    );
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

    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "do the task",
      basePath: base,
    });

    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "plan-slice");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("profile-dispatch proceeds with execute-task once impl-plan validation artifact exists", () => {
  const base = createBase();
  try {
    const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
    mkdirSync(join(sliceDir, "tasks"), { recursive: true });
    writeFileSync(join(sliceDir, "S01-PLAN.md"), "# S01: Test Slice\n", "utf8");
    writeFileSync(
      join(sliceDir, "IMPL-PLAN-VALIDATION.md"),
      [
        "# phase-discipline-impl-plan-validator",
        "",
        "- Trigger: plan-slice M001/S01",
        "- Result: pass",
      ].join("\n"),
      "utf8",
    );
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

    const result = evaluatePhaseDisciplineProfileDispatch({
      unitType: "execute-task",
      unitId: "M001/S01/T01",
      prompt: "do the task",
      basePath: base,
    });

    assert.equal(result.action, "proceed");
    assert.equal(result.prompt, "do the task");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
