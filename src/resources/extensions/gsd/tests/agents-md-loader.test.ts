import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  MAX_CHAIN_CHARS,
  buildAgentsDocsMapPromptBlock,
  deriveTaskTypeHint,
  loadAgentsSection,
  normalizeRoutingPhrase,
  parseAgentsDocsMapContent,
  resolveDocsMapBare,
} from "../agents-md-loader.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "agents-docs-map");

function fixturePath(...parts: string[]): string {
  return join(fixturesRoot, ...parts);
}

function makeTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("normalizeRoutingPhrase strips one optional bracket pair and lowercases", () => {
  assert.equal(normalizeRoutingPhrase("[Testing]"), "testing");
  assert.equal(normalizeRoutingPhrase("frontend"), "frontend");
});

test("deriveTaskTypeHint returns null when no routing phrases exist", () => {
  assert.equal(deriveTaskTypeHint({ unitType: "execute-task", title: "Implement thing", filePaths: [] }), null);
});

test("deriveTaskTypeHint matches title / file paths against routing phrases", () => {
  const hint = deriveTaskTypeHint({
    unitType: "execute-task",
    title: "Add frontend dashboard polish",
    filePaths: ["web/app/page.tsx"],
    routingPhrases: ["testing", "frontend"],
  });
  assert.equal(hint, "frontend");
});

test("resolveDocsMapBare prefers explicit input before argv fallback", () => {
  assert.equal(resolveDocsMapBare(true), true);
  assert.equal(resolveDocsMapBare(false), false);
});

test("parseAgentsDocsMapContent parses marker-bearing AGENTS docs-map files", () => {
  const filePath = fixturePath("project-root", "AGENTS.md");
  const parsed = parseAgentsDocsMapContent(filePath, readFileSync(filePath, "utf-8"));

  assert.ok(parsed);
  assert.match(parsed!.l0, /## Identity/);
  assert.equal(parsed!.optionalSections.length, 2);
  assert.deepEqual(parsed!.rules.map((rule) => rule.phrase), ["testing", "frontend"]);
});

test("loadAgentsSection returns null for markerless roots", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("markerless-root"),
    unitType: "plan-milestone",
    title: "Markerless",
    bare: false,
  });

  assert.equal(loaded, null);
});

test("loadAgentsSection returns null when bare=true", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("project-root"),
    unitType: "plan-slice",
    title: "Testing slice",
    bare: true,
  });

  assert.equal(loaded, null);
});

test("loadAgentsSection loads L0 plus matching L1 for testing hint", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("project-root"),
    unitType: "execute-task",
    title: "Write testing coverage",
    filePaths: ["src/foo.test.ts"],
    bare: false,
  });

  assert.ok(loaded);
  assert.match(loaded!.l0, /Project-root docs-map identity/);
  assert.match(loaded!.l0, /Prefer verification-heavy, test-first execution/);
  assert.match(loaded!.l1 ?? "", /Testing addendum/);
  assert.equal(loaded!.matchedRule, "testing");
});

test("loadAgentsSection returns L0 without addendum when hint is null", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("project-root"),
    unitType: "complete-slice",
    title: "General completion",
    filePaths: ["src/server.ts"],
    bare: false,
  });

  assert.ok(loaded);
  assert.match(loaded!.l0, /Project-root docs-map identity/);
  assert.equal(loaded!.l1, null);
  assert.equal(loaded!.matchedRule, null);
});

test("ancestor chain aggregates L0 root-to-leaf and nearest matching rule wins", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("ancestor-chain", "root", "workspace", "project"),
    unitType: "execute-task",
    title: "Add testing checks",
    filePaths: ["src/foo.test.ts"],
    bare: false,
  });

  assert.ok(loaded);
  const rootIndex = loaded!.l0.indexOf("Root ancestor identity");
  const leafIndex = loaded!.l0.indexOf("Leaf project identity");
  assert.ok(rootIndex >= 0 && leafIndex > rootIndex, "L0 should aggregate root before leaf");
  assert.match(loaded!.l1 ?? "", /Leaf testing addendum/);
  assert.doesNotMatch(loaded!.l1 ?? "", /Root testing addendum/);
});

