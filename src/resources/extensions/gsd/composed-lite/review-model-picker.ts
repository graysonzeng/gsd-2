/**
 * composed-lite/review-model-picker.ts — Cross-provider reviewer model selection.
 *
 * Contract C2: Cross-provider reviewer, failure → fuse.
 *
 * Resolution order (v2, see docs/dev/proposals/windsurf-composed-lite-integration.md):
 *
 * 1. If GSD_COMPOSED_LITE_REVIEWER_MODEL or GSD_COMPOSED_LITE_REVIEWER_PROVIDER is set,
 *    use the explicit override and validate readiness; otherwise throw
 *    ReviewerUnavailableError.
 * 2. Otherwise, pick the first ready cross-provider candidate from
 *    [anthropic, openai, google] and use its default model id.
 * 3. Fallback to self-review only when GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1 and
 *    GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1.
 *
 * Readiness is determined by the caller-supplied `isProviderReady` callback
 * (defaults to an env-var based check). This lets callers plug in
 * `ModelRegistry.isProviderRequestReady` so auth.json and externalCli providers
 * (e.g. `claude-code`) are correctly recognized.
 */

export class ReviewerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewerUnavailableError";
  }
}

interface PickerResult {
  model: string;
  provider: string;
  crossProvider: boolean;
  fallbackSelfReview: boolean;
}

/**
 * Determine main model provider from model ID string.
 *
 * Best-effort substring match. Callers that need deterministic provider
 * selection should pass `mainProvider` explicitly to `pickReviewerModel`.
 */
function inferProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus") || lower.includes("haiku")) {
    return "anthropic";
  }
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("codex")) {
    return "openai";
  }
  if (lower.includes("gemini")) {
    return "google";
  }
  if (lower.includes("deepseek")) {
    return "deepseek";
  }
  if (lower.includes("glm") || lower.includes("hunyuan") || lower.includes("minimax") || lower.includes("kimi")) {
    return "other-cn";
  }
  return "unknown";
}

/**
 * Default env-based readiness check.
 *
 * Only sees apiKey-mode providers via well-known env vars. Callers that
 * want full coverage (auth.json, externalCli, oauth) should pass their
 * own `isProviderReady` callback, typically bound to
 * `ModelRegistry.isProviderRequestReady`.
 */
function defaultEnvReady(provider: string, env: NodeJS.ProcessEnv): boolean {
  switch (provider) {
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(env.OPENAI_API_KEY);
    case "google":
      return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
    default:
      return false;
  }
}

/**
 * Get the default reviewer model for a given provider, or `null` when the
 * provider has no vetted default.
 *
 * Model ids intentionally match the ids registered in
 * `packages/pi-ai/src/models/generated/anthropic.ts`
 * (and the `claude-code` extension), which use connector style
 * (`claude-sonnet-4-6`, not `claude-sonnet-4.6`). CLI `--model` matching is
 * exact, so a mismatched id here silently falls back to the session model
 * and defeats cross-provider review entirely (v1 → v2 B0 fix).
 *
 * Returning `null` (instead of an arbitrary fallback like `claude-sonnet-4-6`)
 * forces the caller to require `GSD_COMPOSED_LITE_REVIEWER_MODEL` from the
 * user — otherwise the picker would silently mis-bill `openai-codex`,
 * `github-copilot`, or any other provider whose default model nobody vetted.
 */
function defaultReviewerModel(provider: string): string | null {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-6";
    case "openai":
      return "gpt-5.4";
    case "google":
      return "gemini-2.5-pro";
    case "claude-code":
      return "claude-sonnet-4-6";
    default:
      return null;
  }
}

export interface PickReviewerInput {
  /** Current main model id (e.g. `gpt-5.4`). */
  mainModel: string;
  /**
   * Explicit main provider (e.g. from `GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER`).
   * When provided, skips substring-based provider inference on `mainModel`.
   */
  mainProvider?: string;
  /** Process env snapshot used for override parsing and default readiness. */
  env: NodeJS.ProcessEnv;
  /**
   * Per-provider readiness check. Defaults to an env-var-only implementation.
   * Inject `ModelRegistry.isProviderRequestReady.bind(registry)` to cover
   * `auth.json`, OAuth, and externalCli providers.
   */
  isProviderReady?: (provider: string) => boolean;
}

