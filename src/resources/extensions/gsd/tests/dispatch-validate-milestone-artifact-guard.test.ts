import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DISPATCH_RULES } from "../auto-dispatch.ts";
import { openDatabase, closeDatabase, insertMilestone, insertSlice, insertAssessment } from "../gsd-db.ts";
import { VALIDATION_ERROR_CODES } from "../validation-error-codes.ts";

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "gsd-validation-guard-"));
  mkdirSync(join(repo, ".gsd", "milestones", "M001"), { recursive: true });
  openDatabase(join(repo, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001", title: "Test milestone", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Slice 1", status: "complete", depends: [] });
  return repo;
}

function teardownRepo(repo: string): void {
  try { closeDatabase(); } catch { /* noop */ }
  rmSync(repo, { recursive: true, force: true });
}

function getRule(name: string) {
  const rule = DISPATCH_RULES.find((entry) => entry.name === name);
  if (!rule) {
    throw new Error(`dispatch rule ${name} should exist`);
  }
  return rule;
}

test("validating-milestone stops on DB/file desync for VALIDATION artifact", { concurrency: false }, async (t) => {
  const repo = setupRepo();
  t.after(() => teardownRepo(repo));

  const validationPath = join(repo, ".gsd", "milestones", "M001", "M001-VALIDATION.md");
  insertAssessment({
    path: validationPath,
    milestoneId: "M001",
    sliceId: null,
    taskId: null,
    status: "pass",
    scope: "milestone-validation",
    fullContent: "---\nverdict: pass\n---\n",
  });

  const result = await getRule("validating-milestone → validate-milestone").match({
    basePath: repo,
    mid: "M001",
    midTitle: "Test milestone",
    state: { phase: "validating-milestone" } as any,
    prefs: undefined,
  } as any);

  if (!result || result.action !== "stop") {
    assert.fail(`expected stop action, got ${JSON.stringify(result)}`);
  }
  assert.match(result.reason, new RegExp(VALIDATION_ERROR_CODES.ARTIFACT_DESYNCED));
});

test("completing-milestone stops when VALIDATION artifact is missing", { concurrency: false }, async (t) => {
  const repo = setupRepo();
  t.after(() => teardownRepo(repo));

  const result = await getRule("completing-milestone → complete-milestone").match({
    basePath: repo,
    mid: "M001",
    midTitle: "Test milestone",
    state: { phase: "completing-milestone" } as any,
    prefs: undefined,
  } as any);

  if (!result || result.action !== "stop") {
    assert.fail(`expected stop action, got ${JSON.stringify(result)}`);
  }
  assert.match(result.reason, new RegExp(VALIDATION_ERROR_CODES.ARTIFACT_MISSING));
});

test("completing-milestone stops when VALIDATION verdict is invalid", { concurrency: false }, async (t) => {
  const repo = setupRepo();
  t.after(() => teardownRepo(repo));

  writeFileSync(
    join(repo, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
    "---\nverdict: maybe\nremediation_round: 0\n---\n",
  );

  const result = await getRule("completing-milestone → complete-milestone").match({
    basePath: repo,
    mid: "M001",
    midTitle: "Test milestone",
    state: { phase: "completing-milestone" } as any,
    prefs: undefined,
  } as any);

  if (!result || result.action !== "stop") {
    assert.fail(`expected stop action, got ${JSON.stringify(result)}`);
  }
  assert.match(result.reason, new RegExp(VALIDATION_ERROR_CODES.VERDICT_INVALID));
});
