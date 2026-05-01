import { existsSync, readFileSync } from 'node:fs';
import {
  resolveGsdRoot,
  resolveRootFile,
  findMilestoneIds,
  resolveMilestoneFile,
  resolveMilestoneDir,
  findSliceIds,
  resolveSliceFile,
  findTaskFiles,
} from './paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'info' | 'warning' | 'error';

export interface DoctorIssue {
  severity: Severity;
  code: string;
  scope: 'project' | 'milestone' | 'slice' | 'task';
  unitId: string;
  message: string;
  file?: string;
}

export interface DoctorResult {
  ok: boolean;
  issues: DoctorIssue[];
  counts: { error: number; warning: number; info: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Execution-entry phases where missing CONTEXT.md blocks forward progress. */
const EXECUTION_ENTRY_PHASES = new Set([
  'executing',
  'summarizing',
  'validating-milestone',
  'completing-milestone',
]);

/**
 * Parse STATE.md to extract active milestone ID and current phase.
 * Returns null if STATE.md doesn't exist or can't be parsed.
 * Lightweight regex-based parsing — intentionally avoids importing the full
 * state derivation from the main extension.
 */
function parseActivePhaseFromState(gsdRoot: string): { mid: string; phase: string } | null {
  const statePath = resolveRootFile(gsdRoot, 'STATE.md');
  if (!existsSync(statePath)) return null;
  try {
    const content = readFileSync(statePath, 'utf-8');
    // STATE.md is rendered by workflow-projections.ts with formats like:
    //   **Active Milestone:** M001: Some title
    //   **Phase:** executing
    // Also handle legacy/alternative formats:
    //   active_milestone: M001
    //   ## Active Milestone: M001
    //   phase: executing
    const midMatch = content.match(/\*\*Active Milestone:\*\*\s+([A-Z]\d{3})/)
      ?? content.match(/active[_ ]milestone[:\s]+([A-Z]\d{3})/i)
      ?? content.match(/^##\s+(?:Active\s+)?Milestone[:\s]+([A-Z]\d{3})/mi);
    const phaseMatch = content.match(/\*\*Phase:\*\*\s+([\w-]+)/)
      ?? content.match(/phase[:\s]+([\w-]+)/i);
    if (!midMatch || !phaseMatch) return null;
    return { mid: midMatch[1]!, phase: phaseMatch[1]! };
  } catch {
    return null;
  }
}

function checkProjectLevel(gsdRoot: string, issues: DoctorIssue[]): void {
  // PROJECT.md should exist
  const projectPath = resolveRootFile(gsdRoot, 'PROJECT.md');
  if (!existsSync(projectPath)) {
    issues.push({
      severity: 'warning',
      code: 'missing_project_md',
      scope: 'project',
      unitId: '',
      message: 'PROJECT.md is missing — project lacks a description',
      file: projectPath,
    });
  }

  // STATE.md should exist if milestones exist
  const milestones = findMilestoneIds(gsdRoot);
  if (milestones.length > 0) {
    const statePath = resolveRootFile(gsdRoot, 'STATE.md');
    if (!existsSync(statePath)) {
      issues.push({
        severity: 'warning',
        code: 'missing_state_md',
        scope: 'project',
        unitId: '',
        message: 'STATE.md is missing — run /gsd status to regenerate',
        file: statePath,
      });
    }
  }
}

function checkMilestoneLevel(gsdRoot: string, mid: string, issues: DoctorIssue[], activeState: { mid: string; phase: string } | null): void {
  const mDir = resolveMilestoneDir(gsdRoot, mid);
  if (!mDir) {
    issues.push({
      severity: 'error',
      code: 'missing_milestone_dir',
      scope: 'milestone',
      unitId: mid,
      message: `Milestone directory for ${mid} not found`,
    });
    return;
  }

  // CONTEXT.md should exist
  const ctxPath = resolveMilestoneFile(gsdRoot, mid, 'CONTEXT');
  if (!ctxPath || !existsSync(ctxPath)) {
    // Check for draft
    const draftPath = resolveMilestoneFile(gsdRoot, mid, 'CONTEXT-DRAFT');
    if (!draftPath || !existsSync(draftPath)) {
      // Elevate severity to 'error' if this is the active milestone in an
      // execution-entry phase — dispatch will regress to discuss-milestone
      // which deadlocks in auto-mode (#4671 recovery still works, but the
      // diagnostic should be loud).
      const isActiveExecution = activeState?.mid === mid
        && EXECUTION_ENTRY_PHASES.has(activeState.phase);
      issues.push({
        severity: isActiveExecution ? 'error' : 'warning',
        code: 'missing_context',
        scope: 'milestone',
        unitId: mid,
        message: isActiveExecution
          ? `${mid} is in phase "${activeState!.phase}" but has no CONTEXT.md — dispatch will regress to discuss-milestone`
          : `${mid} has no CONTEXT.md — milestone lacks defined scope`,
      });
    }
  }

  // ROADMAP.md should exist if slices exist
  const sliceIds = findSliceIds(gsdRoot, mid);
  if (sliceIds.length > 0) {
    const roadmapPath = resolveMilestoneFile(gsdRoot, mid, 'ROADMAP');
    if (!roadmapPath || !existsSync(roadmapPath)) {
      issues.push({
        severity: 'warning',
        code: 'missing_roadmap',
        scope: 'milestone',
        unitId: mid,
        message: `${mid} has ${sliceIds.length} slices but no ROADMAP.md`,
      });
    }
  }

  // Check if all slices done but no SUMMARY
  if (sliceIds.length > 0) {
    const allDone = sliceIds.every((sid) => {
      const tasks = findTaskFiles(gsdRoot, mid, sid);
      return tasks.length > 0 && tasks.every((t) => t.hasSummary);
    });
    const summaryPath = resolveMilestoneFile(gsdRoot, mid, 'SUMMARY');
    if (allDone && (!summaryPath || !existsSync(summaryPath))) {
      issues.push({
        severity: 'error',
        code: 'all_slices_done_missing_summary',
        scope: 'milestone',
        unitId: mid,
        message: `${mid} has all slices completed but no SUMMARY.md`,
      });
    }
  }
}

function checkSliceLevel(
  gsdRoot: string, mid: string, sid: string, issues: DoctorIssue[],
): void {
  const unitId = `${mid}/${sid}`;

  // PLAN.md should exist
  const planPath = resolveSliceFile(gsdRoot, mid, sid, 'PLAN');
  if (!planPath || !existsSync(planPath)) {
    issues.push({
      severity: 'error',
      code: 'missing_slice_plan',
      scope: 'slice',
      unitId,
      message: `${unitId} has no PLAN.md`,
    });
  }

  // Tasks should have plans
  const tasks = findTaskFiles(gsdRoot, mid, sid);
  for (const task of tasks) {
    const taskUnitId = `${unitId}/${task.id}`;
    if (!task.hasPlan) {
      issues.push({
        severity: 'warning',
        code: 'missing_task_plan',
        scope: 'task',
        unitId: taskUnitId,
        message: `${taskUnitId} has a summary but no plan file`,
      });
    }
  }

  // Check for empty slice (directory exists but no tasks or plan)
  if (tasks.length === 0 && (!planPath || !existsSync(planPath))) {
    issues.push({
      severity: 'warning',
      code: 'empty_slice',
      scope: 'slice',
      unitId,
      message: `${unitId} has no plan and no tasks — may be abandoned`,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runDoctorLite(projectDir: string, scope?: string): DoctorResult {
  const gsdRoot = resolveGsdRoot(projectDir);
  const issues: DoctorIssue[] = [];

  if (!existsSync(gsdRoot)) {
    return {
      ok: true,
      issues: [{
        severity: 'info',
        code: 'no_gsd_directory',
        scope: 'project',
        unitId: '',
        message: 'No .gsd/ directory found — project not initialized',
      }],
      counts: { error: 0, warning: 0, info: 1 },
    };
  }

  // Project-level checks
  checkProjectLevel(gsdRoot, issues);

  // Derive active milestone/phase for conditional severity
  const activeState = parseActivePhaseFromState(gsdRoot);

  // Milestone + slice checks
  const milestoneIds = scope
    ? findMilestoneIds(gsdRoot).filter((id) => id === scope)
    : findMilestoneIds(gsdRoot);

  for (const mid of milestoneIds) {
    checkMilestoneLevel(gsdRoot, mid, issues, activeState);

    const sliceIds = findSliceIds(gsdRoot, mid);
    for (const sid of sliceIds) {
      checkSliceLevel(gsdRoot, mid, sid, issues);
    }
  }

  const counts = {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  return { ok: counts.error === 0, issues, counts };
}
