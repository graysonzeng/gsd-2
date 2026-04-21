/**
 * Regression tests for composed-lite/review-model-picker (v2).
 *
 * Covers the Sprint 1a bug fixes:
 *   - B0  default reviewer model ids match the registry (connector style)
 *   - B1  picker defers readiness to an injectable callback (so it can see
 *         auth.json + externalCli providers, not just env vars)
 *   - B4  explicit main-provider override skips inferProvider
 *   - B5  explicit reviewer model/provider override is validated & surfaced
 *   - Self-review escape hatch still works with empty env (no API keys).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  pickReviewerModel,
  ReviewerUnavailableError,
  inferProvider,
  defaultReviewerModel,
} from "../composed-lite/review-model-picker.js";

const EMPTY_ENV: NodeJS.ProcessEnv = {};

function withKeys(env: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return { ...EMPTY_ENV, ...env } as NodeJS.ProcessEnv;
}

// ─── B0: default reviewer model ids ───────────────────────────────────────

test("B0: anthropic default reviewer uses connector-style id (not dotted)", () => {
  const id = defaultReviewerModel("anthropic");
  assert.equal(id, "claude-sonnet-4-6", "must match registry id `claude-sonnet-4-6`");
  assert.ok(id && !id.includes("."), "dotted ids never match the anthropic registry");
});

test("B0: claude-code default reviewer uses the same connector-style id", () => {
  assert.equal(defaultReviewerModel("claude-code"), "claude-sonnet-4-6");
});

test("B0: openai and google defaults stay dotted (match their registries)", () => {
  assert.equal(defaultReviewerModel("openai"), "gpt-5.4");
  assert.equal(defaultReviewerModel("google"), "gemini-2.5-pro");
});

test("B0 (hardened): unvetted providers return null instead of leaking claude-sonnet-4-6", () => {
  // Hardening from Sprint 1c review: previously defaultReviewerModel("openai-codex")
  // (or any unknown provider) fell through to `claude-sonnet-4-6`. The picker
  // now treats this as a missing default so users are forced to be explicit
  // rather than silently mis-billing the wrong provider.
  assert.equal(defaultReviewerModel("openai-codex"), null);
  assert.equal(defaultReviewerModel("github-copilot"), null);
  assert.equal(defaultReviewerModel("unknown-provider-xyz"), null);
});

// ─── B0 live-bug end-to-end ───────────────────────────────────────────────

test("B0 regression: gpt-5.4 main model + anthropic env picks claude-sonnet-4-6", () => {
  const env = withKeys({ ANTHROPIC_API_KEY: "sk-test" });
  const result = pickReviewerModel({ mainModel: "gpt-5.4", env });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.crossProvider, true);
  assert.equal(result.fallbackSelfReview, false);
});

// ─── B1: isProviderReady injection ────────────────────────────────────────

test("B1: picker uses injected isProviderReady instead of env", () => {
  // No env keys at all, but injection says anthropic is ready (simulates
  // auth.json-only credentials or an externalCli provider that's logged in).
  const result = pickReviewerModel({
    mainModel: "gpt-5.4",
    env: EMPTY_ENV,
    isProviderReady: (p) => p === "anthropic",
  });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.crossProvider, true);
});

test("B1: env key is ignored when isProviderReady rejects the provider", () => {
  // Env has an anthropic key but the registry says the provider is not
  // ready (e.g. oauth cred expired). Picker must respect the injection.
  const env = withKeys({ ANTHROPIC_API_KEY: "sk-test", OPENAI_API_KEY: "sk-openai" });
  const result = pickReviewerModel({
    mainModel: "gpt-5.4", // main = openai → looks for anthropic/google first
    env,
    isProviderReady: (p) => p === "google", // only google ready
  });
  assert.equal(result.provider, "google");
});

// ─── B4: explicit main provider override ──────────────────────────────────

test("B4: mainProvider override skips substring inference", () => {
  const env = withKeys({ ANTHROPIC_API_KEY: "sk-test" });
  // "some-custom-alias" would infer to "unknown"; explicit openai provider
  // should flip the preference and let anthropic win cross-provider.
  const result = pickReviewerModel({
    mainModel: "some-custom-alias",
    mainProvider: "openai",
    env,
  });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.crossProvider, true);
});

test("B4: without mainProvider, inferProvider drives fallback", () => {
  assert.equal(inferProvider("gpt-5.4"), "openai");
  assert.equal(inferProvider("claude-opus-4-6"), "anthropic");
  assert.equal(inferProvider("gemini-2.5-pro"), "google");
  assert.equal(inferProvider("unknown-alias"), "unknown");
});

// ─── B5: reviewer model/provider override ─────────────────────────────────

test("B5: reviewer override with both env vars wins and validates readiness", () => {
  const env = withKeys({
    ANTHROPIC_API_KEY: "sk-test",
    GSD_COMPOSED_LITE_REVIEWER_MODEL: "claude-opus-4-6",
    GSD_COMPOSED_LITE_REVIEWER_PROVIDER: "anthropic",
  });
  const result = pickReviewerModel({ mainModel: "gpt-5.4", env });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-opus-4-6");
  assert.equal(result.crossProvider, true);
});

test("B5: reviewer override with provider only picks the provider's default model", () => {
  const env = withKeys({
    ANTHROPIC_API_KEY: "sk-test",
    GSD_COMPOSED_LITE_REVIEWER_PROVIDER: "anthropic",
  });
  const result = pickReviewerModel({ mainModel: "gpt-5.4", env });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-sonnet-4-6");
});

test("B5: reviewer override throws when provider is not ready", () => {
  const env = withKeys({
    // No ANTHROPIC_API_KEY here.
    GSD_COMPOSED_LITE_REVIEWER_MODEL: "claude-opus-4-6",
    GSD_COMPOSED_LITE_REVIEWER_PROVIDER: "anthropic",
  });
  assert.throws(
    () => pickReviewerModel({ mainModel: "gpt-5.4", env }),
    (err: unknown) => {
      assert.ok(err instanceof ReviewerUnavailableError);
      assert.match((err as Error).message, /not available/);
      assert.match((err as Error).message, /anthropic\/claude-opus-4-6/);
      return true;
    },
  );
});

test("B5 (hardened): reviewer provider without vetted default demands explicit model", () => {
  // Claude-Code-review Important #1: before hardening, setting
  // REVIEWER_PROVIDER=openai-codex would silently select claude-sonnet-4-6
  // and mis-bill the wrong provider. Now the picker refuses and demands
  // the user also set REVIEWER_MODEL.
  const env = withKeys({
    GSD_COMPOSED_LITE_REVIEWER_PROVIDER: "openai-codex",
    // No GSD_COMPOSED_LITE_REVIEWER_MODEL.
  });
  assert.throws(
    () =>
      pickReviewerModel({
        mainModel: "gpt-5.4",
        env,
        isProviderReady: () => true, // isolate the "no vetted default" check
      }),
    (err: unknown) => {
      assert.ok(err instanceof ReviewerUnavailableError);
      assert.match((err as Error).message, /no vetted default model/);
      assert.match((err as Error).message, /GSD_COMPOSED_LITE_REVIEWER_MODEL/);
      return true;
    },
  );
});

test("B5 (hardened): picker error text no longer advertises unsupported `codex` provider", () => {
  // Claude-Code-review Important #1: the error string used to say
  // "one of: anthropic | openai | google | claude-code | codex", which
  // would lead users to set REVIEWER_PROVIDER=codex and hit the
  // misleading default-model fall-through. Keep `codex` out of that list
  // until Phase 2B lands proper externalCli support.
  const env = withKeys({ GSD_COMPOSED_LITE_REVIEWER_MODEL: "mystery-model-xyz" });
  try {
    pickReviewerModel({ mainModel: "gpt-5.4", env });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof ReviewerUnavailableError);
    const message = (err as Error).message;
    assert.doesNotMatch(message, /\bcodex\b/);
    assert.match(message, /anthropic \| openai \| google \| claude-code/);
  }
});

test("B5: reviewer override with unresolvable provider throws descriptively", () => {
  const env = withKeys({
    GSD_COMPOSED_LITE_REVIEWER_MODEL: "mystery-model-xyz",
    // No GSD_COMPOSED_LITE_REVIEWER_PROVIDER.
  });
  assert.throws(
    () => pickReviewerModel({ mainModel: "gpt-5.4", env }),
    (err: unknown) => {
      assert.ok(err instanceof ReviewerUnavailableError);
      assert.match(
        (err as Error).message,
        /Explicit reviewer override requires a resolvable provider/,
      );
      return true;
    },
  );
});

test("B5: reviewer override forces self-review when provider matches main provider", () => {
  const env = withKeys({
    ANTHROPIC_API_KEY: "sk-test",
    GSD_COMPOSED_LITE_REVIEWER_MODEL: "claude-opus-4-7",
    GSD_COMPOSED_LITE_REVIEWER_PROVIDER: "anthropic",
  });
  // mainModel is also anthropic — picker should still honour the explicit
  // override (users who ask for same-provider review own the consequences).
  const result = pickReviewerModel({ mainModel: "claude-sonnet-4-6", env });
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-opus-4-7");
  assert.equal(result.crossProvider, false);
  assert.equal(result.fallbackSelfReview, true);
});

// ─── Self-review escape hatch ─────────────────────────────────────────────

test("no cross-provider, no override, no escape hatch → ReviewerUnavailableError", () => {
  assert.throws(
    () =>
      pickReviewerModel({
        mainModel: "gpt-5.4",
        env: EMPTY_ENV,
        isProviderReady: () => false,
      }),
    (err: unknown) => err instanceof ReviewerUnavailableError,
  );
});

test("self-review escape hatch activates with both env flags", () => {
  const env = withKeys({
    GSD_COMPOSED_LITE_ALLOW_SELF_REVIEW: "1",
    GSD_COMPOSED_LITE_FALLBACK_CONTINUE: "1",
  });
  const result = pickReviewerModel({
    mainModel: "gpt-5.4",
    env,
    isProviderReady: () => false,
  });
  assert.equal(result.fallbackSelfReview, true);
  assert.equal(result.crossProvider, false);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.4");
});
