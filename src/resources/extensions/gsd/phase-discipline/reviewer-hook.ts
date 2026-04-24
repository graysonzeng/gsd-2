import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveExpectedArtifactPath } from "../auto-artifact-paths.js";
import { resolveHookArtifactPath } from "../post-unit-hooks.js";
import { loadEffectiveGSDPreferences } from "../preferences.js";
import { defaultReviewerModel, inferProvider, pickReviewerModel, ReviewerCoreError, runReview } from "../shared-harness/index.js";
import type { PostUnitHookConfig, HookExecutionState } from "../types.js";
import { logWarning } from "../workflow-logger.js";
import { maybeRunPhaseDisciplineImplPlanBuiltInHook } from "./impl-plan-validator.js";
import { runPhaseDisciplineVerifyFuseHook } from "./verify-fuse.js";

export interface PhaseDisciplineReviewerSpec {
  model: string;
  provider: string;
}

export interface RunPhaseDisciplineReviewerHookInput {
  hookName: string;
  triggerUnitType: string;
  triggerUnitId: string;
  basePath: string;
  hookConfig: PostUnitHookConfig;
  currentModel?: { id?: string; provider?: string } | null;
  pickReviewers?: (input: {
    mainModel: string;
    mainProvider?: string;
    count: number;
  }) => PhaseDisciplineReviewerSpec[];
  runReviewImpl?: typeof runReview;
}

export interface PhaseDisciplineReviewerHookResult {
  artifactPath: string;
  retryRequested: boolean;
  overallAssessment: "pass" | "issues" | "fail";
  reviewers: PhaseDisciplineReviewerSpec[];
}

function normalizeModelArg(model: string, provider?: string): string {
  return model.includes("/") ? model : provider ? `${provider}/${model}` : model;
}

function resolveReviewerSpec(value: string, fallbackProvider?: string): PhaseDisciplineReviewerSpec {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    return {
      provider: trimmed.slice(0, slashIndex),
      model: trimmed.slice(slashIndex + 1),
    };
  }
  return {
    model: trimmed,
    provider: fallbackProvider?.trim() || inferProvider(trimmed),
  };
}

function resolvePrimaryReviewer(input: RunPhaseDisciplineReviewerHookInput): PhaseDisciplineReviewerSpec {
  const runtimeModel = input.currentModel?.id?.trim();
  const runtimeProvider = input.currentModel?.provider?.trim();
  const configuredModel = input.hookConfig.model?.trim();
  const configuredProvider = input.hookConfig.provider?.trim();

  if (configuredModel) {
    return resolveReviewerSpec(configuredModel, configuredProvider || runtimeProvider);
  }
  if (runtimeModel) {
    return resolveReviewerSpec(runtimeModel, runtimeProvider);
  }

  const fallbackModel = defaultReviewerModel(runtimeProvider ?? "") || "gpt-5.4";
  return resolveReviewerSpec(fallbackModel, runtimeProvider || configuredProvider);
}

function sanitizeForFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolveReviewerTimeoutMs(basePath: string): number {
  const configured = loadEffectiveGSDPreferences(basePath)?.preferences.auto_supervisor;
  return Math.max(30_000, (configured?.hard_timeout_minutes ?? 30) * 60 * 1000);
}

async function runReviewWithTimeout(
  runReviewImpl: typeof runReview,
  reviewer: PhaseDisciplineReviewerSpec,
  input: RunPhaseDisciplineReviewerHookInput,
  systemPrompt: string,
  reviewPrompt: string,
  targetContent: string,
): Promise<Awaited<ReturnType<typeof runReview>>> {
  const timeoutMs = resolveReviewerTimeoutMs(input.basePath);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runReviewImpl({
        projectRoot: input.basePath,
        modelArg: normalizeModelArg(reviewer.model, reviewer.provider),
        systemPrompt,
        reviewPrompt,
        targetContent,
      }),
      new Promise<Awaited<ReturnType<typeof runReview>>>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new ReviewerCoreError("subprocess_failure", `reviewer hard timeout after ${timeoutMs}ms`, []));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export interface ReviewerAttemptMetrics {
  reviewer: string;
  status: "succeeded" | "failed" | "fallback_succeeded";
  error?: string;
  outputChars: number;
  attempts: number;
  wallClockMs?: number;
}

