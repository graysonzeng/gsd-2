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
  mainModel: string;
  mainProvider?: string;
  env: NodeJS.ProcessEnv;
  isProviderReady?: (provider: string) => boolean;
}

function normalizeTrim(value: string | undefined | null): string {
  return (value ?? "").trim();
}

export function pickReviewerModel(input: PickReviewerInput): PickerResult {
  const { mainModel, env } = input;
  const mainProvider = normalizeTrim(input.mainProvider) || inferProvider(mainModel);
  const ready: (p: string) => boolean = input.isProviderReady ?? ((p) => defaultEnvReady(p, env));

  const explicitReviewerModel = normalizeTrim(env.GSD_COMPOSED_LITE_REVIEWER_MODEL);
  const explicitReviewerProvider = normalizeTrim(env.GSD_COMPOSED_LITE_REVIEWER_PROVIDER);
  if (explicitReviewerModel || explicitReviewerProvider) {
    const provider = explicitReviewerProvider || inferProvider(explicitReviewerModel);
    if (!provider || provider === "unknown") {
      throw new ReviewerUnavailableError(
        `Explicit reviewer override requires a resolvable provider. ` +
        `model="${explicitReviewerModel}", provider="${explicitReviewerProvider || provider}". ` +
        `Set GSD_COMPOSED_LITE_REVIEWER_PROVIDER to one of: anthropic | openai | google | claude-code.`,
      );
    }
    const model = explicitReviewerModel || defaultReviewerModel(provider);
    if (!model) {
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

  const candidates: Array<{ provider: string }> = [
    { provider: "anthropic" },
    { provider: "openai" },
    { provider: "google" },
  ].filter((candidate) => candidate.provider !== mainProvider);

  for (const candidate of candidates) {
    if (ready(candidate.provider)) {
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
