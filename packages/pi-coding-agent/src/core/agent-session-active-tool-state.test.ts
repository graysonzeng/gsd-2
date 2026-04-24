import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "packages/pi-coding-agent/src/core/agent-session.ts"), "utf-8");

test("agent-session: get_state exposes authoritative active tool tracking", () => {
	assert.match(
		source,
		/private _activeToolExecution: \{ toolCallId: string; toolName: string; args\?: Record<string, unknown> \} \| null = null;/,
		"AgentSession should track the current in-flight tool",
	);
	assert.match(
		source,
		/get activeToolExecution\(\): \{ toolCallId: string; toolName: string; args\?: Record<string, unknown> \} \| null \{/,
		"AgentSession should expose a getter for the authoritative active tool",
	);
});

test("agent-session: tool lifecycle updates the authoritative active tool snapshot", () => {
	const toolStartIdx = source.indexOf('} else if (event.type === "tool_execution_start") {');
	const toolEndIdx = source.indexOf('} else if (event.type === "tool_execution_end") {');
	const agentEndIdx = source.indexOf('} else if (event.type === "agent_end") {');
	assert.ok(toolStartIdx >= 0, "missing tool_execution_start branch");
	assert.ok(toolEndIdx >= 0, "missing tool_execution_end branch");
	assert.ok(agentEndIdx >= 0, "missing agent_end branch");
	const toolStartWindow = source.slice(toolStartIdx, toolStartIdx + 500);
	const toolEndWindow = source.slice(toolEndIdx, toolEndIdx + 500);
	const agentEndWindow = source.slice(agentEndIdx, agentEndIdx + 300);
	assert.match(
		toolStartWindow,
		/this\._activeToolExecution = \{[\s\S]*toolCallId: event\.toolCallId,[\s\S]*toolName: event\.toolName,[\s\S]*args: event\.args,[\s\S]*\}/,
		"tool_execution_start should set the authoritative active tool snapshot",
	);
	assert.match(
		toolEndWindow,
		/this\._activeToolExecution\?\.toolCallId === event\.toolCallId[\s\S]*this\._activeToolExecution = null/,
		"tool_execution_end should clear the authoritative active tool snapshot",
	);
	assert.match(
		agentEndWindow,
		/this\._activeToolExecution = null/,
		"agent_end should clear the authoritative active tool snapshot",
	);
});
