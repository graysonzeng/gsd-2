import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_LOCK_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "run-lock.ts"), "utf-8");
const COMPOSED_LITE_INDEX_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "index.ts"), "utf-8");
const PHASE0_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p0-admission.ts"), "utf-8");
const PHASE4_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p4-implementation.ts"), "utf-8");
const RUNNER_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "runner.ts"), "utf-8");
const REVIEW_HARNESS_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "review-harness.ts"), "utf-8");
const START_DISPATCH_SOURCE = readFileSync(join(__dirname, "..", "commands-workflow-templates.ts"), "utf-8");
const WORKFLOW_DISPATCH_SOURCE = readFileSync(join(__dirname, "..", "commands", "handlers", "workflow.ts"), "utf-8");

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-composed-lite-"));
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, ".gitignore"), ".gsd/\n", "utf-8");
  writeFileSync(join(dir, "README.md"), "hello\n", "utf-8");
  execSync("git add README.md .gitignore", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m init", { cwd: dir, stdio: "ignore" });
  return dir;
}

test("run-lock allows only same-run reacquire or pending-to-real upgrade for the same process", () => {
  assert.match(RUN_LOCK_SOURCE, /const sameRun = existing\.run_id === runId/);
  assert.match(RUN_LOCK_SOURCE, /const pendingUpgrade = existing\.run_id === "pending"/);
  assert.match(RUN_LOCK_SOURCE, /!sameProcess \|\| \(!sameRun && !pendingUpgrade\)/);
});

test("composed-lite dispatch arg parser strips plan and admission flags consistently", () => {
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /export function parseComposedLiteDispatchArgs/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /mode: isPlan \? "plan" : "full"/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /admissionAction: hasReject \? "reject" : hasApprove \? "approve" : null/);
  assert.match(COMPOSED_LITE_INDEX_SOURCE, /replace\(/);
});

test("Phase 0 admission waits for explicit approval and supports reject", () => {
  assert.match(PHASE0_SOURCE, /state\.admission\.state = "awaiting_approval"/);
  assert.match(PHASE0_SOURCE, /if \(admissionAction === "reject"\)/);
  assert.match(PHASE0_SOURCE, /if \(admissionAction !== "approve"\)/);
  assert.match(PHASE0_SOURCE, /throw new AdmissionPendingSignal/);
  assert.match(PHASE0_SOURCE, /approved_by = "explicit-user"/);
  assert.doesNotMatch(PHASE0_SOURCE, /Auto-approved \(MVP\)/);
});

test("runner pauses cleanly on admission pending and allows active-run resume without a fresh requirement", () => {
  assert.match(RUNNER_SOURCE, /const canResumeActiveRun = Boolean\(existing && existing\.status === "active"\)/);
  assert.match(RUNNER_SOURCE, /if \(!req\.requirement\.trim\(\) && !canResumeActiveRun\)/);
  assert.match(RUNNER_SOURCE, /if \(err instanceof AdmissionPendingSignal\)/);
  assert.match(RUNNER_SOURCE, /outcome: "pending_approval"/);
  assert.match(RUNNER_SOURCE, /Re-run with --approve or --reject/);
});

test("both composed-lite dispatch entrypoints forward parsed admission flags", () => {
  assert.match(START_DISPATCH_SOURCE, /parseComposedLiteDispatchArgs\(description\)/);
  assert.match(START_DISPATCH_SOURCE, /admissionAction: parsed\.admissionAction/);
  assert.match(WORKFLOW_DISPATCH_SOURCE, /parseComposedLiteDispatchArgs\(args\)/);
  assert.match(WORKFLOW_DISPATCH_SOURCE, /admissionAction: parsed\.admissionAction/);
});

