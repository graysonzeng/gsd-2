/**
 * composed-lite/model-arg.ts — Shared helpers for building CLI `--model`
 * arguments when spawning main-agent subagents (scout / design / split /
 * worker) and the reviewer.
 *
 * GSD's CLI matches `--model` against the registry in two passes:
 *   1. exact match on `m.id`
 *   2. exact match on `${m.provider}/${m.id}`
 *
 * Several providers register the same id (anthropic + claude-code +
 * opencode all expose `claude-sonnet-4-6`), so a bare id silently binds to
 * whichever provider is listed first — which breaks the reviewer picker's
 * cross-provider contract (C2) and can mis-route billing for main roles.
 * When we know the provider, always emit `${provider}/${id}`.
 */

import type { ComposedLiteState } from "./types.js";

function normalizeTrim(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Resolve the initial main model for a composed-lite run.
 *
 * Only explicit composed-lite/session-scoped sources are allowed here.
 * Falling back to broad globals like `ANTHROPIC_MODEL` silently drifts the
 * runtime onto whichever provider happens to be exported in the shell.
 */
export function resolveInitialMainModel(env: NodeJS.ProcessEnv): string {
  return normalizeTrim(env.GSD_COMPOSED_LITE_MAIN_MODEL)
    || normalizeTrim(env.GSD_SESSION_MODEL)
    || "unknown";
}

/**
 * Resolve an explicit main-model provider override for composed-lite.
 */
export function resolveInitialMainModelProvider(env: NodeJS.ProcessEnv): string | null {
  return normalizeTrim(env.GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER) || null;
}

/**
 * Format a `--model` argument, qualifying with `provider/` when known.
 *
 * Already-qualified ids pass through unchanged (so callers can safely feed
 * user-supplied strings like `openrouter/google/gemini-2.5-pro`).
 */
export function buildModelArg(model: string, provider: string | null | undefined): string {
  const trimmedProvider = (provider ?? "").trim();
  if (!trimmedProvider) {
    return model;
  }
  if (model.startsWith(`${trimmedProvider}/`)) {
    return model;
  }
  return `${trimmedProvider}/${model}`;
}

/**
 * Resolve the `--model` argument for main-agent subagents from composed-lite
 * state, populated at run start by `runComposedLite` from
 * `GSD_COMPOSED_LITE_MAIN_MODEL` (+ optional `_PROVIDER`).
 *
 * Returns `null` when no usable override is configured, in which case the
 * spawner should NOT append `--model` to the CLI args — letting the child
 * GSD CLI fall back to its session default (current behaviour).
 *
 * The `"unknown"` sentinel (emitted by the runner when no env / session
 * model is available) is deliberately treated as "no override".
 */
export function resolveMainModelArg(state: ComposedLiteState): string | null {
  const model = (state.review?.main_model ?? "").trim();
  if (!model || model === "unknown") {
    return null;
  }
  const provider = state.review?.main_model_provider;
  return buildModelArg(model, provider);
}
