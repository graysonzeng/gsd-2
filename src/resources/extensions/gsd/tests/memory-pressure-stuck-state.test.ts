/**
 * Regression tests for memory pressure monitoring (#3331) and
 * stuck detection persistence (#3704) in auto/loop.ts.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const loopSource = readFileSync(join(__dirname, "..", "auto", "loop.ts"), "utf-8");

describe("memory pressure monitoring (#3331)", () => {
  test("checkMemoryPressure function exists", () => {
    assert.match(loopSource, /function checkMemoryPressure/);
  });

  test("MEMORY_PRESSURE_THRESHOLD constant is defined", () => {
    assert.match(loopSource, /MEMORY_PRESSURE_THRESHOLD\s*=\s*0\.\d+/);
  });

  test("memory check runs every MEMORY_CHECK_INTERVAL iterations", () => {
    assert.match(loopSource, /iteration\s*%\s*MEMORY_CHECK_INTERVAL\s*===\s*0/);
  });

  test("memory pressure triggers graceful stopAuto", () => {
    assert.match(loopSource, /mem\.pressured/);
    assert.match(loopSource, /Stopping gracefully to prevent OOM/);
  });
});

describe("stuck detection persistence (#3704)", () => {
  test("loadStuckState function exists", () => {
    assert.match(loopSource, /function loadStuckState/);
  });

  test("saveStuckState function exists", () => {
    assert.match(loopSource, /function saveStuckState/);
  });

  test("loopState initialized from persisted state", () => {
    assert.match(loopSource, /loadStuckState\(s\.basePath\)/);
  });

  test("stuck state saved after each iteration", () => {
    assert.match(loopSource, /saveStuckState\(s\.basePath,\s*loopState\)/);
  });

  test("stuck state file path uses runtime directory", () => {
    assert.match(loopSource, /stuck-state\.json/);
  });

  test("saveStuckState called in standard dev path as well as custom engine path (#4382)", () => {
    // Count all call-sites of saveStuckState (excluding the function definition itself).
    // After the fix, both the custom-engine path and the standard dev path must each
    // call saveStuckState so stuckRecoveryAttempts survives session restarts.
    const callMatches = loopSource.match(/saveStuckState\(s\.basePath,\s*loopState\)/g) ?? [];
    assert.ok(
      callMatches.length >= 2,
      `saveStuckState must be called in both the custom-engine path and the standard dev path ` +
      `(found ${callMatches.length} call(s) — standard path is missing its call, #4382)`,
    );
  });
});

describe("stuck-state milestone cleanup resets recovery attempts", () => {
  test("loadStuckState resets stuckRecoveryAttempts when all entries are removed by milestone cleanup", () => {
    // After milestone cleanup removes ALL recentUnits, stuckRecoveryAttempts must
    // be reset to 0 to prevent old milestone's recovery level from polluting new sessions.
    assert.match(
      loopSource,
      /filteredUnits\.length\s*===\s*0/,
      "loadStuckState must check whether all entries were removed by milestone cleanup",
    );
    // Verify that the reset is tied to the filtered result being empty
    assert.match(
      loopSource,
      /effectiveAttempts|stuckRecoveryAttempts.*filteredUnits|filteredUnits.*stuckRecoveryAttempts.*0/s,
      "stuckRecoveryAttempts must be conditionally reset when filteredUnits is empty",
    );
  });

  test("parseMilestoneFromKey extracts milestone ID from unit key", () => {
    assert.match(loopSource, /function parseMilestoneFromKey/);
    assert.match(loopSource, /\[A-Z\]/);
  });

  test("isMilestoneClosed uses isClosedStatus guard", () => {
    assert.match(loopSource, /function isMilestoneClosed/);
    assert.match(loopSource, /isClosedStatus/);
  });

  test("72h TTL constant is defined", () => {
    // Design specifies 72h TTL (was previously 24h)
    assert.match(loopSource, /STUCK_STATE_TTL_MS/);
    // Verify the value corresponds to roughly 72 hours
    assert.match(loopSource, /72\s*\*\s*60\s*\*\s*60\s*\*\s*1000|72\s*\*\s*3600\s*\*\s*1000|259[_,]?200[_,]?000/);
  });
});
