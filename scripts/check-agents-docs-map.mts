import { resolve } from "node:path";

import { lintAgentsDocsMap } from "../src/resources/extensions/gsd/agents-md-lint.ts";

const roots = [
  resolve("tests/fixtures/agents-docs-map"),
];

const result = await lintAgentsDocsMap({ roots });

for (const warning of result.warnings) {
  console.warn(`[agents-docs-map] warn: ${warning}`);
}

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`[agents-docs-map] error: ${error}`);
  }
  process.exit(1);
}

console.log(`[agents-docs-map] ok: scanned ${roots.length} root(s)`);
