import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupTrackedSubagentProcesses,
  resolveSubagentTerminalResult,
  trackLiveSubagentProcess,
} from "../shared-harness/subagent-spawn.js";
import { parseSubagentTerminalResult } from "../shared-harness/subagent-terminal.js";

test("cleanupTrackedSubagentProcesses kills tracked children and clears them from the live set", () => {
  const signals: Array<string | number | undefined> = [];
  const proc = {
    kill(signal?: NodeJS.Signals | number) {
      signals.push(signal);
      return true;
    },
  };

  trackLiveSubagentProcess(proc);

  assert.equal(cleanupTrackedSubagentProcesses("SIGTERM"), 1);
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(cleanupTrackedSubagentProcesses("SIGTERM"), 0);
});

test("tracked children can be removed before cleanup to avoid stray kills", () => {
  const signals: Array<string | number | undefined> = [];
  const proc = {
    kill(signal?: NodeJS.Signals | number) {
      signals.push(signal);
      return true;
    },
  };

  const untrack = trackLiveSubagentProcess(proc);
  untrack();

  assert.equal(cleanupTrackedSubagentProcesses("SIGTERM"), 0);
  assert.deepEqual(signals, []);
});

test("parseSubagentTerminalResult preserves assistant-start metadata even when no assistant message completes", () => {
  const rawOutput = [
    JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "2026-04-22T08:03:50.905Z", cwd: "/tmp" }),
    JSON.stringify({ type: "agent_start" }),
    JSON.stringify({ type: "turn_start" }),
    JSON.stringify({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        provider: "claude-code",
        model: "claude-opus-4-6",
        stopReason: "stop",
      },
    }),
  ].join("\n");

  const result = parseSubagentTerminalResult(rawOutput);
  assert.equal(result.assistantStarted, true);
  assert.equal(result.messageUpdateCount, 0);
  assert.equal(result.toolExecutionCount, 0);
  assert.equal(result.provider, "claude-code");
  assert.equal(result.model, "claude-opus-4-6");
  assert.equal(result.outputText, "");
  assert.equal(result.errorMessage, null);
});

test("resolveSubagentTerminalResult annotates timeout failures with progress evidence", () => {
  const rawOutput = [
    JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "2026-04-22T08:03:50.905Z", cwd: "/tmp" }),
    JSON.stringify({ type: "agent_start" }),
    JSON.stringify({ type: "turn_start" }),
    JSON.stringify({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        provider: "claude-code",
        model: "claude-opus-4-6",
      },
    }),
  ].join("\n");

  const result = resolveSubagentTerminalResult({
    rawOutput,
    exitCode: 1,
    spawnErrorMessage: "subagent timed out after 180000ms",
  });

  assert.equal(result.stopReason, "error");
  assert.equal(result.provider, "claude-code");
  assert.equal(result.model, "claude-opus-4-6");
  assert.match(result.errorMessage ?? "", /subagent timed out after 180000ms/);
  assert.match(result.errorMessage ?? "", /assistant_started=yes/);
  assert.match(result.errorMessage ?? "", /message_updates=0/);
  assert.match(result.errorMessage ?? "", /tool_uses=0/);
  assert.match(result.errorMessage ?? "", /output_chars=0/);
});
