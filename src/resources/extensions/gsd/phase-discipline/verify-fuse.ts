import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { resolveMilestoneFile } from "../paths.js";
import { resolveHookArtifactPath } from "../post-unit-hooks.js";
import { loadEffectiveGSDPreferences } from "../preferences.js";
import type { PostUnitHookConfig } from "../types.js";
import { extractVerdict } from "../verdict-parser.js";

export function shouldBlockMilestoneClose(input: {
  basePath: string;
  milestoneId: string;
  validationPassed: boolean;
}): { blocked: boolean; reason?: string } {
  const verifyFuseOnFail = loadEffectiveGSDPreferences(input.basePath)?.preferences.verify_fuse_on_fail === true;
  if (!verifyFuseOnFail || input.validationPassed) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason: `Milestone ${input.milestoneId} close blocked: verify_fuse_on_fail is enabled and validate-milestone did not pass.`,
  };
}

export function readMilestoneValidationVerdict(basePath: string, milestoneId: string): string | null {
  const validationPath = resolveMilestoneFile(basePath, milestoneId, "VALIDATION");
  if (!validationPath || !existsSync(validationPath)) {
    return null;
  }
  const content = readFileSync(validationPath, "utf8");
  return extractVerdict(content) ?? null;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function clearFile(filePath: string | null): void {
  if (!filePath || !existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
  }
}

export async function runPhaseDisciplineVerifyFuseHook(input: {
  hookName: string;
  triggerUnitId: string;
  basePath: string;
  hookConfig: PostUnitHookConfig;
}): Promise<{ artifactPath: string; retryRequested: boolean; blocked: boolean; reason?: string }> {
  const artifactPath = resolveHookArtifactPath(
    input.basePath,
    input.triggerUnitId,
    input.hookConfig.artifact ?? `${input.hookName.toUpperCase()}.md`,
  );
  const retryPaths = new Set<string>();
  retryPaths.add(resolveHookArtifactPath(input.basePath, input.triggerUnitId, "VERIFY-FUSE-RETRY.md"));
  if (input.hookConfig.retry_on) {
    retryPaths.add(resolveHookArtifactPath(input.basePath, input.triggerUnitId, input.hookConfig.retry_on));
  }
  const verdict = readMilestoneValidationVerdict(input.basePath, input.triggerUnitId);
  const hasExplicitFailureSignal = verdict === "needs-attention" || verdict === "needs-remediation";
  const decision = hasExplicitFailureSignal
    ? shouldBlockMilestoneClose({
        basePath: input.basePath,
        milestoneId: input.triggerUnitId,
        validationPassed: false,
      })
    : { blocked: false as const, reason: undefined };

  const lines = [
    `# ${input.hookName}`,
    "",
    `- Trigger: validate-milestone ${input.triggerUnitId}`,
    `- Validation Verdict: ${verdict ?? "unknown"}`,
    `- Close Blocked: ${decision.blocked ? "yes" : "no"}`,
  ];
  if (decision.reason) {
    lines.push(`- Reason: ${decision.reason}`);
  } else if (!hasExplicitFailureSignal) {
    lines.push("- Reason: no explicit failing validate-milestone verdict detected");
  }

  ensureParentDir(artifactPath);
  writeFileSync(artifactPath, lines.join("\n"), "utf8");

  for (const retryPath of retryPaths) {
    clearFile(retryPath);
  }

  return {
    artifactPath,
    retryRequested: false,
    blocked: decision.blocked,
    reason: decision.reason,
  };
}
