/**
 * composed-lite/resolve-bin.ts — Resolve the GSD CLI binary path.
 *
 * Mirrors the approach in parallel-orchestrator.ts: prefer GSD_BIN_PATH env var,
 * fall back to finding loader.js relative to this module.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the GSD CLI binary (loader.js) path.
 * Returns null if not found — callers should fuse or error.
 */
export function resolveGsdBin(): string | null {
  // GSD_BIN_PATH is set by loader.ts to the absolute path of dist/loader.js
  if (process.env.GSD_BIN_PATH && existsSync(process.env.GSD_BIN_PATH)) {
    return process.env.GSD_BIN_PATH;
  }

  // Fallback: try to find loader.js relative to this file.
  // This file is at dist/resources/extensions/gsd/composed-lite/resolve-bin.js
  // loader.js is at dist/loader.js
  let thisDir: string;
  try {
    thisDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }

  const candidates = [
    join(thisDir, "..", "..", "..", "..", "loader.js"),
    join(thisDir, "..", "..", "..", "..", "..", "dist", "loader.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
