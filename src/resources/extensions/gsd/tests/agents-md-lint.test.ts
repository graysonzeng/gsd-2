import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { lintAgentsDocsMap, validateDocsMapEntry } from "../agents-md-lint.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "agents-docs-map");

function makeTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("validateDocsMapEntry enforces per-file cap", () => {
  const result = validateDocsMapEntry({
    relativePath: "AGENTS.md",
    kind: "agents-md-file",
    chars: 4001,
  });
  assert.equal(result.errors.length, 1);
});

test("validateDocsMapEntry enforces optional section cap", () => {
  const result = validateDocsMapEntry({
    relativePath: "AGENTS.md#task-type:testing",
    kind: "optional-section",
    chars: 1001,
  });
  assert.equal(result.errors.length, 1);
});

test("validateDocsMapEntry rejects AGENTS/CLAUDE L1 basenames", () => {
  const agentsResult = validateDocsMapEntry({ relativePath: "foo/AGENTS.md", kind: "l1-file", chars: 10 });
  const claudeResult = validateDocsMapEntry({ relativePath: "foo/CLAUDE.md", kind: "l1-file", chars: 10 });
  assert.equal(agentsResult.errors.length, 1);
  assert.equal(claudeResult.errors.length, 1);
});

test("lintAgentsDocsMap passes fixture tree and warns on sibling CLAUDE", async () => {
  const result = await lintAgentsDocsMap({ roots: [fixturesRoot] });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("sibling CLAUDE.md")));
});

test("lintAgentsDocsMap flags chain cap overflow", async () => {
  const root = makeTempRoot("gsd-docs-map-chain-");
  try {
    const top = join(root, "root");
    const leaf = join(top, "workspace", "project");
    mkdirSync(leaf, { recursive: true });
    const oversized = "x".repeat(5200);
    writeFileSync(join(top, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\n${oversized}\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nI\n`, "utf-8");
    mkdirSync(join(top, ".docs-map"), { recursive: true });
    writeFileSync(join(top, ".docs-map", "testing.md"), "ok", "utf-8");
    writeFileSync(join(leaf, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\n${oversized}\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nI\n`, "utf-8");
    mkdirSync(join(leaf, ".docs-map"), { recursive: true });
    writeFileSync(join(leaf, ".docs-map", "testing.md"), "ok", "utf-8");

    const result = await lintAgentsDocsMap({ roots: [root] });
    assert.ok(result.errors.some((error) => error.includes("ancestor chain")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lintAgentsDocsMap surfaces escaping routing-rule paths as warnings", async () => {
  const root = makeTempRoot("gsd-docs-map-escape-");
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "project"), { recursive: true });
    writeFileSync(join(root, "project", "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\nIdentity\n\n## Constraints\n\nConstraints\n\n## Routing Rules\n\n- **testing** → ../outside.md\n\n## Invariants\n\nInvariants\n`, "utf-8");

    const result = await lintAgentsDocsMap({ roots: [root] });
    assert.ok(result.warnings.some((warning) => warning.includes("escapes owning directory")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lintAgentsDocsMap flags oversized optional sections", async () => {
  const root = makeTempRoot("gsd-docs-map-optional-");
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\nIdentity\n\n## Constraints\n\nConstraints\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nInvariants\n\n<!-- task-type: testing -->\n${"y".repeat(1001)}\n`, "utf-8");
    mkdirSync(join(root, ".docs-map"), { recursive: true });
    writeFileSync(join(root, ".docs-map", "testing.md"), "ok", "utf-8");

    const result = await lintAgentsDocsMap({ roots: [root] });
    assert.ok(result.errors.some((error) => error.includes("#task-type:testing")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
