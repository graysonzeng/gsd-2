import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_LOCK_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "run-lock.ts"), "utf-8");
const PHASE4_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "phases", "p4-implementation.ts"), "utf-8");
const REVIEW_HARNESS_SOURCE = readFileSync(join(__dirname, "..", "composed-lite", "review-harness.ts"), "utf-8");

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