function writeObservabilityLog(input: {
  basePath: string;
  hookName: string;
  triggerUnitId: string;
  triggerUnitType: string;
  artifactPath: string;
  reviewers: PhaseDisciplineReviewerSpec[];
  succeeded: string[];
  failed: Array<{ reviewer: string; error: string }>;
  overall: string;
  startedAt: string;
  completedAt: string;
  reviewerMetrics?: ReviewerAttemptMetrics[];
}): void {
  const artifactDir = dirname(input.artifactPath);
  const logDir = join(artifactDir, ".phase-discipline");
  mkdirSync(logDir, { recursive: true });
  const startMs = new Date(input.startedAt).getTime();
  const endMs = new Date(input.completedAt).getTime();
  const logPath = join(logDir, `${input.hookName}-${sanitizeForFileName(input.triggerUnitId)}.json`);
  writeFileSync(logPath, JSON.stringify({
    hookName: input.hookName,
    triggerUnitType: input.triggerUnitType,
    triggerUnitId: input.triggerUnitId,
    artifactPath: input.artifactPath,
    reviewers: input.reviewers,
    succeeded: input.succeeded,
    failed: input.failed,
    overall: input.overall,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    wallClockMs: endMs - startMs,
    reviewerMetrics: input.reviewerMetrics ?? [],
  }, null, 2), "utf8");
}

function writeReviewerRawLog(input: {
  artifactPath: string;
  hookName: string;
  triggerUnitId: string;
  reviewerIndex: number;
  rawOutput: string;
  stderrOutput: string;
}): void {
  const logDir = join(dirname(input.artifactPath), ".phase-discipline");
  mkdirSync(logDir, { recursive: true });
  const stem = `${input.hookName}-${sanitizeForFileName(input.triggerUnitId)}-reviewer${input.reviewerIndex}`;
  if (input.rawOutput) {
    writeFileSync(join(logDir, `${stem}-stdout.log`), input.rawOutput, "utf8");
  }
  if (input.stderrOutput) {
    writeFileSync(join(logDir, `${stem}-stderr.log`), input.stderrOutput, "utf8");
  }
}

function defaultPickReviewers(input: {
  mainModel: string;
  mainProvider?: string;
  count: number;
}): PhaseDisciplineReviewerSpec[] {
  const reviewers: PhaseDisciplineReviewerSpec[] = [];
  for (let i = 0; i < input.count; i += 1) {
    const picked = pickReviewerModel({
      mainModel: input.mainModel,
      mainProvider: input.mainProvider,
      env: process.env,
    });
    reviewers.push({ model: picked.model, provider: picked.provider });
  }
  return reviewers;
}

function mergeFindings(results: Awaited<ReturnType<typeof runReview>>[]): {
  overallAssessment: "pass" | "issues" | "fail";
  critical: Array<{ id: string; target: string; rationale: string }>;
  important: Array<{ id: string; target: string; rationale: string }>;
  minor: Array<{ id: string; target: string; rationale: string }>;
  rationale: string[];
} {
  const order = { pass: 0, issues: 1, fail: 2 } as const;
  let overallAssessment: "pass" | "issues" | "fail" = "pass";
  const critical = new Map<string, { id: string; target: string; rationale: string }>();
  const important = new Map<string, { id: string; target: string; rationale: string }>();
  const minor = new Map<string, { id: string; target: string; rationale: string }>();
  const rationale: string[] = [];

  for (const result of results) {
    if (order[result.review.overall_assessment] > order[overallAssessment]) {
      overallAssessment = result.review.overall_assessment;
    }
    for (const item of result.review.critical) critical.set(`${item.id}:${item.target}:${item.rationale}`, item);
    for (const item of result.review.important) important.set(`${item.id}:${item.target}:${item.rationale}`, item);
    for (const item of result.review.minor) minor.set(`${item.id}:${item.target}:${item.rationale}`, item);
    if (result.review.rationale) rationale.push(result.review.rationale);
  }

  return {
    overallAssessment,
    critical: [...critical.values()],
    important: [...important.values()],
    minor: [...minor.values()],
    rationale,
  };
}

