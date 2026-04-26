import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { DoctorIssueCode, DoctorSeverity } from "./doctor-types.js";
import { gsdRoot } from "./paths.js";
import { parsePreferencesMarkdown, validatePreferences } from "./preferences.js";

export type PreferenceScope = "global" | "project";

export interface PreferenceDoctorFinding {
  scope: PreferenceScope;
  severity: DoctorSeverity;
  code: DoctorIssueCode;
  effectivePath: string;
  message: string;
  remediation: string;
  legacyFallback: boolean;
}

function gsdHome(): string {
  return process.env.GSD_HOME || join(homedir(), ".gsd");
}

function canonicalGlobalPreferencesPath(): string {
  return join(gsdHome(), "PREFERENCES.md");
}

function lowercaseGlobalPreferencesPath(): string {
  return join(gsdHome(), "preferences.md");
}

function piLegacyGlobalPreferencesPath(): string {
  return join(homedir(), ".pi", "agent", "gsd-preferences.md");
}

function canonicalProjectPreferencesPath(basePath: string): string {
  return join(gsdRoot(basePath), "PREFERENCES.md");
}

function lowercaseProjectPreferencesPath(basePath: string): string {
  return join(gsdRoot(basePath), "preferences.md");
}

interface PreferenceCandidate {
  path: string;
  legacyFallback: boolean;
}

function preferenceCandidates(scope: PreferenceScope, basePath: string): PreferenceCandidate[] {
  if (scope === "global") {
    return [
      { path: canonicalGlobalPreferencesPath(), legacyFallback: false },
      { path: lowercaseGlobalPreferencesPath(), legacyFallback: true },
      { path: piLegacyGlobalPreferencesPath(), legacyFallback: true },
    ];
  }

  return [
    { path: canonicalProjectPreferencesPath(basePath), legacyFallback: false },
    { path: lowercaseProjectPreferencesPath(basePath), legacyFallback: true },
  ];
}

function scopeLabel(scope: PreferenceScope): string {
  return scope === "global" ? "Global" : "Project";
}

function missingRemediation(scope: PreferenceScope, path: string): string {
  return `Create ${path} using YAML frontmatter delimited by --- to define ${scope} GSD preferences.`;
}

function fallbackRemediation(scope: PreferenceScope, canonicalPath: string): string {
  return `Rename or move this ${scope} preferences file to ${canonicalPath} so future reads use the canonical uppercase path.`;
}

function malformedRemediation(path: string): string {
  return `Fix ${path} to use valid YAML frontmatter (--- ... ---) or a supported heading/list format so GSD can parse it.`;
}

function validationRemediation(path: string): string {
  return `Correct the invalid preference values in ${path}; unsupported keys are ignored and invalid values fall back to defaults.`;
}

function inspectScope(scope: PreferenceScope, basePath: string): PreferenceDoctorFinding {
  const candidates = preferenceCandidates(scope, basePath);
  const canonicalPath = candidates[0]!.path;
  const chosen = candidates.find((candidate) => existsSync(candidate.path));

  if (!chosen) {
    return {
      scope,
      severity: "warning",
      code: "preferences_missing",
      effectivePath: canonicalPath,
      message: `${scopeLabel(scope)} preferences file not found.`,
      remediation: missingRemediation(scope, canonicalPath),
      legacyFallback: false,
    };
  }

  const raw = readFileSync(chosen.path, "utf-8");
  const parsed = parsePreferencesMarkdown(raw);

  if (parsed === null) {
    return {
      scope,
      severity: "error",
      code: "preferences_unrecognized_format",
      effectivePath: chosen.path,
      message: `${scopeLabel(scope)} preferences file exists but could not be recognized as a supported preferences format.`,
      remediation: malformedRemediation(chosen.path),
      legacyFallback: chosen.legacyFallback,
    };
  }

  const validation = validatePreferences(parsed);
  const problems = [...validation.errors, ...validation.warnings];

  if (validation.errors.length > 0) {
    return {
      scope,
      severity: "error",
      code: "invalid_preferences",
      effectivePath: chosen.path,
      message: `${scopeLabel(scope)} preferences loaded with invalid values: ${problems.join("; ")}`,
      remediation: validationRemediation(chosen.path),
      legacyFallback: chosen.legacyFallback,
    };
  }

  if (chosen.legacyFallback) {
    return {
      scope,
      severity: "warning",
      code: "preferences_legacy_fallback",
      effectivePath: chosen.path,
      message: `${scopeLabel(scope)} preferences loaded from a legacy fallback path.`,
      remediation: fallbackRemediation(scope, canonicalPath),
      legacyFallback: true,
    };
  }

  return {
    scope,
    severity: problems.length > 0 ? "warning" : "info",
    code: problems.length > 0 ? "invalid_preferences" : "preferences_ok",
    effectivePath: chosen.path,
    message: problems.length > 0
      ? `${scopeLabel(scope)} preferences loaded with non-fatal warnings: ${problems.join("; ")}`
      : `${scopeLabel(scope)} preferences loaded from the canonical path.`,
    remediation: problems.length > 0
      ? validationRemediation(chosen.path)
      : `No action needed.`,
    legacyFallback: false,
  };
}

export function inspectPreferenceHealth(basePath: string = process.cwd()): PreferenceDoctorFinding[] {
  return [inspectScope("global", basePath), inspectScope("project", basePath)];
}
