import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GSDState, Phase } from "../types.js";
import { gsdRoot, resolveMilestoneFile, resolveSliceFile } from "../paths.js";
import { isDbAvailable, getMilestoneSlices, getSliceTasks, type SliceRow } from "../gsd-db.js";
import type { UokGraphNode } from "./contracts.js";
import {
  resolveCanonicalMilestoneArtifactPath,
  resolveCanonicalMilestoneFile,
  resolveCanonicalMilestoneRoot,
} from "../worktree-manager.js";

const PLAN_V2_CLARIFY_ROUND_LIMIT = 3;
export const EXECUTION_ENTRY_PHASES: ReadonlySet<Phase> = new Set([
  "executing",
  "summarizing",
  "validating-milestone",
  "completing-milestone",
]);

export function isExecutionEntryPhase(phase: Phase): boolean {
  return EXECUTION_ENTRY_PHASES.has(phase);
}

export interface PlanV2CompileResult {
  ok: boolean;
  reason?: string;
  graphPath?: string;
  nodeCount?: number;
  clarifyRoundLimit?: number;
  researchSynthesized?: boolean;
  draftContextIncluded?: boolean;
  finalizedContextIncluded?: boolean;
}

function graphOutputPath(basePath: string): string {
  return join(gsdRoot(basePath), "runtime", "uok-plan-v2-graph.json");
}

function hasFileContent(path: string | null): boolean {
  if (!path || !existsSync(path)) return false;
  try {
    return readFileSync(path, "utf-8").trim().length > 0;
  } catch {
    return false;
  }
}

export type MilestoneContextVisibility =
  | {
      status: "present";
      path: string;
      canonicalPath: string;
      basePath: string;
      checkedBases: string[];
    }
  | {
      status: "missing";
      canonicalPath: string;
      checkedBases: string[];
      reason: "not-found" | "empty";
    }
  | {
      status: "path-conflict";
      canonicalPath: string;
      conflictingPath: string;
      conflictKind: "root-level-legacy" | "lookup-base-mismatch";
      checkedBases: string[];
    };

function getArtifactLookupBases(basePath: string): string[] {
  const bases = [basePath];
  const projectRoot = process.env.GSD_PROJECT_ROOT;
  if (projectRoot && projectRoot.trim().length > 0 && projectRoot !== basePath) {
    bases.push(projectRoot);
  }
  return Array.from(new Set(bases));
}

function getCanonicalArtifactLookupBases(basePath: string, milestoneId: string): string[] {
  const bases = getArtifactLookupBases(basePath);
  const canonicalBase = resolveCanonicalMilestoneRoot(basePath, milestoneId);
  return Array.from(new Set([canonicalBase, ...bases]));
}

function findRootLevelLegacyContext(basePath: string): string | null {
  const root = gsdRoot(basePath);
  for (const name of ["CONTEXT.md", "context.md"]) {
    const candidate = join(root, name);
    if (hasFileContent(candidate)) return candidate;
  }
  return null;
}

export function resolveFinalizedMilestoneContextVisibility(
  basePath: string,
  milestoneId: string,
): MilestoneContextVisibility {
  const canonicalBase = resolveCanonicalMilestoneRoot(basePath, milestoneId);
  const canonicalPath = resolveCanonicalMilestoneArtifactPath(basePath, milestoneId, "CONTEXT");
  const checkedBases = getCanonicalArtifactLookupBases(basePath, milestoneId);
  const canonicalFile = resolveCanonicalMilestoneFile(basePath, milestoneId, "CONTEXT");

  if (hasFileContent(canonicalFile)) {
    return {
      status: "present",
      path: canonicalFile!,
      canonicalPath,
      basePath: canonicalBase,
      checkedBases,
    };
  }

  for (const candidateBase of checkedBases) {
    if (candidateBase === canonicalBase) continue;
    const candidate = resolveMilestoneFile(candidateBase, milestoneId, "CONTEXT");
    if (hasFileContent(candidate)) {
      if (canonicalBase === basePath) {
        return {
          status: "present",
          path: candidate!,
          canonicalPath: resolveCanonicalMilestoneArtifactPath(candidateBase, milestoneId, "CONTEXT"),
          basePath: candidateBase,
          checkedBases,
        };
      }
      return {
        status: "path-conflict",
        canonicalPath,
        conflictingPath: candidate!,
        conflictKind: "lookup-base-mismatch",
        checkedBases,
      };
    }
  }

  for (const candidateBase of checkedBases) {
    const legacy = findRootLevelLegacyContext(candidateBase);
    if (legacy) {
      return {
        status: "path-conflict",
        canonicalPath,
        conflictingPath: legacy,
        conflictKind: "root-level-legacy",
        checkedBases,
      };
    }
  }

  const anyEmpty = checkedBases.some((candidateBase) => {
    const candidate = resolveMilestoneFile(candidateBase, milestoneId, "CONTEXT");
    return !!candidate && existsSync(candidate);
  });

  return {
    status: "missing",
    canonicalPath,
    checkedBases,
    reason: anyEmpty ? "empty" : "not-found",
  };
}

