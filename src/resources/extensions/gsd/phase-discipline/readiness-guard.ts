import { getTask, isDbAvailable } from "../gsd-db.js";
import type { PhaseDisciplineCheckIssue, PreDispatchResult } from "../types.js";
import { resolveSliceFile, resolveSlicePath, resolveTaskFile } from "../paths.js";
import { parseUnitId } from "../unit-id.js";

function buildIssue(input: {
  code: string;
  level: "fatal" | "warning" | "advisory";
  detail: string;
  remedy?: string;
  unitType: string;
  unitId: string;
}): PhaseDisciplineCheckIssue {
  return {
    code: input.code,
    level: input.level,
    stage: "readiness-guard",
    source: "phase-discipline.readiness-guard",
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
    reason: input.reason,
    level: input.level,
    issues: input.issues,
    firedHooks: [],
  };
}

function adviseResult(input: {
  prompt: string;
  advisedUnitType: string;
  issue: PhaseDisciplineCheckIssue;
}): PreDispatchResult {
  return {
    action: "advise",
    prompt: input.prompt,
    advisedUnitType: input.advisedUnitType,
    issues: [input.issue],
    firedHooks: [],
  };
}

export function evaluatePhaseDisciplineReadinessGuard(input: {
  unitType: string;
  unitId: string;
  prompt: string;
  basePath: string;
}): PreDispatchResult {
  if (input.unitType !== "plan-slice" && input.unitType !== "execute-task") {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  const { milestone, slice, task } = parseUnitId(input.unitId);
  if (!milestone || !slice) {
    const issue = buildIssue({
      code: "invalid_unit_id",
      level: "fatal",
      detail: `Cannot run ${input.unitType}: unitId \"${input.unitId}\" is missing milestone or slice segments.`,
      remedy: "Dispatch a canonical unit id like M001/S01 or M001/S01/T01 before retrying.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return blockResult({
      reason: issue.detail,
      level: "error",
      issues: [issue],
    });
  }

  const slicePath = resolveSlicePath(input.basePath, milestone, slice);
  if (!slicePath) {
    const issue = buildIssue({
      code: "slice_not_found",
      level: "fatal",
      detail: `Cannot run ${input.unitType}: slice path for ${milestone}/${slice} does not exist.`,
      remedy: "Repair the milestone/slice directory or re-run planning to materialize the slice before retrying.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return blockResult({
      reason: issue.detail,
      level: "error",
      issues: [issue],
    });
  }

  if (input.unitType === "plan-slice") {
    const researchPath = resolveSliceFile(input.basePath, milestone, slice, "RESEARCH");
    if (researchPath) {
      return { action: "proceed", prompt: input.prompt, firedHooks: [] };
    }
    const issue = buildIssue({
      code: "research_artifact_missing",
      level: "advisory",
      detail: `Slice ${milestone}/${slice} is missing RESEARCH.md, so plan-slice should hand back to research-slice first.`,
      remedy: "Run research-slice to generate the slice research artifact, then retry plan-slice.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return adviseResult({
      prompt: input.prompt,
      advisedUnitType: "research-slice",
      issue,
    });
  }

  if (!task) {
    const issue = buildIssue({
      code: "invalid_unit_id",
      level: "fatal",
      detail: `Cannot run execute-task: unitId \"${input.unitId}\" is missing the task segment.`,
      remedy: "Dispatch execute-task with a canonical unit id like M001/S01/T01.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return blockResult({
      reason: issue.detail,
      level: "error",
      issues: [issue],
    });
  }

  const slicePlanPath = resolveSliceFile(input.basePath, milestone, slice, "PLAN");
  if (!slicePlanPath) {
    const issue = buildIssue({
      code: "plan_artifact_missing",
      level: "warning",
      detail: `Cannot run execute-task ${input.unitId}: slice PLAN.md is missing for ${milestone}/${slice}.`,
      remedy: "Run plan-slice to generate the slice plan before executing tasks.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return blockResult({
      reason: issue.detail,
      level: "warning",
      issues: [issue],
    });
  }

  if (isDbAvailable() && !getTask(milestone, slice, task)) {
    const issue = buildIssue({
      code: "task_not_found",
      level: "warning",
      detail: `Cannot run execute-task ${input.unitId}: task ${task} is not present in the DB slice plan for ${milestone}/${slice}.`,
      remedy: "Re-run plan-slice/refine-slice to regenerate task rows, or dispatch a task id that exists in the active slice.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return blockResult({
      reason: issue.detail,
      level: "warning",
      issues: [issue],
    });
  }

  const taskPlanPath = resolveTaskFile(input.basePath, milestone, slice, task, "PLAN");
  if (!taskPlanPath) {
    const issue = buildIssue({
      code: "task_plan_missing",
      level: "warning",
      detail: `Cannot run execute-task ${input.unitId}: task plan artifact ${task}-PLAN.md is missing.`,
      remedy: "Regenerate task plans before executing, then retry execute-task.",
      unitType: input.unitType,
      unitId: input.unitId,
    });
    return blockResult({
      reason: issue.detail,
      level: "warning",
      issues: [issue],
    });
  }

  return { action: "proceed", prompt: input.prompt, firedHooks: [] };
}
