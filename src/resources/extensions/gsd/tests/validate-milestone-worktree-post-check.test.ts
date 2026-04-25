import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runPostUnitVerification, type VerificationContext } from "../auto-verification.ts";
import { AutoSession } from "../auto/session.ts";
import {
  openDatabase,
  closeDatabase,
  insertMilestone,
  insertSlice,
} from "../gsd-db.ts";
import { invalidateAllCaches } from "../cache.ts";
import { _clearGsdRootCache } from "../paths.ts";

function makeMockCtx() {
  return {
    ui: {
      notify: mock.fn(),
      setStatus: () => {},
      setWidget: () => {},
      setFooter: () => {},
    },
    model: { id: "test-model" },
  } as any;
}

function makeMockPi() {
  return {
    sendMessage: mock.fn(),
    setModel: mock.fn(async () => true),
  } as any;
}

function makeMockSession(basePath: string, unitType: string, unitId: string): AutoSession {
  const s = new AutoSession();
  s.basePath = basePath;
  s.active = true;
  s.pendingVerificationRetry = null;
  s.currentUnit = { type: unitType, id: unitId, startedAt: Date.now() };
  return s;
}

function makeBase(): string {
  const base = join(tmpdir(), `gsd-val-worktree-${randomUUID()}`);
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
  return base;
}

test("runPostUnitVerification reads VALIDATION.md from a live milestone worktree", async (t) => {
  const base = makeBase();
  t.after(() => {
    try { closeDatabase(); } catch { /* noop */ }
    try { rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const dbPath = join(base, ".gsd", "gsd.db");
  openDatabase(dbPath);
  _clearGsdRootCache();
  invalidateAllCaches();

  insertMilestone({ id: "M001" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Slice 1", status: "complete" });

  const worktreeBase = join(base, ".gsd", "worktrees", "M001");
  const worktreeMilestoneDir = join(worktreeBase, ".gsd", "milestones", "M001");
  mkdirSync(worktreeMilestoneDir, { recursive: true });
  writeFileSync(join(worktreeBase, ".git"), `gitdir: ${join(base, ".git", "worktrees", "M001")}\n`);
  writeFileSync(
    join(worktreeMilestoneDir, "M001-VALIDATION.md"),
    [
      "---",
      "verdict: pass",
      "remediation_round: 0",
      "---",
      "",
      "# Milestone Validation: M001",
      "",
      "## Verdict Rationale",
      "worktree validation",
      "",
    ].join("\n"),
    "utf-8",
  );

  const ctx = makeMockCtx();
  const pi = makeMockPi();
  const pauseAutoMock = mock.fn(async () => {});
  const s = makeMockSession(base, "validate-milestone", "M001");

  const result = await runPostUnitVerification({ s, ctx, pi } as VerificationContext, pauseAutoMock);

  assert.equal(result, "continue");
  assert.equal(s.lastVerificationErrorCode, null);
  assert.equal(pauseAutoMock.mock.callCount(), 0);
});
