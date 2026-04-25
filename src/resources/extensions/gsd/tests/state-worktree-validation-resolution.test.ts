import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { deriveState } from "../state.ts";
import { invalidateStateCache } from "../state.ts";
import { clearPathCache, _clearGsdRootCache } from "../paths.ts";
import { clearParseCache } from "../files.ts";

function createFixtureBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-state-worktree-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
  return base;
}

function cleanup(base: string): void {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
}

test("deriveState sees terminal VALIDATION from a live milestone worktree", async () => {
  const base = createFixtureBase();
  try {
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"),
      [
        "# M001: Worktree Validation",
        "",
        "**Vision:** Test canonical validation reads.",
        "",
        "## Slices",
        "",
        "- [x] **S01: Done slice** `risk:low` `depends:[]`",
        "  > Completed.",
        "",
      ].join("\n"),
      "utf-8",
    );

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
        "# Validation",
        "Passed.",
        "",
      ].join("\n"),
      "utf-8",
    );

    clearPathCache();
    _clearGsdRootCache();
    clearParseCache();
    invalidateStateCache();

    const state = await deriveState(base);

    assert.equal(state.phase, "completing-milestone");
    assert.equal(state.activeMilestone?.id, "M001");
  } finally {
    cleanup(base);
  }
});
