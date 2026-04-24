import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPhaseDisciplineVerifyFuseHook, shouldBlockMilestoneClose } from "../../phase-discipline/verify-fuse.ts";

function createBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-phase-verify-fuse-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
  return base;
}

test("shouldBlockMilestoneClose blocks only when verify_fuse_on_fail is enabled and validation failed", () => {
  const base = createBase();
  try {
    writeFileSync(
      join(base, ".gsd", "PREFERENCES.md"),
      ["---", "version: 1", "verify_fuse_on_fail: true", "---"].join("\n"),
      "utf8",
    );

    const blocked = shouldBlockMilestoneClose({
      basePath: base,
      milestoneId: "M001",
      validationPassed: false,
    });
    const passed = shouldBlockMilestoneClose({
      basePath: base,
      milestoneId: "M001",
      validationPassed: true,
    });

    assert.equal(blocked.blocked, true);
    assert.match(blocked.reason ?? "", /verify_fuse_on_fail/);
    assert.equal(passed.blocked, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("verify-fuse hook records a blocked decision without requesting retry when validate-milestone failed and verify_fuse_on_fail is enabled", async () => {
  const base = createBase();
  try {
    writeFileSync(
      join(base, ".gsd", "PREFERENCES.md"),
      ["---", "version: 1", "verify_fuse_on_fail: true", "---"].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-attention",
        "remediation_round: 0",
        "---",
        "",
        "# Validation",
        "",
        "Follow-up needed.",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "VERIFY-FUSE-RETRY.md"),
      "legacy retry marker\n",
      "utf8",
    );

    const result = await runPhaseDisciplineVerifyFuseHook({
      hookName: "phase-discipline-verify-fuse",
      triggerUnitId: "M001",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-verify-fuse",
        after: ["validate-milestone"],
        prompt: "verify",
        artifact: "VERIFY-FUSE.md",
      },
    });

    assert.equal(result.blocked, true);
    assert.equal(result.retryRequested, false);
    assert.match(readFileSync(result.artifactPath, "utf8"), /Close Blocked: yes/);
    assert.equal(existsSync(join(base, ".gsd", "milestones", "M001", "VERIFY-FUSE-RETRY.md")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("verify-fuse hook does not request retry when preference is disabled", async () => {
  const base = createBase();
  try {
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-attention",
        "remediation_round: 0",
        "---",
        "",
        "# Validation",
        "",
        "Follow-up needed.",
      ].join("\n"),
      "utf8",
    );

    const result = await runPhaseDisciplineVerifyFuseHook({
      hookName: "phase-discipline-verify-fuse",
      triggerUnitId: "M001",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-verify-fuse",
        after: ["validate-milestone"],
        prompt: "verify",
        artifact: "VERIFY-FUSE.md",
      },
    });

    assert.equal(result.blocked, false);
    assert.equal(result.retryRequested, false);
    assert.match(readFileSync(result.artifactPath, "utf8"), /Close Blocked: no/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

 test("verify-fuse hook treats missing validation verdict as unknown and non-blocking", async () => {
  const base = createBase();
  try {
    const result = await runPhaseDisciplineVerifyFuseHook({
      hookName: "phase-discipline-verify-fuse",
      triggerUnitId: "M001",
      basePath: base,
      hookConfig: {
        name: "phase-discipline-verify-fuse",
        after: ["validate-milestone"],
        prompt: "verify",
        artifact: "VERIFY-FUSE.md",
      },
    });

    assert.equal(result.blocked, false);
    assert.equal(result.retryRequested, false);
    assert.match(readFileSync(result.artifactPath, "utf8"), /Validation Verdict: unknown/);
    assert.match(readFileSync(result.artifactPath, "utf8"), /Close Blocked: no/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
 });
