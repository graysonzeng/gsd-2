/**
 * Unit tests for composed-lite/model-arg (Sprint 1c).
 *
 * `buildModelArg` and `resolveMainModelArg` are shared between the reviewer
 * and main-agent spawners. These tests pin the small but load-bearing rules
 * that the bigger integration loop depends on.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModelArg,
  resolveInitialMainModel,
  resolveInitialMainModelProvider,
  resolveMainModelArg,
} from "../composed-lite/model-arg.js";
import type { ComposedLiteState } from "../composed-lite/types.js";

function makeState(overrides: Partial<ComposedLiteState["review"]>): ComposedLiteState {
  return {
    review: {
      main_model: "",
      main_model_provider: null,
      reviewer_model: null,
      reviewer_provider: null,
      cross_provider: false,
      fallback_self_review: false,
      ...overrides,
    },
  } as ComposedLiteState;
}

// ─── buildModelArg ───────────────────────────────────────────────────────

test("buildModelArg returns bare model when provider is empty", () => {
  assert.equal(buildModelArg("gpt-5.4", ""), "gpt-5.4");
  assert.equal(buildModelArg("gpt-5.4", null), "gpt-5.4");
  assert.equal(buildModelArg("gpt-5.4", undefined), "gpt-5.4");
});

test("buildModelArg qualifies with provider/ when provider is set", () => {
  assert.equal(
    buildModelArg("claude-sonnet-4-6", "anthropic"),
    "anthropic/claude-sonnet-4-6",
  );
  assert.equal(
    buildModelArg("claude-sonnet-4-6", "claude-code"),
    "claude-code/claude-sonnet-4-6",
  );
});

test("buildModelArg trims whitespace-only provider strings", () => {
  assert.equal(buildModelArg("gpt-5.4", "   "), "gpt-5.4");
});

test("buildModelArg does not double-prefix already-qualified ids", () => {
  // Scenario: user sets reviewer_model="openrouter/google/gemini-2.5-pro"
  // and reviewer_provider="openrouter". We must not produce
  // "openrouter/openrouter/google/gemini-2.5-pro".
  assert.equal(
    buildModelArg("openrouter/google/gemini-2.5-pro", "openrouter"),
    "openrouter/google/gemini-2.5-pro",
  );
});

// ─── resolveMainModelArg ─────────────────────────────────────────────────

test("resolveMainModelArg returns null when main_model is empty", () => {
  assert.equal(resolveMainModelArg(makeState({ main_model: "" })), null);
});

test("resolveMainModelArg returns null for the 'unknown' sentinel", () => {
  // The runner sets main_model = "unknown" when no env / session model is
  // available. Forcing that onto children would break them; always fall
  // back to the child CLI's own default.
  assert.equal(resolveMainModelArg(makeState({ main_model: "unknown" })), null);
});

test("resolveMainModelArg returns bare id when no provider override", () => {
  const state = makeState({ main_model: "gpt-5.4", main_model_provider: null });
  assert.equal(resolveMainModelArg(state), "gpt-5.4");
});

test("resolveMainModelArg qualifies with provider when main_model_provider is set", () => {
  const state = makeState({
    main_model: "claude-sonnet-4-6",
    main_model_provider: "anthropic",
  });
  assert.equal(resolveMainModelArg(state), "anthropic/claude-sonnet-4-6");
});

test("resolveMainModelArg treats whitespace-only main_model as no override", () => {
  const state = makeState({ main_model: "   " });
  assert.equal(resolveMainModelArg(state), null);
});

test("resolveMainModelArg is safe when state.review is missing", () => {
  // Defensive: the helper should not throw even if callers pass a partial
  // state shape. Used by source-level regression tests as well.
  assert.equal(resolveMainModelArg({} as ComposedLiteState), null);
});

// ─── resolveInitialMainModel* ────────────────────────────────────────────

test("resolveInitialMainModel prefers explicit composed-lite override", () => {
  assert.equal(resolveInitialMainModel({
    GSD_COMPOSED_LITE_MAIN_MODEL: "openai/gpt-5.4",
    GSD_SESSION_MODEL: "claude-opus-4-6",
    ANTHROPIC_MODEL: "claude-opus-4-6",
  }), "openai/gpt-5.4");
});

test("resolveInitialMainModel falls back to session model but not ANTHROPIC_MODEL", () => {
  assert.equal(resolveInitialMainModel({
    GSD_SESSION_MODEL: "gpt-5.4",
    ANTHROPIC_MODEL: "claude-opus-4-6",
  }), "gpt-5.4");

  assert.equal(resolveInitialMainModel({
    ANTHROPIC_MODEL: "claude-opus-4-6",
  }), "unknown");
});

test("resolveInitialMainModelProvider only honors explicit composed-lite provider override", () => {
  assert.equal(resolveInitialMainModelProvider({
    GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER: "openai",
  }), "openai");
  assert.equal(resolveInitialMainModelProvider({
    GSD_COMPOSED_LITE_MAIN_MODEL_PROVIDER: "   ",
  }), null);
});