function hasMilestoneFileContent(
  basePath: string,
  milestoneId: string,
  suffix: string,
): boolean {
  const bases = getCanonicalArtifactLookupBases(basePath, milestoneId);
  for (const candidateBase of bases) {
    if (hasFileContent(resolveMilestoneFile(candidateBase, milestoneId, suffix))) {
      return true;
    }
  }
  return false;
}

export function hasFinalizedMilestoneContext(basePath: string, milestoneId: string): boolean {
  return resolveFinalizedMilestoneContextVisibility(basePath, milestoneId).status === "present";
}

export function isMissingFinalizedContextResult(result: PlanV2CompileResult): boolean {
  return !result.ok && result.finalizedContextIncluded === false;
}

function countSliceResearchArtifacts(basePath: string, milestoneId: string, slices: SliceRow[]): number {
  let count = 0;
  for (const slice of slices) {
    if (hasFileContent(resolveSliceFile(basePath, milestoneId, slice.id, "RESEARCH"))) {
      count += 1;
    }
  }
  return count;
}

export function compileUnitGraphFromState(basePath: string, state: GSDState): PlanV2CompileResult {
  const mid = state.activeMilestone?.id;
  if (!mid) return { ok: false, reason: "no active milestone" };
  if (!isDbAvailable()) return { ok: false, reason: "database not available" };

  const slices = getMilestoneSlices(mid).sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
  const nodes: UokGraphNode[] = [];
  const clarifyRoundLimit = PLAN_V2_CLARIFY_ROUND_LIMIT;
  const draftContextIncluded = hasMilestoneFileContent(basePath, mid, "CONTEXT-DRAFT");
  const finalizedContextIncluded = hasFinalizedMilestoneContext(basePath, mid);
  const researchSynthesized = hasMilestoneFileContent(basePath, mid, "RESEARCH")
    || countSliceResearchArtifacts(basePath, mid, slices) > 0;

  if (isExecutionEntryPhase(state.phase) && !finalizedContextIncluded) {
    const reason = draftContextIncluded
      ? "milestone context draft exists but finalized CONTEXT.md is missing"
      : "missing milestone CONTEXT.md";
    return {
      ok: false,
      reason,
      clarifyRoundLimit,
      researchSynthesized,
      draftContextIncluded,
      finalizedContextIncluded,
    };
  }

  for (const slice of slices) {
    const sid = slice.id;
    const tasks = getSliceTasks(mid, sid)
      .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));

    let previousTaskNodeId: string | null = null;
    for (const task of tasks) {
      const nodeId = `execute-task:${mid}:${sid}:${task.id}`;
      const dependsOn = previousTaskNodeId ? [previousTaskNodeId] : [];
      nodes.push({
        id: nodeId,
        kind: "unit",
        dependsOn,
        writes: task.key_files,
        metadata: {
          unitType: "execute-task",
          unitId: `${mid}.${sid}.${task.id}`,
          title: task.title,
          status: task.status,
        },
      });
      previousTaskNodeId = nodeId;
    }

    if (previousTaskNodeId) {
      nodes.push({
        id: `complete-slice:${mid}:${sid}`,
        kind: "verification",
        dependsOn: [previousTaskNodeId],
        metadata: {
          unitType: "complete-slice",
          unitId: `${mid}.${sid}`,
          title: slice.title,
          status: slice.status,
        },
      });
    }
  }

  const output = {
    compiledAt: new Date().toISOString(),
    milestoneId: mid,
    pipeline: {
      clarifyRoundLimit,
      researchSynthesized,
      draftContextIncluded,
      finalizedContextIncluded,
      sourcePhase: state.phase,
    },
    nodes,
  };

  const outPath = graphOutputPath(basePath);
  mkdirSync(join(gsdRoot(basePath), "runtime"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  return {
    ok: true,
    graphPath: outPath,
    nodeCount: nodes.length,
    clarifyRoundLimit,
    researchSynthesized: output.pipeline.researchSynthesized,
    draftContextIncluded: output.pipeline.draftContextIncluded,
    finalizedContextIncluded: output.pipeline.finalizedContextIncluded,
  };
}

export function ensurePlanV2Graph(basePath: string, state: GSDState): PlanV2CompileResult {
  const compiled = compileUnitGraphFromState(basePath, state);
  if (!compiled.ok) return compiled;
  if ((compiled.nodeCount ?? 0) <= 0) {
    return { ok: false, reason: "compiled graph is empty" };
  }
  return compiled;
}
