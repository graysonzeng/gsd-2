/**
 * Regression test for #2675: completing-milestone dispatch rule must
 * block completion when VALIDATION verdict is "needs-remediation".
 *
 * Without this guard, needs-remediation + allSlicesDone causes a loop:
 * complete-milestone dispatched → agent refuses (correct) → no SUMMARY
 * → re-dispatch → repeat until stuck detection fires.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DISPATCH_RULES } from "../auto-dispatch.ts";

/** Find the completing-milestone dispatch rule */
const completingRule = DISPATCH_RULES.find(r => r.name === "completing-milestone → complete-milestone");

test("completing-milestone dispatch rule exists", () => {
  assert.ok(completingRule, "rule should exist in DISPATCH_RULES");
});

test("completing-milestone blocks when VALIDATION verdict is needs-remediation (#2675)", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-remediation-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });

  try {
    // Write a VALIDATION file with needs-remediation verdict
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-remediation",
        "remediation_round: 0",
        "---",
        "",
        "# Validation Report",
        "",
        "3 success criteria failed. Remediation required.",
      ].join("\n"),
    );

    const ctx = {
      mid: "M001",
      midTitle: "Test Milestone",
      basePath: base,
      state: { phase: "completing-milestone" } as any,
      prefs: {} as any,
      session: undefined,
    };

    const result = await completingRule!.match(ctx);

    assert.ok(result !== null, "rule should match");
    assert.equal(result!.action, "stop", "should return stop action");
    if (result!.action === "stop") {
      assert.equal(result!.level, "warning", "should be warning level (pausable)");
      assert.ok(
        result!.reason.includes("needs-remediation"),
        "reason should mention needs-remediation",
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("completing-milestone blocks needs-attention when verify_fuse_on_fail is enabled", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-remediation-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
  mkdirSync(join(base, ".gsd"), { recursive: true });

  try {
    writeFileSync(
      join(base, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "version: 1",
        "verify_fuse_on_fail: true",
        "---",
      ].join("\n"),
    );
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-attention",
        "remediation_round: 0",
        "---",
        "",
        "# Validation Report",
        "",
        "Manual follow-up required.",
      ].join("\n"),
    );

    const ctx = {
      mid: "M001",
      midTitle: "Test Milestone",
      basePath: base,
      state: { phase: "completing-milestone" } as any,
      prefs: {} as any,
      session: undefined,
    };

    const result = await completingRule!.match(ctx);

    assert.ok(result !== null, "rule should match");
    assert.equal(result!.action, "stop", "should return stop action");
    if (result!.action === "stop") {
      assert.match(result.reason, /verify_fuse_on_fail/i);
      assert.match(result.reason, /did not pass/i);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("verify_fuse_on_fail takes priority over needs-remediation fallback", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-remediation-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });
  mkdirSync(join(base, ".gsd"), { recursive: true });

  try {
    writeFileSync(
      join(base, ".gsd", "PREFERENCES.md"),
      [
        "---",
        "version: 1",
        "verify_fuse_on_fail: true",
        "---",
      ].join("\n"),
    );
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-remediation",
        "remediation_round: 0",
        "---",
        "",
        "# Validation Report",
        "",
        "Remediation required.",
      ].join("\n"),
    );

    const ctx = {
      mid: "M001",
      midTitle: "Test Milestone",
      basePath: base,
      state: { phase: "completing-milestone" } as any,
      prefs: {} as any,
      session: undefined,
    };

    const result = await completingRule!.match(ctx);

    assert.ok(result !== null, "rule should match");
    assert.equal(result!.action, "stop", "should return stop action");
    if (result!.action === "stop") {
      assert.match(result.reason, /verify_fuse_on_fail/i);
      assert.doesNotMatch(result.reason, /Address the remediation findings and re-run validation/i);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("completing-milestone does not block needs-attention by default", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-remediation-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });

  try {
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: needs-attention",
        "remediation_round: 0",
        "---",
        "",
        "# Validation Report",
        "",
        "Manual follow-up required.",
      ].join("\n"),
    );

    const ctx = {
      mid: "M001",
      midTitle: "Test Milestone",
      basePath: base,
      state: { phase: "completing-milestone" } as any,
      prefs: {} as any,
      session: undefined,
    };

    const result = await completingRule!.match(ctx);

    if (result && result.action === "stop") {
      assert.ok(
        !/verify_fuse_on_fail/i.test(result.reason),
        "default needs-attention path should not be blocked by verify-fuse",
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("completing-milestone proceeds normally when VALIDATION verdict is pass (#2675 guard)", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-remediation-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001"), { recursive: true });

  try {
    // Write a VALIDATION file with pass verdict
    writeFileSync(
      join(base, ".gsd", "milestones", "M001", "M001-VALIDATION.md"),
      [
        "---",
        "verdict: pass",
        "---",
        "",
        "# Validation Report",
        "",
        "All criteria met.",
      ].join("\n"),
    );

    const ctx = {
      mid: "M001",
      midTitle: "Test Milestone",
      basePath: base,
      state: { phase: "completing-milestone" } as any,
      prefs: {} as any,
      session: undefined,
    };

    const result = await completingRule!.match(ctx);

    // Should NOT return a stop — should either dispatch or return stop for
    // a different reason (e.g. missing SUMMARY files, no implementation)
    if (result && result.action === "stop") {
      assert.ok(
        !result.reason.includes("needs-remediation"),
        "pass verdict should NOT trigger the remediation guard",
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
