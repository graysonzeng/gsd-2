/**
 * composed-lite/artifacts.ts — ArtifactEnvelope write/verify/hash.
 *
 * Contract C7: All artifacts must go through writeArtifact with valid envelopes.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import {
  ARTIFACTS_DIR,
  ARTIFACT_PATHS,
  type ArtifactEnvelope,
  type ArtifactKind,
} from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

function artifactFilePath(projectRoot: string, kind: ArtifactKind): string {
  return join(projectRoot, ARTIFACTS_DIR, ARTIFACT_PATHS[kind]);
}

function isMarkdown(kind: ArtifactKind): boolean {
  return kind === "design-doc" || kind === "implementation-summary" || kind === "verification-report";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Write an artifact with its envelope. Computes output_hash and created_at.
 * Returns the complete envelope.
 */
export function writeArtifact(
  projectRoot: string,
  kind: ArtifactKind,
  body: string,
  partialEnvelope: Omit<ArtifactEnvelope, "output_hash" | "created_at">,
): ArtifactEnvelope {
  const outputHash = sha256(body);
  const createdAt = new Date().toISOString();

  const envelope: ArtifactEnvelope = {
    ...partialEnvelope,
    output_hash: outputHash,
    created_at: createdAt,
  };

  const filePath = artifactFilePath(projectRoot, kind);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let content: string;
  if (isMarkdown(kind)) {
    // For markdown files, embed envelope as HTML comment
    const envelopeJson = JSON.stringify(envelope, null, 2);
    content = `<!-- envelope:\n${envelopeJson}\n-->\n\n${body}`;
  } else {
    // For YAML files, embed envelope as frontmatter-style header
    const envelopeYaml = yamlStringify({ _envelope: envelope });
    content = `${envelopeYaml}---\n${body}`;
  }

  writeFileSync(filePath, content);
  return envelope;
}

/**
 * Read an artifact and parse its envelope.
 */
export function readArtifact(
  projectRoot: string,
  kind: ArtifactKind,
): { envelope: ArtifactEnvelope; body: string } | null {
  const filePath = artifactFilePath(projectRoot, kind);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");

  if (isMarkdown(kind)) {
    // Parse HTML comment envelope
    const match = content.match(/^<!-- envelope:\n([\s\S]*?)\n-->\n\n([\s\S]*)$/);
    if (!match) return null;
    try {
      const envelope = JSON.parse(match[1]) as ArtifactEnvelope;
      return { envelope, body: match[2] };
    } catch {
      return null;
    }
  } else {
    // Parse YAML frontmatter envelope
    const parts = content.split("\n---\n");
    if (parts.length < 2) return null;
    try {
      const parsed = yamlParse(parts[0]) as { _envelope?: ArtifactEnvelope };
      if (!parsed?._envelope) return null;
      return { envelope: parsed._envelope, body: parts.slice(1).join("\n---\n") };
    } catch {
      return null;
    }
  }
}

/**
 * Verify an envelope against its body and run context.
 *
 * Contract C7 / C9: Hash validation, run_id check, admission_hash anchor.
 */
export function verifyEnvelope(
  envelope: ArtifactEnvelope,
  body: string,
  ctx: {
    run_id: string;
    admission_hash: string;
    prev_phase_output_hash: string | null;
  },
): { ok: true } | { ok: false; reason: string } {
  // Check output_hash
  const actualHash = sha256(body);
  if (envelope.output_hash !== actualHash) {
    return { ok: false, reason: `output_hash mismatch: expected ${envelope.output_hash}, got ${actualHash}` };
  }

  // Check run_id
  if (envelope.run_id !== ctx.run_id) {
    return { ok: false, reason: `run_id mismatch: expected ${ctx.run_id}, got ${envelope.run_id}` };
  }

  // Check admission_hash (for phases > 0)
  if (envelope.phase > 0 && envelope.admission_hash !== ctx.admission_hash) {
    return {
      ok: false,
      reason: `admission_hash mismatch: expected ${ctx.admission_hash}, got ${envelope.admission_hash}`,
    };
  }

  // Check prev_phase_output_hash
  if (ctx.prev_phase_output_hash !== null &&
      envelope.prev_phase_output_hash !== ctx.prev_phase_output_hash) {
    return {
      ok: false,
      reason: `prev_phase_output_hash mismatch`,
    };
  }

  return { ok: true };
}

/**
 * Compute SHA-256 of a string (exported for use by other modules).
 */
export { sha256 };
