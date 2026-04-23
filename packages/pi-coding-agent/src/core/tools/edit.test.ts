import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEditTool } from "./edit.js";

test("edit tool preserves unrelated unicode text when fuzzy matching the target snippet", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "edit-tool-test-"));
	t.after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const file = join(dir, "sample.ts");
	writeFileSync(file, "const title = “Hello”; // keep dash —\n", "utf-8");

	const tool = createEditTool(dir);
	await tool.execute("test-call", {
		path: "sample.ts",
		oldText: "\"Hello\"",
		newText: "\"Hi\"",
	});

	assert.equal(readFileSync(file, "utf-8"), "const title = \"Hi\"; // keep dash —\n");
});
