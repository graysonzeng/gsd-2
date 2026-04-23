import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runComposedLite } from "../composed-lite/runner.js";
import { loadState } from "../composed-lite/state.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-composed-lite-runner-"));
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, ".gitignore"), ".gsd/\n", "utf-8");
  writeFileSync(join(dir, "README.md"), "hello\n", "utf-8");
  execSync("git add README.md .gitignore", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m init", { cwd: dir, stdio: "ignore" });
  return dir;
}

function makeRequestContext() {
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses: Array<{ key: string; message: string }> = [];

  return {
    ctx: {
      ui: {
        notify(message: string, level?: string) {
          notifications.push({ message, level });
        },
        setStatus(key: string, message: string) {
          statuses.push({ key, message });
        },
      },
    },
    notifications,
    statuses,
  };
}

test("runComposedLite closes top-level runtime status after a non-fuse phase failure", async () => {
  const projectRoot = makeRepo();
  const originalBin = process.env.GSD_BIN_PATH;
  const { ctx, notifications } = makeRequestContext();

  process.env.GSD_BIN_PATH = join(projectRoot, "missing-loader.js");

  try {
    await runComposedLite({
      projectRoot,
      requirement: "Reproduce non-fuse research failure status cleanup",
      mode: "full",
      source: "workflow-start",
      admissionAction: "approve",
      carryForwardReviewAction: null,
      ctx: ctx as any,
      pi: {} as any,
    });

    const state = loadState(projectRoot);
    assert.ok(state, "state should be persisted after the failed run");
    assert.equal(state?.phases[1].status, "failed", "phase 1 should fail when scout subagents cannot start");
    assert.equal(state?.status, "failed", "top-level status should close as failed after a non-fuse phase failure");

    const marker = JSON.parse(readFileSync(join(projectRoot, ".gsd", "STATE.json"), "utf-8"));
    assert.equal(marker.status, state?.status, "STATE.json should mirror the persisted top-level status");

    assert.ok(
      notifications.some(({ message }) => message.includes("stopped at phase 1 (research) after a non-fuse failure")),
      "runner should surface the non-fuse failure stop message",
    );
  } finally {
    if (originalBin == null) {
      delete process.env.GSD_BIN_PATH;
    } else {
      process.env.GSD_BIN_PATH = originalBin;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("runComposedLite can explicitly resume a failed run without requiring a new requirement", async () => {
  const projectRoot = makeRepo();
  const originalBin = process.env.GSD_BIN_PATH;
  const first = makeRequestContext();
  const resumed = makeRequestContext();

  process.env.GSD_BIN_PATH = join(projectRoot, "missing-loader.js");

  try {
    await runComposedLite({
      projectRoot,
      requirement: "Reproduce failed-run resume path",
      mode: "full",
      source: "workflow-start",
      admissionAction: "approve",
      carryForwardReviewAction: null,
      ctx: first.ctx as any,
      pi: {} as any,
    });

    const failedState = loadState(projectRoot);
    assert.equal(failedState?.status, "failed", "setup run should stop in failed status");

    await runComposedLite({
      projectRoot,
      requirement: "",
      mode: "full",
      source: "resume",
      admissionAction: null,
      carryForwardReviewAction: null,
      ctx: resumed.ctx as any,
      pi: {} as any,
    });

    assert.ok(
      resumed.notifications.some(({ message }) => message.includes("Resuming composed-lite run")),
      "explicit resume should reuse the failed run instead of requiring a fresh requirement",
    );
    assert.ok(
      resumed.notifications.every(({ message }) => !message.includes("composed-lite requires a requirement description")),
      "resume of a failed run should not hit the missing requirement guard",
    );
  } finally {
    if (originalBin == null) {
      delete process.env.GSD_BIN_PATH;
    } else {
      process.env.GSD_BIN_PATH = originalBin;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
