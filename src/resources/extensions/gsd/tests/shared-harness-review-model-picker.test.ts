import test from "node:test";
import assert from "node:assert/strict";

import {
  ReviewerUnavailableError,
  defaultReviewerModel,
  inferProvider,
  pickReviewerModel,
} from "../shared-harness/review-model-picker.js";

test("inferProvider infers mainstream providers from model ids", () => {
  assert.equal(inferProvider("gpt-5.4"), "openai");
  assert.equal(inferProvider("claude-opus-4-6"), "anthropic");
  assert.equal(inferProvider("gemini-2.5-pro"), "google");
});

test("defaultReviewerModel returns vetted defaults", () => {
  assert.equal(defaultReviewerModel("openai"), "gpt-5.4");
  assert.equal(defaultReviewerModel("anthropic"), "claude-sonnet-4-6");
  assert.equal(defaultReviewerModel("unknown"), null);
});

test("pickReviewerModel honors explicit reviewer override", () => {
  const result = pickReviewerModel({
    mainModel: "gpt-5.4",
    mainProvider: "openai",
    env: {
      GSD_COMPOSED_LITE_REVIEWER_MODEL: "claude-opus-4-6",
      GSD_COMPOSED_LITE_REVIEWER_PROVIDER: "claude-code",
    },
    isProviderReady: () => true,
  });

  assert.equal(result.model, "claude-opus-4-6");
  assert.equal(result.provider, "claude-code");
  assert.equal(result.crossProvider, true);
  assert.equal(result.fallbackSelfReview, false);
});

test("pickReviewerModel throws when no cross-provider reviewer is ready", () => {
  assert.throws(
    () => pickReviewerModel({
      mainModel: "gpt-5.4",
      mainProvider: "openai",
      env: {},
      isProviderReady: () => false,
    }),
    ReviewerUnavailableError,
  );
});
