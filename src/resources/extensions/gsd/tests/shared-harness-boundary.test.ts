import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "shared-harness");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts"));

test("shared-harness files do not import composed-lite or phase-discipline", () => {
  for (const name of FILES) {
    const source = readFileSync(join(DIR, name), "utf-8");
    assert.doesNotMatch(source, /from\s+[\"']\.\.\/composed-lite\//, `${name} must not import composed-lite`);
    assert.doesNotMatch(source, /from\s+[\"']\.\.\/phase-discipline\//, `${name} must not import phase-discipline`);
    assert.doesNotMatch(source, /import\(\s*[\"']\.\.\/composed-lite\//, `${name} must not dynamically import composed-lite`);
    assert.doesNotMatch(source, /import\(\s*[\"']\.\.\/phase-discipline\//, `${name} must not dynamically import phase-discipline`);
  }
});
