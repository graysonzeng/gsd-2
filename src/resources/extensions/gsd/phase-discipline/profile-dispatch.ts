import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { PreDispatchResult } from "../types.js";
import { resolveMilestonePath, resolveSliceFile, resolveTasksDir } from "../paths.js";
import { logWarning } from "../workflow-logger.js";
import { PHASE_DISCIPLINE_8STEP_SEQUENCE } from "./profile-map.js";

const disagreementCounts = new Map<string, number>();

function parseStateMarkdown(basePath: string): { milestoneId?: string; sliceId?: string; phase?: string } {
  const statePath = join(basePath, ".gsd", "STATE.md");
  if (!existsSync(statePath)) return {};
  const content = readFileSync(statePath, "utf8");
  const milestoneMatch = content.match(/\*\*Active Milestone:\*\*\s+([^\n]+)/);
  const sliceMatch = content.match(/\*\*Active Slice:\*\*\s+([^\n]+)/);
  const phaseMatch = content.match(/\*\*Phase:\*\*\s+([^\n]+)/);
  const milestoneId = milestoneMatch?.[1].match(/M\d+/)?.[0];
  const sliceId = sliceMatch?.[1].match(/S\d+/)?.[0];
  const phase = phaseMatch?.[1]?.trim();
  return { milestoneId, sliceId, phase };
}

function countTaskSummaries(basePath: string, milestoneId: string): number {
  const milestoneDir = resolveMilestonePath(basePath, milestoneId);
  if (!milestoneDir) return 0;
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

function hasActiveSlicePlan(basePath: string, milestoneId: string, sliceId: string): boolean {
  return Boolean(resolveSliceFile(basePath, milestoneId, sliceId, "PLAN"));
}

function hasAnyTaskSummaryForActiveSlice(basePath: string, milestoneId: string, sliceId: string): boolean {
  const tasksDir = resolveTasksDir(basePath, milestoneId, sliceId);
  if (!tasksDir) return false;
  return readdirSync(tasksDir).some((name) => /-SUMMARY\.md$/i.test(name));
}

function recordDisagreement(basePath: string, milestoneId: string, phase: string, currentUnitType: string, advisedUnitType: string): boolean {
  const key = `${basePath}:${milestoneId}:${phase}:${currentUnitType}->${advisedUnitType}`;
  const next = (disagreementCounts.get(key) ?? 0) + 1;
  disagreementCounts.set(key, next);
  if (next >= 3) {
    logWarning(
      "dispatch",
      `phase-discipline advice backoff engaged for milestone ${milestoneId} phase ${phase}: ${currentUnitType} kept disagreeing with ${advisedUnitType}`,
    );
    return true;
  }
  return false;
}

function clearDisagreement(basePath: string, milestoneId: string, phase: string, currentUnitType: string): void {
  for (const key of disagreementCounts.keys()) {
    if (key.startsWith(`${basePath}:${milestoneId}:${phase}:${currentUnitType}->`)) {
      disagreementCounts.delete(key);
    }
  }
}

export function evaluatePhaseDisciplineProfileDispatch(input: {
  unitType: string;
  unitId: string;
  prompt: string;
  basePath: string;
}): PreDispatchResult {
  const state = parseStateMarkdown(input.basePath);
  const milestoneId = state.milestoneId ?? input.unitId.split("/")[0];
  const sliceId = state.sliceId ?? input.unitId.split("/")[1];
  const phaseLabel = state.phase ?? "unknown";

  if (!milestoneId) {
    return { action: "proceed", prompt: input.prompt, firedHooks: [] };
  }

  if (
    input.unitType === "execute-task"
    && sliceId
    && !hasActiveSlicePlan(input.basePath, milestoneId, sliceId)
  ) {
    if (!recordDisagreement(input.basePath, milestoneId, phaseLabel, input.unitType, "plan-slice")) {
      return {
        action: "advise",
        prompt: input.prompt,
        advisedUnitType: "plan-slice",
        firedHooks: [],
      };
    }
  }

  if (input.unitType === "validate-milestone") {
    const taskSummaryCount = sliceId
      ? Number(hasAnyTaskSummaryForActiveSlice(input.basePath, milestoneId, sliceId))
      : countTaskSummaries(input.basePath, milestoneId);
    if (taskSummaryCount === 0) {
      if (!recordDisagreement(input.basePath, milestoneId, phaseLabel, input.unitType, "execute-task")) {
        return {
          action: "advise",
          prompt: input.prompt,
          advisedUnitType: "execute-task",
          firedHooks: [],
        };
      }
    }
  }

  if (input.unitType === "complete-slice" || input.unitType === "complete-milestone") {
    const p4 = PHASE_DISCIPLINE_8STEP_SEQUENCE.find((entry) => entry.phase === "P4");
    if (p4 && countTaskSummaries(input.basePath, milestoneId) === 0) {
      if (!recordDisagreement(input.basePath, milestoneId, phaseLabel, input.unitType, p4.units[0]!)) {
        return {
          action: "advise",
          prompt: input.prompt,
          advisedUnitType: p4.units[0],
          firedHooks: [],
        };
      }
    }
  }

  clearDisagreement(input.basePath, milestoneId, phaseLabel, input.unitType);
  return { action: "proceed", prompt: input.prompt, firedHooks: [] };
}
