/**
 * composed-lite/run-lock.ts — PID-based run lock to prevent concurrent runtimes.
 *
 * Contract C10: Run lock, single executor.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { RUN_LOCK_PATH } from "./types.js";

interface LockData {
  pid: number;
  host: string;
  started_at: string;
  run_id: string;
}

function lockPath(projectRoot: string): string {
  return join(projectRoot, RUN_LOCK_PATH);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the run lock. Throws if another live process holds it.
 */
export function acquireLock(projectRoot: string, runId: string): void {
  const lp = lockPath(projectRoot);

  if (existsSync(lp)) {
    try {
      const existing: LockData = JSON.parse(readFileSync(lp, "utf-8"));
      if (existing.host === hostname() && isPidAlive(existing.pid)) {
        throw new Error(
          `Another composed-lite runtime (PID ${existing.pid}, run ${existing.run_id}) is already active. ` +
          `Kill it first or wait for it to finish.`
        );
      }
      // Stale lock — overwrite
    } catch (err) {
      if (err instanceof Error && err.message.includes("Another composed-lite")) {
        throw err;
      }
      // Corrupted lock file — overwrite
    }
  }

  const lock: LockData = {
    pid: process.pid,
    host: hostname(),
    started_at: new Date().toISOString(),
    run_id: runId,
  };
  writeFileSync(lp, JSON.stringify(lock, null, 2) + "\n");
}

/**
 * Release the run lock.
 */
export function releaseLock(projectRoot: string): void {
  const lp = lockPath(projectRoot);
  try {
    if (existsSync(lp)) {
      unlinkSync(lp);
    }
  } catch {
    // Non-fatal
  }
}
