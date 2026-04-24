import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DISPATCH_RULES, resolveDispatch, type DispatchContext } from "../resources/extensions/gsd/auto-dispatch.ts";
import { resolvePostUnitHooks, resolvePreDispatchHooks } from "../resources/extensions/gsd/preferences.ts";
import { convertDispatchRules, initRegistry, resetRegistry, RuleRegistry } from "../resources/extensions/gsd/rule-registry.ts";
import { resetHookState } from "../resources/extensions/gsd/post-unit-hooks.ts";
import type { GSDState } from "../resources/extensions/gsd/types.ts";

function makeProject(prefix: string): { project: string; home: string; cleanup: () => void } {
  const project = mkdtempSync(join(tmpdir(), `${prefix}-project-`));
  const home = mkdtempSync(join(tmpdir(), `${prefix}-home-`));
  mkdirSync(join(project, ".gsd"), { recursive: true });
  return {
    project,
    home,
    cleanup: () => {
      rmSync(project, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("phase-discipline preset reaches the real hook resolvers with builtin markers intact", () => {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home, cleanup } = makeProject("gsd-phase-integration");

  try {
    writeFileSync(
      join(project, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "version: 1",
        "milestone_profile: phase-discipline-8step",
        "---",
      ].join("\n"),
      "utf8",
    );

    process.env.GSD_HOME = home;
    process.chdir(project);

    const post = resolvePostUnitHooks(project);
    const pre = resolvePreDispatchHooks(project);

    assert.equal(post.length, 3);
    assert.equal(pre.length, 1);
    assert.equal(post[0]?.name, "phase-discipline-code-review");
    assert.equal(post[0]?.builtin, "phase-discipline-code-review");
    assert.equal(post[1]?.builtin, "phase-discipline-design-review");
    assert.equal(pre[0]?.name, "phase-discipline-profile-dispatch");
    assert.equal(pre[0]?.builtin, "phase-discipline-profile-dispatch");
  } finally {
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    cleanup();
  }
});

test("phase-discipline advice can redirect real dispatch resolution to plan-slice", async () => {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home, cleanup } = makeProject("gsd-phase-dispatch-chain");

  try {
    mkdirSync(join(project, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
    writeFileSync(
      join(project, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "version: 1",
        "milestone_profile: phase-discipline-8step",
        "---",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(project, ".gsd", "STATE.md"),
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

    process.env.GSD_HOME = home;
    process.chdir(project);
    resetRegistry();
    resetHookState();
    initRegistry(convertDispatchRules(DISPATCH_RULES));

    const registry = new RuleRegistry([]);
    const pre = registry.evaluatePreDispatch("execute-task", "M001/S01/T01", "prompt", project);
    assert.equal(pre.action, "advise");
    if (pre.action !== "advise") throw new Error("expected advise result");
    assert.equal(pre.advisedUnitType, "plan-slice");

    const state: GSDState = {
      phase: "planning" as any,
      activeMilestone: { id: "M001", title: "Test Milestone", status: "active" } as any,
      activeSlice: { id: "S01", title: "Test Slice" } as any,
      activeTask: null,
      recentDecisions: [],
      blockers: [],
      nextAction: "",
      registry: [{ id: "M001", status: "active" }] as any,
    };

    const dispatch = await resolveDispatch({
      basePath: project,
      mid: "M001",
      midTitle: "Test Milestone",
      state,
      prefs: undefined,
      advisedUnit: { unitType: pre.advisedUnitType!, unitId: "M001/S01" },
    } as DispatchContext);

    assert.equal(dispatch.action, "dispatch");
    if (dispatch.action === "dispatch") {
      assert.equal(dispatch.unitType, "plan-slice");
      assert.equal(dispatch.unitId, "M001/S01");
      assert.equal(dispatch.matchedRule, "honour-phase-discipline-advice");
    }
  } finally {
    resetRegistry();
    resetHookState();
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    cleanup();
  }
});

test("shadowed same-name pre-dispatch hook uses generic advise path instead of builtin phase-dispatch runtime", () => {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const { project, home, cleanup } = makeProject("gsd-phase-shadow");

  try {
    writeFileSync(
      join(project, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "version: 1",
        "milestone_profile: phase-discipline-8step",
        "pre_dispatch_hooks:",
        "  - name: phase-discipline-profile-dispatch",
        "    before:",
        "      - execute-task",
        "    action: advise",
        "    unit_type: refine-slice",
        "---",
      ].join("\n"),
      "utf8",
    );

    process.env.GSD_HOME = home;
    process.chdir(project);
    resetRegistry();
    resetHookState();

    const registry = new RuleRegistry([]);
    const result = registry.evaluatePreDispatch("execute-task", "M001/S01/T01", "prompt", project);

    assert.equal(result.action, "advise");
    assert.equal(result.advisedUnitType, "refine-slice");
    assert.deepEqual(result.firedHooks, ["phase-discipline-profile-dispatch"]);
  } finally {
    resetRegistry();
    resetHookState();
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    cleanup();
  }
});
