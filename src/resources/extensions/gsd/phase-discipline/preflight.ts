import type { GSDModelConfigV2, GSDPhaseModelConfig, GSDPreferences } from "../preferences-types.js";
import type { PhaseDisciplineCheckIssue, PostUnitHookConfig, PreDispatchHookConfig } from "../types.js";
import { resolveModelId } from "../auto-model-selection.js";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "./preset.js";
import { inferProvider } from "../shared-harness/index.js";

interface ModelLike {
  provider: string;
  id: string;
}

export interface PhaseDisciplinePreflightModelRegistry {
  getAvailable(): ModelLike[];
  isProviderRequestReady(provider: string): boolean;
  getProviderAuthMode?(provider: string): string;
}

export type PhaseDisciplinePreflightRequirementKind = "main" | "provider";

export interface PhaseDisciplinePreflightRequirement {
  role: string;
  source: string;
  provider: string;
  model: string;
  kind: PhaseDisciplinePreflightRequirementKind;
  optional?: boolean;
}

export interface PhaseDisciplinePreflightIssue extends PhaseDisciplineCheckIssue {
  role: string;
  source: string;
  provider: string;
  model: string;
  reason: "provider_not_ready" | "model_not_available" | "fallback_used" | "provider_resolution_failed" | "connectivity_failed";
  authMode?: string;
  detail: string;
}

/**
 * Connectivity probe callback — injected by caller (auto-start.ts / auto.ts)
 * to avoid coupling preflight.ts to any specific SDK or HTTP client.
 *
 * Returns { ok: true } if the provider/model is reachable, or { ok: false, error }
 * with a human-readable error string.
 */
export type ConnectivityProbe = (
  provider: string,
  model: string,
  timeoutMs: number,
) => Promise<{ ok: boolean; error?: string }>;

export interface ConnectivityPingTarget {
  provider: string;
  model: string;
  role: string;
}

export interface PhaseDisciplinePreflightResult {
  ok: boolean;
  checked: PhaseDisciplinePreflightRequirement[];
  issues: PhaseDisciplinePreflightIssue[];
  failures: PhaseDisciplinePreflightIssue[];
  warnings: PhaseDisciplinePreflightIssue[];
}

export interface PhaseDisciplinePreflightInput {
  preferences?: GSDPreferences | null;
  modelRegistry: PhaseDisciplinePreflightModelRegistry;
  sessionProvider?: string;
  /** Whether to execute actual connectivity probes (default: false). */
  connectivityCheck?: boolean;
  /** Ping timeout in ms (default: 5000). */
  connectivityTimeoutMs?: number;
  /** Injected probe function — decoupled from SDK/HTTP specifics. */
  connectivityProbe?: ConnectivityProbe;
}

const MAIN_MODEL_PHASES = [
  "research",
  "planning",
  "discuss",
  "execution",
  "execution_simple",
  "completion",
  "validation",
  "subagent",
] as const;

type MainModelPhase = (typeof MAIN_MODEL_PHASES)[number];

function splitModelRef(model: string, provider?: string, sessionProvider?: string): { provider: string; model: string } | null {
  const trimmedModel = model.trim();
  const trimmedProvider = provider?.trim();
  if (!trimmedModel) return null;
  if (trimmedModel.includes("/")) {
    const slashIdx = trimmedModel.indexOf("/");
    const maybeProvider = trimmedModel.slice(0, slashIdx).trim();
    const id = trimmedModel.slice(slashIdx + 1).trim();
    if (maybeProvider && id) return { provider: maybeProvider, model: id };
  }
  const resolvedProvider = trimmedProvider || sessionProvider?.trim() || inferProvider(trimmedModel);
  if (!resolvedProvider || resolvedProvider === "unknown") return null;
  return { provider: resolvedProvider, model: trimmedModel };
}