function renderArtifactMarkdown(input: {
  hookName: string;
  triggerUnitType: string;
  triggerUnitId: string;
  reviewers: PhaseDisciplineReviewerSpec[];
  targetPath: string | null;
  merged: ReturnType<typeof mergeFindings>;
}): string {
  const lines: string[] = [
    `# ${input.hookName}`,
    "",
    `- Trigger: ${input.triggerUnitType} ${input.triggerUnitId}`,
    `- Overall Assessment: ${input.merged.overallAssessment}`,
    `- Target Artifact: ${input.targetPath ?? "(missing)"}`,
    "",
    "## Reviewers",
  ];

  for (const reviewer of input.reviewers) {
    lines.push(`- ${reviewer.provider}/${reviewer.model}`);
  }

  const sections: Array<[string, Array<{ id: string; target: string; rationale: string }>]> = [
    ["Critical", input.merged.critical],
    ["Important", input.merged.important],
    ["Minor", input.merged.minor],
  ];

  for (const [title, items] of sections) {
    lines.push("", `## ${title}`);
    if (items.length === 0) {
      lines.push("- None");
      continue;
    }
    for (const item of items) {
      lines.push(`- [${item.id}] ${item.target} — ${item.rationale}`);
    }
  }

  if (input.merged.rationale.length > 0) {
    lines.push("", "## Reviewer Rationale");
    for (const rationale of input.merged.rationale) {
      lines.push(`- ${rationale}`);
    }
  }

  return lines.join("\n");
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

export async function runPhaseDisciplineReviewerHook(
  input: RunPhaseDisciplineReviewerHookInput,
): Promise<PhaseDisciplineReviewerHookResult> {
  const startedAt = new Date().toISOString();
  const primary = resolvePrimaryReviewer(input);
  const reviewerCount = Math.max(1, Math.min(5, input.hookConfig.cross_review ?? 1));
  const extraReviewerCount = Math.max(0, reviewerCount - 1);
  const reviewers: PhaseDisciplineReviewerSpec[] = [primary];
  const succeeded: string[] = [];
  const failed: Array<{ reviewer: string; error: string }> = [];

  if (extraReviewerCount > 0) {
    if (input.hookConfig.cross_review_models?.length) {
      reviewers.push(
        ...input.hookConfig.cross_review_models
          .slice(0, extraReviewerCount)
          .map((model) => resolveReviewerSpec(model, input.hookConfig.provider?.trim())),
      );
    } else {
      const picker = input.pickReviewers ?? defaultPickReviewers;
      reviewers.push(
        ...picker({
          mainModel: primary.model,
          mainProvider: primary.provider,
          count: extraReviewerCount,
        }).slice(0, extraReviewerCount),
      );
    }
  }

  const targetPath = resolveExpectedArtifactPath(input.triggerUnitType, input.triggerUnitId, input.basePath);
  const targetContent = targetPath && existsSync(targetPath)
    ? readFileSync(targetPath, "utf8")
    : "";
  const artifactPath = resolveHookArtifactPath(
    input.basePath,
    input.triggerUnitId,
    input.hookConfig.artifact ?? `${input.hookName.toUpperCase()}.md`,
  );
  const retryPath = input.hookConfig.retry_on
    ? resolveHookArtifactPath(input.basePath, input.triggerUnitId, input.hookConfig.retry_on)
    : null;

  const reviewPrompt = [
    input.hookConfig.prompt,
    "",
    `Review the completed ${input.triggerUnitType} artifact for ${input.triggerUnitId}.`,
    `Return YAML with keys: overall_assessment, critical, important, minor, rationale.`,
  ].join("\n");
  const systemPrompt = [
    "You are a strict software reviewer.",
    "Return only YAML with keys overall_assessment, critical, important, minor, rationale.",
    "overall_assessment must be one of: pass, issues, fail.",
    "Each finding item must include id, target, rationale.",
  ].join("\n");

  if (!targetContent) {
    const fallbackArtifact = [
      `# ${input.hookName}`,
      "",
      `- Trigger: ${input.triggerUnitType} ${input.triggerUnitId}`,
      `- Overall Assessment: fail`,
      `- Target Artifact: ${(targetPath ?? "(missing)")}`,
      "",
      "## Critical",
      "- [missing-artifact] target-artifact — expected trigger artifact was not found for review",
    ].join("\n");
    ensureParentDir(artifactPath);
    writeFileSync(artifactPath, fallbackArtifact, "utf8");
    if (retryPath) {
      ensureParentDir(retryPath);
      writeFileSync(retryPath, `retry requested by ${input.hookName}\n`, "utf8");
    }
    writeObservabilityLog({
      basePath: input.basePath,
      hookName: input.hookName,
      triggerUnitId: input.triggerUnitId,
      triggerUnitType: input.triggerUnitType,
      artifactPath,
      reviewers,
      succeeded,
      failed,
      overall: "reviewer_unavailable",
      startedAt,
      completedAt: new Date().toISOString(),
    });
    return {
      artifactPath,
      retryRequested: Boolean(retryPath),
      overallAssessment: "fail",
      reviewers,
    };
  }

  const runReviewImpl = input.runReviewImpl ?? runReview;
  const reviewerMetrics: ReviewerAttemptMetrics[] = [];
  const settled = await Promise.allSettled(
    reviewers.map((reviewer) => runReviewWithTimeout(
      runReviewImpl,
      reviewer,
      input,
      systemPrompt,
      reviewPrompt,
      targetContent,
    )),
  );
  const results = [] as Awaited<ReturnType<typeof runReview>>[];
  settled.forEach((entry, index) => {
    const reviewer = reviewers[index];
    const reviewerKey = `${reviewer.provider}/${reviewer.model}`;
    if (entry.status === "fulfilled") {
      results.push(entry.value);
      succeeded.push(reviewerKey);
      const lastAttempt = entry.value.attempts[entry.value.attempts.length - 1];
      reviewerMetrics.push({
        reviewer: reviewerKey,
        status: "succeeded",
        outputChars: lastAttempt?.rawOutput?.length ?? 0,
        attempts: entry.value.attempts.length,
      });
      writeReviewerRawLog({
        artifactPath,
        hookName: input.hookName,
        triggerUnitId: input.triggerUnitId,
        reviewerIndex: index,
        rawOutput: lastAttempt?.rawOutput ?? "",
        stderrOutput: lastAttempt?.stderrOutput ?? "",
      });
      return;
    }
    const errorMessage = entry.reason instanceof ReviewerCoreError
      ? entry.reason.message
      : entry.reason instanceof Error
        ? entry.reason.message
        : String(entry.reason);
    logWarning(
      "dispatch",
      `phase-discipline reviewer ${reviewerKey} failed for ${input.triggerUnitType} ${input.triggerUnitId}: ${errorMessage}`,
    );
    failed.push({ reviewer: reviewerKey, error: errorMessage });
    const failedAttempts = entry.reason instanceof ReviewerCoreError ? entry.reason.attempts : [];
    const lastFailedAttempt = failedAttempts[failedAttempts.length - 1];
    reviewerMetrics.push({
      reviewer: reviewerKey,
      status: "failed",
      error: errorMessage,
      outputChars: lastFailedAttempt?.rawOutput?.length ?? 0,
      attempts: failedAttempts.length || 1,
    });
    if (lastFailedAttempt) {
      writeReviewerRawLog({
        artifactPath,
        hookName: input.hookName,
        triggerUnitId: input.triggerUnitId,
        reviewerIndex: index,
        rawOutput: lastFailedAttempt.rawOutput ?? "",
        stderrOutput: lastFailedAttempt.stderrOutput ?? "",
      });
    }
  });

  // OQ-4: If all reviewers failed and model_fallbacks are configured, try fallbacks in order
  if (results.length === 0 && input.hookConfig.model_fallbacks?.length) {
    for (const fallbackModelStr of input.hookConfig.model_fallbacks) {
      const fallbackSpec = resolveReviewerSpec(fallbackModelStr);
      const fallbackKey = `${fallbackSpec.provider}/${fallbackSpec.model}`;
      try {
        const fallbackResult = await runReviewWithTimeout(
          runReviewImpl,
          fallbackSpec,
          input,
          systemPrompt,
          reviewPrompt,
          targetContent,
        );
        results.push(fallbackResult);
        succeeded.push(fallbackKey);
        const lastAttempt = fallbackResult.attempts[fallbackResult.attempts.length - 1];
        reviewerMetrics.push({
          reviewer: fallbackKey,
          status: "fallback_succeeded",
          outputChars: lastAttempt?.rawOutput?.length ?? 0,
          attempts: fallbackResult.attempts.length,
        });
        writeReviewerRawLog({
          artifactPath,
          hookName: input.hookName,
          triggerUnitId: input.triggerUnitId,
          reviewerIndex: reviewers.length + input.hookConfig.model_fallbacks.indexOf(fallbackModelStr),
          rawOutput: lastAttempt?.rawOutput ?? "",
          stderrOutput: lastAttempt?.stderrOutput ?? "",
        });
        logWarning(
          "dispatch",
          `phase-discipline reviewer fallback ${fallbackKey} succeeded for ${input.triggerUnitType} ${input.triggerUnitId}`,
        );
        break;
      } catch (fbErr) {
        const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
        logWarning(
          "dispatch",
          `phase-discipline reviewer fallback ${fallbackKey} also failed for ${input.triggerUnitType} ${input.triggerUnitId}: ${fbMsg}`,
        );
        failed.push({ reviewer: `fallback:${fallbackKey}`, error: fbMsg });
        reviewerMetrics.push({
          reviewer: `fallback:${fallbackKey}`,
          status: "failed",
          error: fbMsg,
          outputChars: 0,
          attempts: 1,
        });
      }
    }
  }

  if (results.length === 0) {
    const fallbackArtifact = [
      `# ${input.hookName}`,
      "",
      `- Trigger: ${input.triggerUnitType} ${input.triggerUnitId}`,
      `- Overall Assessment: reviewer_unavailable`,
      `- Target Artifact: ${(targetPath ?? "(missing)")}`,
      "",
      "## Critical",
      "- [reviewer-subprocess-failure] reviewer-subprocess — all reviewers failed before producing a parseable review result",
    ].join("\n");
    ensureParentDir(artifactPath);
    writeFileSync(artifactPath, fallbackArtifact, "utf8");
    if (retryPath) {
      ensureParentDir(retryPath);
      writeFileSync(retryPath, `retry requested by ${input.hookName}\n`, "utf8");
    }
    writeObservabilityLog({
      basePath: input.basePath,
      hookName: input.hookName,
      triggerUnitId: input.triggerUnitId,
      triggerUnitType: input.triggerUnitType,
      artifactPath,
      reviewers,
      succeeded,
      failed,
      overall: "reviewer_unavailable",
      startedAt,
      completedAt: new Date().toISOString(),
      reviewerMetrics,
    });
    return {
      artifactPath,
      retryRequested: Boolean(retryPath),
      overallAssessment: "fail",
      reviewers,
    };
  }

  const merged = mergeFindings(results);
  const artifactMarkdown = renderArtifactMarkdown({
    hookName: input.hookName,
    triggerUnitType: input.triggerUnitType,
    triggerUnitId: input.triggerUnitId,
    reviewers,
    targetPath,
    merged,
  });
  ensureParentDir(artifactPath);
  writeFileSync(artifactPath, artifactMarkdown, "utf8");

  const retryRequested = merged.overallAssessment !== "pass" && Boolean(retryPath);
  if (retryRequested && retryPath) {
    ensureParentDir(retryPath);
    writeFileSync(retryPath, `retry requested by ${input.hookName}\n`, "utf8");
  } else {
    clearRetryArtifact(retryPath);
  }

  writeObservabilityLog({
    basePath: input.basePath,
    hookName: input.hookName,
    triggerUnitId: input.triggerUnitId,
    triggerUnitType: input.triggerUnitType,
    artifactPath,
    reviewers,
    succeeded,
    failed,
    overall: merged.overallAssessment,
    startedAt,
    completedAt: new Date().toISOString(),
    reviewerMetrics,
  });

  return {
    artifactPath,
    retryRequested,
    overallAssessment: merged.overallAssessment,
    reviewers,
  };
}

export async function maybeRunPhaseDisciplineBuiltInHook(input: {
  unitType: string;
  basePath: string;
  hookState: HookExecutionState | null;
  hookConfig: PostUnitHookConfig | undefined;
  currentModel?: { id?: string; provider?: string } | null;
}): Promise<boolean> {
  if (!input.hookState || !input.hookConfig) {
    return false;
  }

  const handledByImplPlanValidator = await maybeRunPhaseDisciplineImplPlanBuiltInHook({
    unitType: input.unitType,
    basePath: input.basePath,
    hookState: input.hookState,
    hookConfig: input.hookConfig,
  });
  if (handledByImplPlanValidator) {
    return true;
  }
  const builtin = input.hookConfig.builtin?.trim();
  if (builtin === "phase-discipline-verify-fuse") {
    await runPhaseDisciplineVerifyFuseHook({
      hookName: input.hookState.hookName,
      triggerUnitId: input.hookState.triggerUnitId,
      basePath: input.basePath,
      hookConfig: input.hookConfig,
    });
    return true;
  }
  if (
    builtin !== "phase-discipline-code-review"
    && builtin !== "phase-discipline-design-review"
  ) {
    return false;
  }
  await runPhaseDisciplineReviewerHook({
    hookName: input.hookState.hookName,
    triggerUnitType: input.hookState.triggerUnitType,
    triggerUnitId: input.hookState.triggerUnitId,
    basePath: input.basePath,
    hookConfig: input.hookConfig,
    currentModel: input.currentModel,
  });
  return true;
}
