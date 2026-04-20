/**
 * composed-lite/review-model-picker.ts — Cross-provider reviewer model selection.
 *
 * Contract C2: Cross-provider reviewer, failure → fuse.
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
 * Check if a provider has credentials available in env.
 */
function hasProviderCredentials(provider: string, env: NodeJS.ProcessEnv): boolean {
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
 * Get the default reviewer model for a given provider.
 */
function defaultReviewerModel(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4.6";
    case "openai":
      return "gpt-5.4";
    case "google":
      return "gemini-2.5-pro";
    default:
      return "claude-sonnet-4.6";
  }
}

/**
 * Pick a reviewer model that is cross-provider from the main model.
 *
 * Strict mode (default): throws ReviewerUnavailableError if no cross-provider available.
 * Env var escape hatch: GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1
 */
export function pickReviewerModel(input: {
  mainModel: string;
  env: NodeJS.ProcessEnv;
}): PickerResult {
  const { mainModel, env } = input;
  const mainProvider = inferProvider(mainModel);

  // Try cross-provider candidates in priority order
  const candidates: Array<{ provider: string; priority: number }> = [
    { provider: "anthropic", priority: 1 },
    { provider: "openai", priority: 2 },
    { provider: "google", priority: 3 },
  ].filter(c => c.provider !== mainProvider);

  for (const candidate of candidates) {
    if (hasProviderCredentials(candidate.provider, env)) {
      return {
        model: defaultReviewerModel(candidate.provider),
        provider: candidate.provider,
        crossProvider: true,
        fallbackSelfReview: false,
      };
    }
  }

  // No cross-provider available — check escape hatch
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
    `Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for an alternate provider. ` +
    `Or set GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW=1 and GSD_COMPOSED_LITE_FALLBACK_CONTINUE=1 to allow same-provider review (not recommended).`
  );
}

export { inferProvider };