function normalizeTrim(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/**
 * Pick a reviewer model that is cross-provider from the main model.
 *
 * See module docstring for resolution order.
 */
export function pickReviewerModel(input: PickReviewerInput): PickerResult {
  const { mainModel, env } = input;
  const mainProvider = normalizeTrim(input.mainProvider) || inferProvider(mainModel);
  const ready: (p: string) => boolean = input.isProviderReady ?? ((p) => defaultEnvReady(p, env));

  // ── Explicit reviewer override ────────────────────────────────────────────
  const explicitReviewerModel = normalizeTrim(env.GSD_COMPOSED_LITE_REVIEWER_MODEL);
  const explicitReviewerProvider = normalizeTrim(env.GSD_COMPOSED_LITE_REVIEWER_PROVIDER);
  if (explicitReviewerModel || explicitReviewerProvider) {
    const provider = explicitReviewerProvider || inferProvider(explicitReviewerModel);
    if (!provider || provider === "unknown") {
      throw new ReviewerUnavailableError(
        `Explicit reviewer override requires a resolvable provider. ` +
        `model="${explicitReviewerModel}", provider="${explicitReviewerProvider || provider}". ` +
        // Keep this list in sync with defaultReviewerModel() + isProviderReady coverage.
        // openai-codex / codex is intentionally omitted until Phase 2B lands the
        // externalCli plumbing and a verified default reviewer model mapping.
        `Set GSD_COMPOSED_LITE_REVIEWER_PROVIDER to one of: anthropic | openai | google | claude-code.`,
      );
    }
    const model = explicitReviewerModel || defaultReviewerModel(provider);
    if (!model) {
      // Known-default model missing for this provider — force the user to be
      // explicit. This prevents silently mis-routing to `claude-sonnet-4-6`
      // on unvetted providers (e.g. `openai-codex`, `github-copilot`).
      throw new ReviewerUnavailableError(
        `Explicit reviewer provider "${provider}" has no vetted default model. ` +
        `Also set GSD_COMPOSED_LITE_REVIEWER_MODEL to a concrete id registered on that provider.`,
      );
    }
    if (!ready(provider)) {
      throw new ReviewerUnavailableError(
        `Explicit reviewer ${provider}/${model} is not available — provider not ready. ` +
        `Ensure credentials for ${provider} are configured (auth.json or env var) ` +
        `or the matching external CLI is installed and logged in.`,
      );
    }
    const crossProvider = provider !== mainProvider;
    return {
      model,
      provider,
      crossProvider,
      fallbackSelfReview: !crossProvider,
    };
  }

  // ── Cross-provider auto-selection ─────────────────────────────────────────
  const candidates: Array<{ provider: string }> = [
    { provider: "anthropic" },
    { provider: "openai" },
    { provider: "google" },
  ].filter(c => c.provider !== mainProvider);

  for (const candidate of candidates) {
    if (ready(candidate.provider)) {
      // The auto-selection list only contains providers with vetted defaults,
      // so defaultReviewerModel is guaranteed non-null here — assert it to
      // keep the return type honest.
      const model = defaultReviewerModel(candidate.provider);
      if (!model) continue;
      return {
        model,
        provider: candidate.provider,
        crossProvider: true,
        fallbackSelfReview: false,
      };
    }
  }

  // ── Self-review escape hatch ──────────────────────────────────────────────
  const allowSelfReview = env.GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW === "1";
  const fallbackContinue = env.GSD_COMPOSED_LITE_FALLBACK_CONTINUE === "1";

  if (allowSelfReview && fallbackContinue) {
    return {
      model: mainModel,
      provider: mainProvider,
      crossProvider: false,
      fallbackSelfReview: true,
    };
  }

  throw new ReviewerUnavailableError(
    `No cross-provider reviewer available. Main model: ${mainModel} (${mainProvider}). ` +
    `Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for an alternate provider, ` +
    `or configure a reviewer explicitly via GSD_COMPOSED_LITE_REVIEWER_MODEL + GSD_COMPOSED_LITE_REVIEWER_PROVIDER. ` +
    `Set GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1 and GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1 to allow same-provider review (not recommended).`,
  );
}

export { inferProvider, defaultReviewerModel };
