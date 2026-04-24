import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseTaskPlanFile } from "../files.js";
import { resolveTasksDir } from "../paths.js";
import { resolveHookArtifactPath } from "../post-unit-hooks.js";
import type { PostUnitHookConfig, HookExecutionState } from "../types.js";

export interface ImplPlanValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PhaseDisciplineImplPlanValidatorHookResult {
  artifactPath: string;
  retryRequested: boolean;
  checkedPlans: string[];
  errors: string[];
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function clearRetryArtifact(retryPath: string | null): void {
  if (!retryPath || !existsSync(retryPath)) return;
  try {
    unlinkSync(retryPath);
  } catch {
  }
}

export function validateImplPlan(planContent: string): ImplPlanValidationResult {
  const taskPlan = parseTaskPlanFile(planContent);
  const errors: string[] = [];

  if (!taskPlan.frontmatter.rollback_hint?.trim()) {
    errors.push("missing rollback_hint");
  }
  if (!taskPlan.frontmatter.acceptance?.trim()) {
    errors.push("missing acceptance");
  }
  if (!Array.isArray(taskPlan.frontmatter.files) || taskPlan.frontmatter.files.length === 0) {
    errors.push("missing files[]");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function runPhaseDisciplineImplPlanValidatorHook(input: {
  basePath: string;
  hookName: string;
  triggerUnitType: string;
  triggerUnitId: string;
  hookConfig: PostUnitHookConfig;
}): Promise<PhaseDisciplineImplPlanValidatorHookResult> {
  const artifactPath = resolveHookArtifactPath(
    input.basePath,
    input.triggerUnitId,
    input.hookConfig.artifact ?? "IMPL-PLAN-VALIDATION.md",
  );
  const retryPath = input.hookConfig.retry_on
    ? resolveHookArtifactPath(input.basePath, input.triggerUnitId, input.hookConfig.retry_on)
    : null;
  const unitParts = input.triggerUnitId.split("/");
  const milestoneId = unitParts[0] ?? "";
  const sliceId = unitParts[1] ?? "";
  const tasksDir = milestoneId && sliceId
    ? resolveTasksDir(input.basePath, milestoneId, sliceId)
    : null;
  const checkedPlans: string[] = [];
  const errors: string[] = [];

  if (!tasksDir || !existsSync(tasksDir)) {
    errors.push("tasks directory not found");
  } else {
    const planFiles = readdirSync(tasksDir)
      .filter((name) => /-PLAN\.md$/i.test(name))
      .sort();

    if (planFiles.length === 0) {
      errors.push("no task plan files found");
    }

    for (const planFile of planFiles) {
      checkedPlans.push(planFile);
      const result = validateImplPlan(readFileSync(`${tasksDir}/${planFile}`, "utf8"));
      if (!result.valid) {
        for (const error of result.errors) {
          errors.push(`${planFile}: ${error}`);
        }
      }
    }
  }

  const valid = errors.length === 0;
  const lines: string[] = [];
  lines.push(`# ${input.hookName}`);
  lines.push("");
  lines.push(`- Trigger: ${input.triggerUnitType} ${input.triggerUnitId}`);
  lines.push(`- Result: ${valid ? "pass" : "fail"}`);
  lines.push(`- Checked Plans: ${checkedPlans.length}`);
  lines.push("");
  lines.push("## Checked Plans");
  lines.push("");
  if (checkedPlans.length > 0) {
    for (const planFile of checkedPlans) {
      lines.push(`- ${planFile}`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("## Errors");
  lines.push("");
  if (errors.length > 0) {
    for (const error of errors) {
      lines.push(`- ${error}`);
    }
  } else {
    lines.push("- None");
  }

  ensureParentDir(artifactPath);
  writeFileSync(artifactPath, `${lines.join("\n").trimEnd()}\n`, "utf8");

  if (!valid && retryPath) {
    ensureParentDir(retryPath);
    writeFileSync(retryPath, `retry requested by ${input.hookName}\n`, "utf8");
  } else {
    clearRetryArtifact(retryPath);
  }

  return {
    artifactPath,
    retryRequested: !valid && Boolean(retryPath),
    checkedPlans,
    errors,
  };
}

export async function maybeRunPhaseDisciplineImplPlanBuiltInHook(input: {
  unitType: string;
  basePath: string;
  hookState: HookExecutionState | null;
  hookConfig: PostUnitHookConfig | undefined;
}): Promise<boolean> {
  const builtin = input.hookConfig?.builtin?.trim();
  if (builtin !== "phase-discipline-impl-plan-validator") {
    return false;
  }
  if (!input.hookState || !input.hookConfig) {
    return false;
  }
  await runPhaseDisciplineImplPlanValidatorHook({
    basePath: input.basePath,
    hookName: input.hookState.hookName,
    triggerUnitType: input.hookState.triggerUnitType,
    triggerUnitId: input.hookState.triggerUnitId,
    hookConfig: input.hookConfig,
  });
  return true;
}
