import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPreDispatchHooks } from "../../post-unit-hooks.ts";
import { resetRegistry } from "../../rule-registry.ts";
import { evaluatePhaseDisciplinePhaseGuard } from "../../phase-discipline/phase-guard.ts";

function createBase(): string {
  return mkdtempSync(join(tmpdir(), "gsd-phase-guard-"));
}

function writePreferences(base: string, extra = ""): void {
  mkdirSync(join(base, ".gsd"), { recursive: true });
  writeFileSync(
    join(base, ".gsd", "PREFERENCES.md"),
    [
      "---",
      'milestone_profile: "phase-discipline-8step"',
      extra,
      "---",
      "",
    ].filter(Boolean).join("\n"),
    "utf8",
  );
}

test("phase-guard blocks validate-milestone when no task summaries exist", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });

    const result = evaluatePhaseDisciplinePhaseGuard({
      unitType: "validate-milestone",
      unitId: "M001",
      prompt: "validate",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "error");
    assert.match(result.reason ?? "", /no task summary/i);
    assert.ok(result.issues?.some((issue) => issue.code === "missing_task_summaries" && issue.stage === "phase-guard"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("phase-guard blocks complete-milestone when validation artifact is missing", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });

    const result = evaluatePhaseDisciplinePhaseGuard({
      unitType: "complete-milestone",
      unitId: "M001",
      prompt: "complete",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "error");
    assert.match(result.reason ?? "", /validation/i);
    assert.ok(result.issues?.some((issue) => issue.code === "validation_artifact_missing"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("phase-guard warning-blocks complete-milestone when verify_fuse_on_fail is enabled", () => {
  const base = createBase();
  try {
    mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
    writePreferences(base, "verify_fuse_on_fail: true");
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-remediation",
        "---",
        "",
        "# Validation",
      ].join("\n"),
      "utf8",
    );

    const result = evaluatePhaseDisciplinePhaseGuard({
      unitType: "complete-milestone",
      unitId: "M001",
      prompt: "complete",
      basePath: base,
    });

    assert.equal(result.action, "block");
    assert.equal(result.level, "warning");
    assert.match(result.reason ?? "", /verify_fuse_on_fail/i);
    assert.ok(result.issues?.some((issue) => issue.code === "verify_fuse_blocked" && issue.level === "warning"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("phase-guard runs before profile-dispatch in preset pre-dispatch hooks", () => {
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
        "**Active Slice:** None",
        "**Phase:** validating-milestone",
        "",
      ].join("\n"),
      "utf8",
    );

    resetRegistry();
    const result = runPreDispatchHooks("validate-milestone", "M001", "validate", base);

    assert.equal(result.action, "block");
    assert.deepEqual(result.firedHooks, ["phase-discipline-phase-guard"]);
    assert.match(result.reason ?? "", /no task summary/i);
  } finally {
    resetRegistry();
    rmSync(base, { recursive: true, force: true });
  }
});
