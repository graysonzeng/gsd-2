import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  resolveCanonicalMilestoneArtifactPath,
  resolveCanonicalMilestoneFile,
} from "../worktree-manager.ts";

function makeTmpBase(): string {
  const base = join(tmpdir(), `gsd-canon-artifact-test-${randomUUID()}`);
  mkdirSync(join(base, ".gsd", "milestones"), { recursive: true });
  return base;
}

function cleanup(base: string): void {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* noop */ }
}

function makeLiveWorktree(base: string, mid: string): string {
  const wtPath = join(base, ".gsd", "worktrees", mid);
  mkdirSync(wtPath, { recursive: true });
  writeFileSync(
    join(wtPath, ".git"),
    `gitdir: ${join(base, ".git", "worktrees", mid)}\n`,
  );
  return wtPath;
}

test("resolveCanonicalMilestoneArtifactPath points at the live worktree artifact path", () => {
  const base = makeTmpBase();
  try {
    const wtPath = makeLiveWorktree(base, "M001");
    const result = resolveCanonicalMilestoneArtifactPath(base, "M001", "VALIDATION");
    assert.equal(result, join(wtPath, ".gsd", "milestones", "M001", "M001-VALIDATION.md"));
  } finally {
    cleanup(base);
  }
});

test("resolveCanonicalMilestoneFile reads an existing artifact from the live worktree", () => {
  const base = makeTmpBase();
  try {
    const wtPath = makeLiveWorktree(base, "M001");
    const wtMilestoneDir = join(wtPath, ".gsd", "milestones", "M001");
    mkdirSync(wtMilestoneDir, { recursive: true });
    writeFileSync(join(wtMilestoneDir, "M001-VALIDATION.md"), "---\nverdict: pass\n---\n");

    const result = resolveCanonicalMilestoneFile(base, "M001", "VALIDATION");
    assert.equal(result, join(wtMilestoneDir, "M001-VALIDATION.md"));
  } finally {
    cleanup(base);
  }
});