test("/gsd start resume recognizes the runtime-owned composed-lite STATE marker", () => {
  assert.match(START_DISPATCH_SOURCE, /interface RuntimeOwnedStateMarker/);
  assert.match(START_DISPATCH_SOURCE, /function readRuntimeOwnedStateMarker/);
  assert.match(START_DISPATCH_SOURCE, /parsed\.type === "runtime-owned" && parsed\.runtime === "composed-lite"/);
  assert.match(START_DISPATCH_SOURCE, /if \(runtimeMarker\?\.status === "active"\)/);
  assert.match(START_DISPATCH_SOURCE, /source: "resume"/);
});

test("Phase 4 reruns implementation round-by-round before each follow-up review", () => {
  const roundLoop = PHASE4_SOURCE.indexOf("for (let round = 0; round <= MAX_REVISION_ROUNDS; round++)");
  const executeRound = PHASE4_SOURCE.indexOf("const summary = await executeImplementationRound");
  const reviewCall = PHASE4_SOURCE.indexOf("const reviewResult = await runReview");
  assert.ok(roundLoop >= 0, "Phase 4 must iterate over revision rounds");
  assert.ok(executeRound >= 0, "Phase 4 must execute an implementation round");
  assert.ok(reviewCall >= 0, "Phase 4 must run review after each implementation round");
  assert.ok(executeRound < reviewCall, "Implementation must run before the follow-up review in each round");
  assert.match(PHASE4_SOURCE, /reviewFeedback = reviewResult/);
  assert.match(PHASE4_SOURCE, /Re-running implementation for revision round/);
});

test("Phase 4 worker tasks include review feedback, round-aware raw logs, and restore implementation-summary on pass", () => {
  assert.match(PHASE4_SOURCE, /Code review findings to address before continuing:/);
  assert.match(PHASE4_SOURCE, /worker-step-\$\{i\}-r\$\{round\}/);
  assert.match(PHASE4_SOURCE, /path: "implementation-summary"/);
  assert.match(PHASE4_SOURCE, /Revision round: \$\{round\}/);
});

test("Phase 4 diff detection uses working tree diff, normalizes rename paths, and ignores .gsd runtime files", () => {
  assert.match(PHASE4_SOURCE, /function normalizeGitPath/);
  assert.match(PHASE4_SOURCE, /function isRelevantPath/);
  assert.match(PHASE4_SOURCE, /git diff --numstat \$\{baselineSha\}/);
  assert.match(PHASE4_SOURCE, /filePath !== "\.gsd" && !filePath\.startsWith\("\.gsd\/"\)/);
});

test("review-harness records parsed_ok truthfully and stores the actual raw log path", () => {
  assert.match(REVIEW_HARNESS_SOURCE, /parsed_ok: Boolean\(result\)/);
  assert.match(REVIEW_HARNESS_SOURCE, /rawLogRelPath = `logs\/raw\/\$\{phase\}-\$\{state\.phases\[phase\]\.attempt\}-reviewer-\$\{attempt\}\.jsonl`/);
  assert.doesNotMatch(REVIEW_HARNESS_SOURCE, /reviewer-final/);
});

test("baseline-to-HEAD diff misses working tree edits while baseline working tree diff sees them", () => {
  const repo = makeRepo();
  try {
    const baselineSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
    writeFileSync(join(repo, "README.md"), "hello\nworld\n", "utf-8");
    writeFileSync(join(repo, "new-file.ts"), "export const value = 1;\n", "utf-8");
    writeFileSync(join(repo, ".gsd-ignore-check"), "not ignored\n", "utf-8");

    const oldDiff = execSync(`git diff --numstat ${baselineSha}..HEAD`, { cwd: repo, encoding: "utf-8" }).trim();
    const workingTreeDiff = execSync(`git diff --numstat ${baselineSha}`, { cwd: repo, encoding: "utf-8" }).trim();
    const statusOutput = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8" }).trim();

    assert.equal(oldDiff, "", "HEAD range diff should miss uncommitted changes");
    assert.match(workingTreeDiff, /README\.md/);
    assert.match(statusOutput, /\?\? new-file\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