function modelRefString(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function addMainRequirement(
  requirements: PhaseDisciplinePreflightRequirement[],
  phase: MainModelPhase,
  cfg: string | GSDPhaseModelConfig | undefined,
  sessionProvider: string | undefined,
): void {
  if (!cfg) return;
  if (typeof cfg === "string") {
    const resolved = splitModelRef(cfg, undefined, sessionProvider);
    if (!resolved) {
      requirements.push({
        role: `main:${phase}`,
        source: `preferences.models.${phase}`,
        provider: "unknown",
        model: cfg,
        kind: "main",
      });
      return;
    }
    requirements.push({
      role: `main:${phase}`,
      source: `preferences.models.${phase}`,
      provider: resolved.provider,
      model: resolved.model,
      kind: "main",
    });
    return;
  }

  const primary = splitModelRef(cfg.model, cfg.provider, sessionProvider);
  if (!primary) {
    requirements.push({
      role: `main:${phase}`,
      source: `preferences.models.${phase}`,
      provider: "unknown",
      model: cfg.model,
      kind: "main",
    });
  } else {
    requirements.push({
      role: `main:${phase}`,
      source: `preferences.models.${phase}`,
      provider: primary.provider,
      model: primary.model,
      kind: "main",
    });
  }

  for (const fallback of cfg.fallbacks ?? []) {
    const resolvedFallback = splitModelRef(fallback, cfg.provider, sessionProvider);
    requirements.push({
      role: `main:${phase}:fallback`,
      source: `preferences.models.${phase}.fallbacks`,
      provider: resolvedFallback?.provider ?? "unknown",
      model: resolvedFallback?.model ?? fallback,
      kind: "main",
      optional: true,
    });
  }
}

function addHookModelRequirement(
  requirements: PhaseDisciplinePreflightRequirement[],
  role: string,
  source: string,
  model: string | undefined,
  provider: string | undefined,
  sessionProvider: string | undefined,
  optional = false,
): void {
  if (!model?.trim()) return;
  const resolved = splitModelRef(model, provider, sessionProvider);
  requirements.push({
    role,
    source,
    provider: resolved?.provider ?? "unknown",
    model: resolved?.model ?? model,
    kind: "provider",
    optional,
  });
}

export function collectPhaseDisciplinePreflightRequirements(
  preferences: GSDPreferences | undefined | null,
  sessionProvider?: string,
): PhaseDisciplinePreflightRequirement[] {
  if (preferences?.milestone_profile !== "phase-discipline-8step") return [];

  const requirements: PhaseDisciplinePreflightRequirement[] = [];
  const models = preferences.models as GSDModelConfigV2 | undefined;
  for (const phase of MAIN_MODEL_PHASES) {
    addMainRequirement(requirements, phase, models?.[phase], sessionProvider);
  }

  for (const hook of preferences.pre_dispatch_hooks ?? []) {
    if (hook.enabled === false) continue;
    collectPreDispatchHookRequirement(requirements, hook, sessionProvider);
  }

  for (const hook of preferences.post_unit_hooks ?? []) {
    if (hook.enabled === false) continue;
    collectPostUnitHookRequirement(requirements, hook, sessionProvider);
  }

  return requirements;
}

function collectPreDispatchHookRequirement(
  requirements: PhaseDisciplinePreflightRequirement[],
  hook: PreDispatchHookConfig,
  sessionProvider: string | undefined,
): void {
  if (hook.builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut) {
    addHookModelRequirement(
      requirements,
      "pre-dispatch:scout-fanout",
      `pre_dispatch_hooks.${hook.name}`,
      hook.model,
      hook.provider,
      sessionProvider,
    );
    return;
  }

  addHookModelRequirement(
    requirements,
    `pre-dispatch:${hook.name}`,
    `pre_dispatch_hooks.${hook.name}`,
    hook.model,
    hook.provider,
    sessionProvider,
  );
}

function collectPostUnitHookRequirement(
  requirements: PhaseDisciplinePreflightRequirement[],
  hook: PostUnitHookConfig,
  sessionProvider: string | undefined,
): void {
  const builtin = hook.builtin?.trim();
  if (builtin !== PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview && builtin !== PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview) {
    addHookModelRequirement(
      requirements,
      `post-unit:${hook.name}`,
      `post_unit_hooks.${hook.name}`,
      hook.model,
      hook.provider,
      sessionProvider,
    );
    return;
  }

  const reviewerRole = builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview
    ? "reviewer:code-review"
    : "reviewer:design-review";
  addHookModelRequirement(
    requirements,
    reviewerRole,
    `post_unit_hooks.${hook.name}`,
    hook.model,
    hook.provider,
    sessionProvider,
  );

  for (const model of hook.cross_review_models ?? []) {
    addHookModelRequirement(
      requirements,
      `${reviewerRole}:cross-review`,
      `post_unit_hooks.${hook.name}.cross_review_models`,
      model,
      hook.provider,
      sessionProvider,
      true,
    );
  }

  for (const model of hook.model_fallbacks ?? []) {
    addHookModelRequirement(
      requirements,
      `${reviewerRole}:fallback`,
      `post_unit_hooks.${hook.name}.model_fallbacks`,
      model,
      undefined,
      sessionProvider,
      true,
    );
  }
}

function providerReady(registry: PhaseDisciplinePreflightModelRegistry, provider: string): boolean {
  try {
    return registry.isProviderRequestReady(provider);
  } catch {
    return false;
  }
}

function authMode(registry: PhaseDisciplinePreflightModelRegistry, provider: string): string | undefined {
  try {
    return registry.getProviderAuthMode?.(provider);
  } catch {
    return undefined;
  }
}

function issueForRequirement(
  requirement: PhaseDisciplinePreflightRequirement,
  reason: PhaseDisciplinePreflightIssue["reason"],
  level: PhaseDisciplinePreflightIssue["level"],
  detail: string,
  registry: PhaseDisciplinePreflightModelRegistry,
): PhaseDisciplinePreflightIssue {
  return {
    code: reason,
    level,
    stage: "bootstrap",
    role: requirement.role,
    source: requirement.source,
    provider: requirement.provider,
    model: requirement.model,
    reason,
    authMode: authMode(registry, requirement.provider),
    detail,
  };
}

/**
 * Collect unique provider+model pairs that need connectivity verification.
 * Only non-optional requirements with a known provider are included.
 */
export function collectPingTargets(
  checked: PhaseDisciplinePreflightRequirement[],
): ConnectivityPingTarget[] {
  const seen = new Set<string>();
  const targets: ConnectivityPingTarget[] = [];

  for (const req of checked) {
    if (req.optional || req.provider === "unknown") continue;
    const key = `${req.provider}/${req.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ provider: req.provider, model: req.model, role: req.role });
  }
  return targets;
}

export async function validatePhaseDisciplinePreflight(input: PhaseDisciplinePreflightInput): Promise<PhaseDisciplinePreflightResult> {
  const checked = collectPhaseDisciplinePreflightRequirements(input.preferences, input.sessionProvider);
  const failures: PhaseDisciplinePreflightIssue[] = [];
  const warnings: PhaseDisciplinePreflightIssue[] = [];
  const available = input.modelRegistry.getAvailable();

  for (const requirement of checked) {
    if (requirement.provider === "unknown") {
      const target = requirement.optional ? warnings : failures;
      target.push(issueForRequirement(
        requirement,
        "provider_resolution_failed",
        requirement.optional ? "warning" : "fatal",
        `Could not resolve provider for ${requirement.model}. Use provider/model or set provider explicitly.`,
        input.modelRegistry,
      ));
      continue;
    }

    if (!providerReady(input.modelRegistry, requirement.provider)) {
      const target = requirement.optional ? warnings : failures;
      target.push(issueForRequirement(
        requirement,
        "provider_not_ready",
        requirement.optional ? "warning" : "fatal",
        `Provider ${requirement.provider} is not request-ready.`,
        input.modelRegistry,
      ));
      continue;
    }

    if (requirement.kind !== "main") continue;

    const match = resolveModelId(modelRefString(requirement.provider, requirement.model), available, input.sessionProvider);
    if (match) continue;

    if (!requirement.optional) {
      const fallback = checked.find((candidate) =>
        candidate.role === `${requirement.role}:fallback`
        && candidate.kind === "main"
        && candidate.provider !== "unknown"
        && providerReady(input.modelRegistry, candidate.provider)
        && !!resolveModelId(modelRefString(candidate.provider, candidate.model), available, input.sessionProvider)
      );
      if (fallback) {
        warnings.push(issueForRequirement(
          requirement,
          "fallback_used",
          "warning",
          `Primary model ${modelRefString(requirement.provider, requirement.model)} is not available; fallback ${modelRefString(fallback.provider, fallback.model)} is available.`,
          input.modelRegistry,
        ));
        continue;
      }
    }

    const target = requirement.optional ? warnings : failures;
    target.push(issueForRequirement(
      requirement,
      "model_not_available",
      requirement.optional ? "warning" : "fatal",
      `Model ${modelRefString(requirement.provider, requirement.model)} is not in available models.`,
      input.modelRegistry,
    ));
  }

  const issues = [...failures, ...warnings];

  // ── Connectivity ping: only when explicitly enabled and registry checks passed ──
  // Runs AFTER registry validation so config errors surface first without network delay.
  if (input.connectivityCheck && input.connectivityProbe && failures.length === 0) {
    const timeoutMs = input.connectivityTimeoutMs ?? 5000;
    const targets = collectPingTargets(checked);
    const results = await Promise.allSettled(
      targets.map(t => input.connectivityProbe!(t.provider, t.model, timeoutMs)),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const t = targets[i]!;
      if (r.status === "rejected" || !r.value.ok) {
        const error = r.status === "rejected"
          ? String(r.reason)
          : r.value.error ?? "unknown";
        const issue: PhaseDisciplinePreflightIssue = {
          code: "connectivity_failed",
          level: "fatal",
          stage: "bootstrap",
          role: t.role,
          source: "connectivity-ping",
          provider: t.provider,
          model: t.model,
          reason: "connectivity_failed",
          detail: `Ping to ${t.provider}/${t.model} failed: ${error}`,
        };
        failures.push(issue);
        issues.push(issue);
      }
    }
  }

  return {
    ok: failures.length === 0,
    checked,
    issues,
    failures,
    warnings,
  };
}

export function formatPhaseDisciplinePreflightFailure(result: Pick<PhaseDisciplinePreflightResult, "failures" | "warnings">): string {
  const lines = [
    `Phase-discipline preflight failed: ${result.failures.length} model/provider check${result.failures.length === 1 ? "" : "s"} failed.`,
  ];
  result.failures.forEach((failure, index) => {
    lines.push(
      `${index + 1}. ${failure.role}: ${modelRefString(failure.provider, failure.model)} from ${failure.source}`,
      `   reason: ${failure.reason}${failure.authMode ? `, authMode: ${failure.authMode}` : ""}`,
      `   detail: ${failure.detail}`,
    );
  });
  if (result.warnings.length > 0) {
    lines.push(`Warnings: ${result.warnings.length}`);
    result.warnings.forEach((warning) => {
      lines.push(`- ${warning.role}: ${warning.detail}`);
    });
  }
  return lines.join("\n");
}