test("mixed chain skips markerless ancestors while preserving marker-bearing root and leaf", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("mixed-chain", "root", "workspace", "project"),
    unitType: "execute-task",
    title: "Add testing checks",
    filePaths: ["src/foo.test.ts"],
    bare: false,
  });

  assert.ok(loaded);
  assert.match(loaded!.l0, /Mixed-chain root identity/);
  assert.match(loaded!.l0, /Mixed-chain project identity/);
  assert.doesNotMatch(loaded!.l0, /No marker here\.|Should be skipped by docs-map parsing\./);
});

test("loadAgentsSection stops ancestor walk at repo ceiling", async () => {
  const parent = makeTempRoot("gsd-docs-map-ceiling-parent-");
  const repoRoot = join(parent, "repo-root");
  const project = join(repoRoot, "packages", "feature");
  try {
    mkdirSync(join(repoRoot, ".git"), { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(join(parent, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\nOuter identity should not load.\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nI\n`, "utf-8");
    writeFileSync(join(project, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\nRepo-local identity.\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nI\n`, "utf-8");
    mkdirSync(join(project, ".docs-map"), { recursive: true });
    writeFileSync(join(project, ".docs-map", "testing.md"), "Repo-local testing addendum.", "utf-8");

    const loaded = await loadAgentsSection({
      cwd: project,
      unitType: "execute-task",
      title: "Write testing coverage",
      filePaths: ["src/foo.test.ts"],
      bare: false,
    });

    assert.ok(loaded);
    assert.match(loaded!.l0, /Repo-local identity/);
    assert.doesNotMatch(loaded!.l0, /Outer identity should not load/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("loadAgentsSection ignores L1 paths that escape owning directory", async () => {
  const root = makeTempRoot("gsd-docs-map-jail-");
  const project = join(root, "project");
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(join(root, "outside.md"), "outside", "utf-8");
    writeFileSync(join(project, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\nJail identity.\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → ../outside.md\n\n## Invariants\n\nI\n`, "utf-8");

    const loaded = await loadAgentsSection({
      cwd: project,
      unitType: "execute-task",
      title: "Write testing coverage",
      filePaths: ["src/foo.test.ts"],
      bare: false,
    });

    assert.ok(loaded);
    assert.equal(loaded!.l1, null);
    assert.ok(loaded!.warnings.some((warning) => warning.includes("escapes owning directory")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadAgentsSection warns and truncates oversized runtime docs-map content", async () => {
  const root = makeTempRoot("gsd-docs-map-runtime-cap-");
  const leaf = join(root, "workspace", "project");
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(leaf, { recursive: true });
    const oversized = "x".repeat(5_200);
    writeFileSync(join(root, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\n${oversized}\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nI\n`, "utf-8");
    mkdirSync(join(root, ".docs-map"), { recursive: true });
    writeFileSync(join(root, ".docs-map", "testing.md"), "root testing", "utf-8");
    writeFileSync(join(leaf, "AGENTS.md"), `<!-- docs-map: v1 -->\n\n## Identity\n\n${oversized}\n\n## Constraints\n\nC\n\n## Routing Rules\n\n- **testing** → .docs-map/testing.md\n\n## Invariants\n\nI\n\n<!-- task-type: testing -->\n${"y".repeat(1_200)}\n`, "utf-8");
    mkdirSync(join(leaf, ".docs-map"), { recursive: true });
    writeFileSync(join(leaf, ".docs-map", "testing.md"), "leaf testing", "utf-8");

    const loaded = await loadAgentsSection({
      cwd: leaf,
      unitType: "execute-task",
      title: "Write testing coverage",
      filePaths: ["src/foo.test.ts"],
      bare: false,
    });

    assert.ok(loaded);
    assert.ok(loaded!.warnings.some((warning) => warning.includes("truncating prompt attachment")));
    assert.ok(loaded!.l0.length <= MAX_CHAIN_CHARS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildAgentsDocsMapPromptBlock renders addendum section only when present", async () => {
  const loaded = await loadAgentsSection({
    cwd: fixturePath("project-root"),
    unitType: "execute-task",
    title: "Write testing coverage",
    filePaths: ["src/foo.test.ts"],
    bare: false,
  });
  assert.ok(loaded);

  const withAddendum = buildAgentsDocsMapPromptBlock(loaded!);
  const withoutAddendum = buildAgentsDocsMapPromptBlock(loaded!, { includeAddendum: false });

  assert.match(withAddendum, /## AGENTS.md Context/);
  assert.match(withAddendum, /## Docs-Map Addendum/);
  assert.doesNotMatch(withoutAddendum, /## Docs-Map Addendum/);
});
