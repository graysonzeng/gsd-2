/**
 * Regression test for #3547: discuss and plan must be classified as
 * multi-turn commands in headless mode.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("headless.ts classifies discuss as multi-turn (#3547)", () => {
  const src = readFileSync(join(__dirname, "..", "headless.ts"), "utf-8");
  const multiTurnSet = src.match(/const MULTI_TURN_COMMANDS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  assert.ok(multiTurnSet, "MULTI_TURN_COMMANDS must be defined");

  const setBody = multiTurnSet![1];
  assert.ok(setBody.includes("'auto'"), "auto must be in multi-turn list");
  assert.ok(setBody.includes("'next'"), "next must be in multi-turn list");
  assert.ok(setBody.includes("'discuss'"), "discuss must be in multi-turn list");
  assert.ok(setBody.includes("'plan'"), "plan must be in multi-turn list");
  assert.ok(!setBody.includes("'new-milestone'"), "new-milestone must remain single-turn for execution_complete");

  const classificationLine = src.match(/isMultiTurnCommand\s*=\s*MULTI_TURN_COMMANDS\.has\(options\.command\)/);
  assert.ok(classificationLine, "isMultiTurnCommand must be derived from MULTI_TURN_COMMANDS");
});

test("headless.ts marks completion on timeout to avoid false unexpected-exit diagnostics", () => {
  const src = readFileSync(join(__dirname, "..", "headless.ts"), "utf-8");
  assert.match(
    src,
    /Timeout after \$\{options\.timeout \/ 1000\}s\\n`\)\s*\n\s*timedOut = true\s*\n\s*completed = true/s,
  );
});

test("headless.ts marks completion on auto max-duration timeout", () => {
  const src = readFileSync(join(__dirname, "..", "headless.ts"), "utf-8");
  assert.match(
    src,
    /Auto-mode exceeded max duration .*forcing exit\\n`\)\s*\n\s*timedOut = true\s*\n\s*completed = true/s,
  );
});

test("headless.ts marks both parent and RPC child as headless", () => {
  const src = readFileSync(join(__dirname, "..", "headless.ts"), "utf-8");
  assert.match(src, /process\.env\.GSD_HEADLESS\s*=\s*'1'/);
  assert.match(src, /clientOptions\.env\s*=/);
  assert.match(src, /GSD_HEADLESS:\s*'1'/);
});
