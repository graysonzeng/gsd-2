import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReadTool, type ReadOperations } from "./read.js";

function textOps(files: Record<string, string>): ReadOperations {
	return {
		readFile: async (absolutePath) => Buffer.from(files[absolutePath] ?? "", "utf-8"),
		access: async (absolutePath) => {
			if (!(absolutePath in files)) throw new Error(`ENOENT: ${absolutePath}`);
		},
		detectImageMimeType: async () => null,
	};
}

describe("read tool runtime log guard", () => {
	it("does not inline .gsd/runtime ndjson logs without offset or limit", async () => {
		const cwd = "/repo";
		const logPath = "/repo/.gsd/runtime/headless-auto.ndjson";
		const tool = createReadTool(cwd, {
			operations: textOps({
				[logPath]: Array.from({ length: 100 }, (_, i) => JSON.stringify({ type: "event", i })).join("\n"),
			}),
		});

		const result = await tool.execute("call-1", { path: ".gsd/runtime/headless-auto.ndjson" });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		assert.match(text, /Runtime log read blocked/);
		assert.match(text, /Use offset\/limit/);
		assert.doesNotMatch(text, /"type":"event"/);
	});

	it("allows explicit offset and limit for .gsd/runtime ndjson logs", async () => {
		const cwd = "/repo";
		const logPath = "/repo/.gsd/runtime/headless-auto.ndjson";
		const tool = createReadTool(cwd, {
			operations: textOps({
				[logPath]: ["line1", "line2", "line3"].join("\n"),
			}),
		});

		const result = await tool.execute("call-1", { path: ".gsd/runtime/headless-auto.ndjson", offset: 2, limit: 1 });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		assert.match(text, /line2/);
		assert.doesNotMatch(text, /Runtime log read blocked/);
	});
});
