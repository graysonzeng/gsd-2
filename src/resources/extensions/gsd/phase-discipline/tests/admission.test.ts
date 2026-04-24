import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  checkPostUnitHooks,
  consumeRetryTrigger,
  getActiveHook,
  isRetryPending,
  resetHookState,
  resolveHookArtifactPath,
} from "../../post-unit-hooks.ts";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "../../phase-discipline/preset.ts";

function createProjectFixture(): { project: string; home: string } {
  const project = mkdtempSync(join(tmpdir(), "gsd-phase-admission-project-"));
  const home = mkdtempSync(join(tmpdir(), "gsd-phase-admission-home-"));
  mkdirSync(join(project, ".gsd", "milestones", "M001"), { recursive: true });
  writeFileSync(
    join(project, ".gsd", "PREFERENCES.md"),
    [
      "---",
      "version: 1",
      "milestone_profile: phase-discipline-8step",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
  return { project, home };
}

test("admission preset hook dispatches after discuss-milestone with milestone checklist prompt", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    const result = checkPostUnitHooks("discuss-milestone", "M001", project);

    assert.notEqual(result, null);
    assert.equal(result?.hookName, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission);
    assert.equal(result?.unitType, `hook/${PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission}`);
    assert.equal(result?.unitId, "M001");
    assert.match(result?.prompt ?? "", /ADMISSION-CHECKLIST\.md/);
    assert.match(result?.prompt ?? "", /\.gsd\/milestones\/M001\/ADMISSION-CHECKLIST\.md/);
    assert.match(result?.prompt ?? "", /6-8 checklist items/);
    assert.match(result?.prompt ?? "", /deliverable clarity/);
    assert.match(result?.prompt ?? "", /within 5 slices/);
    assert.match(result?.prompt ?? "", /ADMISSION-RETRY\.md/);
    assert.match(result?.prompt ?? "", /Admission Decision: needs-rework/);
    assert.match(result?.prompt ?? "", /If and only if/);
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("admission retry clears stale checklist artifact so cycle 2 can redispatch", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    const firstDispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.notEqual(firstDispatch, null);

    const checklistPath = resolveHookArtifactPath(project, "M001", "ADMISSION-CHECKLIST.md");
    const retryPath = resolveHookArtifactPath(project, "M001", "ADMISSION-RETRY.md");
    writeFileSync(checklistPath, "- [ ] Missing prerequisite\n\nAdmission Decision: needs-rework\n", "utf8");
    writeFileSync(retryPath, "Missing prerequisite before start.\n", "utf8");

    const firstCompletion = checkPostUnitHooks(firstDispatch!.unitType, firstDispatch!.unitId, project);
    assert.equal(firstCompletion, null);
    assert.equal(isRetryPending(), true);
    assert.equal(existsSync(checklistPath), false);

    assert.deepEqual(consumeRetryTrigger(), {
      unitType: "discuss-milestone",
      unitId: "M001",
      retryArtifact: "ADMISSION-RETRY.md",
    });

    rmSync(retryPath, { force: true });

    const secondDispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.notEqual(secondDispatch, null);
    assert.equal(secondDispatch?.hookName, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission);
    assert.equal(getActiveHook()?.cycle, 2);
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("admission retry stops after max_cycles is exhausted", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    const checklistPath = resolveHookArtifactPath(project, "M001", "ADMISSION-CHECKLIST.md");
    const retryPath = resolveHookArtifactPath(project, "M001", "ADMISSION-RETRY.md");

    const firstDispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.notEqual(firstDispatch, null);
    writeFileSync(checklistPath, "- [ ] Missing prerequisite\n\nAdmission Decision: needs-rework\n", "utf8");
    writeFileSync(retryPath, "Need more prep.\n", "utf8");
    assert.equal(checkPostUnitHooks(firstDispatch!.unitType, firstDispatch!.unitId, project), null);
    assert.deepEqual(consumeRetryTrigger(), {
      unitType: "discuss-milestone",
      unitId: "M001",
      retryArtifact: "ADMISSION-RETRY.md",
    });

    rmSync(retryPath, { force: true });

    const secondDispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.notEqual(secondDispatch, null);
    assert.equal(getActiveHook()?.cycle, 2);

    writeFileSync(checklistPath, "- [ ] Still blocked\n\nAdmission Decision: needs-rework\n", "utf8");
    writeFileSync(retryPath, "Still blocked.\n", "utf8");

    const secondCompletion = checkPostUnitHooks(secondDispatch!.unitType, secondDispatch!.unitId, project);
    assert.equal(secondCompletion, null);
    assert.equal(getActiveHook(), null);
    assert.equal(isRetryPending(), false);
    assert.equal(consumeRetryTrigger(), null);

    const thirdDispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.equal(thirdDispatch, null);
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("admission hook treats checklist artifact as completion without retry", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    const dispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.notEqual(dispatch, null);

    const artifactPath = resolveHookArtifactPath(project, "M001", "ADMISSION-CHECKLIST.md");
    writeFileSync(artifactPath, "- [x] Ready to start\n\nAdmission Decision: pass\n", "utf8");
    assert.ok(existsSync(artifactPath));

    const followUp = checkPostUnitHooks(dispatch!.unitType, dispatch!.unitId, project);
    assert.equal(followUp, null);
    assert.equal(getActiveHook(), null);
    assert.equal(isRetryPending(), false);
    assert.equal(consumeRetryTrigger(), null);
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("admission hook raises retry trigger when ADMISSION-RETRY artifact exists", () => {
  resetHookState();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home } = createProjectFixture();

  try {
    process.env.GSD_HOME = home;

    const dispatch = checkPostUnitHooks("discuss-milestone", "M001", project);
    assert.notEqual(dispatch, null);

    const retryPath = resolveHookArtifactPath(project, "M001", "ADMISSION-RETRY.md");
    writeFileSync(retryPath, "Missing acceptance steps before start.\n", "utf8");

    const followUp = checkPostUnitHooks(dispatch!.unitType, dispatch!.unitId, project);
    assert.equal(followUp, null);
    assert.equal(getActiveHook(), null);
    assert.equal(isRetryPending(), true);
    assert.deepEqual(consumeRetryTrigger(), {
      unitType: "discuss-milestone",
      unitId: "M001",
      retryArtifact: "ADMISSION-RETRY.md",
    });
    assert.equal(isRetryPending(), false);
  } finally {
    resetHookState();
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
