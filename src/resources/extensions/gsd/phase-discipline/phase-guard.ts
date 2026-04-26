import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PhaseDisciplineCheckIssue, PreDispatchResult } from "../types.js";
import { isValidMilestoneVerdict, extractVerdict } from "../verdict-parser.js";
import {
  resolveCanonicalMilestoneArtifactPath,
  resolveCanonicalMilestoneFile,
  resolveCanonicalMilestonePath,
} from "../worktree-manager.js";
import { shouldBlockMilestoneClose } from "./verify-fuse.js";

function resolveMilestoneId(unitId: string): string {
  return unitId.split("/")[0] ?? unitId;
}

function countTaskSummaries(basePath: string, milestoneId: string): number {
  const milestoneDir = resolveCanonicalMilestonePath(basePath, milestoneId);
  const slicesDir = join(milestoneDir, "slices");
  if (!existsSync(slicesDir)) return 0;

  let count = 0;
  for (const sliceEntry of readdirSync(slicesDir, { withFileTypes: true })) {
    if (!sliceEntry.isDirectory()) continue;
    const tasksDir = join(slicesDir, sliceEntry.name, "tasks");
    if (!existsSync(tasksDir)) continue;
    count += readdirSync(tasksDir).filter((name) => /-SUMMARY\.md$/i.test(name)).length;
  }
  return count;
}

function buildIssue(input: {
  code: string;
  level: "fatal" | "warning";
  detail: string;
  remedy?: string;
  unitType: string;
  unitId: string;
}): PhaseDisciplineCheckIssue {
  return {
    code: input.code,
    level: input.level,
    stage: "phase-guard",
    source: "phase-discipline.phase-guard",
    detail: input.detail,
    remedy: input.remedy,
    unitType: input.unitType,
    unitId: input.unitId,
  };
}

function blockResult(input: {
  reason: string;
  level: "error" | "warning";
  issues: PhaseDisciplineCheckIssue[];
}): PreDispatchResult {
  return {
    action: "block",
    prompt: undefined,
    reason: input.reason,
    level: input.level,
    issues: input.issues,
    firedHooks: [],
  };
}

function readValidationArtifact(basePath: string, milestoneId: string): {
  validationPath: string;
  fileExists: boolean;
  verdict: string | null;
  verdictValid: boolean;
} {
  const existingPath = resolveCanonicalMilestoneFile(basePath, milestoneId, "VALIDATION");
  const validationPath = existingPath ?? resolveCanonicalMilestoneArtifactPath(basePath, milestoneId, "VALIDATION");
  if (!existingPath || !existsSync(existingPath)) {
    return {
      validationPath,
      fileExists: false,
      verdict: null,
      verdictValid: false,
    };
  }

  const content = readFileSync(existingPath, "utf8");
  const verdict = extractVerdict(content) ?? null;
  return {
    validationPath: existingPath,
    fileExists: true,
    verdict,
    verdictValid: Boolean(verdict && isValidMilestoneVerdict(verdict)),
  };
}

export function evaluatePhaseDisciplinePhaseGuard(input: {
  unitType: string;
  unitId: string;
  prompt: string;
  basePath: string;
}): PreDispatchResult {
  const milestoneId = resolveMilestoneId(input.unitId);
  if (!milestoneId) {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  if (input.unitType === "validate-milestone") {
    if (countTaskSummaries(input.basePath, milestoneId) === 0) {
      const issue = buildIssue({
        code: "missing_task_summaries",
        level: "fatal",
        detail: `Cannot validate milestone ${milestoneId}: no task SUMMARY artifacts found yet.`,
        remedy: "Run execute-task until at least one task SUMMARY exists, then retry validate-milestone.",
        unitType: input.unitType,
        unitId: input.unitId,
      });
      return blockResult({
        reason: issue.detail,
        level: "error",
        issues: [issue],
      });
    }
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  if (input.unitType === "complete-milestone") {
    const validationArtifact = readValidationArtifact(input.basePath, milestoneId);
    if (!validationArtifact.fileExists) {
      const issue = buildIssue({
        code: "validation_artifact_missing",
        level: "fatal",
        detail: `Cannot complete milestone ${milestoneId}: validation artifact is missing at ${validationArtifact.validationPath}.`,
        remedy: "Run validate-milestone before complete-milestone.",
        unitType: input.unitType,
        unitId: input.unitId,
      });
      return blockResult({
        reason: issue.detail,
        level: "error",
        issues: [issue],
      });
    }

    if (!validationArtifact.verdictValid || !validationArtifact.verdict) {
      const issue = buildIssue({
        code: "validation_verdict_invalid",
        level: "fatal",
        detail: `Cannot complete milestone ${milestoneId}: validation artifact at ${validationArtifact.validationPath} is missing a valid verdict.`,
        remedy: "Re-run validate-milestone or repair the VALIDATION verdict frontmatter before retrying.",
        unitType: input.unitType,
        unitId: input.unitId,
      });
      return blockResult({
        reason: issue.detail,
        level: "error",
        issues: [issue],
      });
    }

    if (validationArtifact.verdict === "needs-attention" || validationArtifact.verdict === "needs-remediation") {
      const verifyFuseDecision = shouldBlockMilestoneClose({
        basePath: input.basePath,
        milestoneId,
        validationPassed: false,
      });
      if (verifyFuseDecision.blocked) {
        const issue = buildIssue({
          code: "verify_fuse_blocked",
          level: "warning",
          detail: verifyFuseDecision.reason
            ?? `Cannot complete milestone ${milestoneId}: VALIDATION verdict is \"${validationArtifact.verdict}\" and verify_fuse_on_fail is enabled.`,
          remedy: "Address the validation findings or disable verify_fuse_on_fail before retrying completion.",
          unitType: input.unitType,
          unitId: input.unitId,
        });
        return blockResult({
          reason: issue.detail,
          level: "warning",
          issues: [issue],
        });
      }
    }
  }

  return { action: "proceed", prompt: input.prompt, firedHooks: [] };
}
