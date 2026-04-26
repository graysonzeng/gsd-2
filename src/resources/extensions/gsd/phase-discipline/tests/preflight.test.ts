import assert from "node:assert/strict";
import test from "node:test";

import { applyPhaseDisciplinePreset } from "../merge.ts";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "../preset.ts";
import { formatPhaseDisciplinePreflightFailure, validatePhaseDisciplinePreflight } from "../preflight.ts";
import type { GSDPreferences } from "../../preferences-types.ts";

function registry(input: {
  available: Array<{ provider: string; id: string }>;
  ready: string[];
  authModes?: Record<string, string>;
}) {
  const ready = new Set(input.ready);
  return {
    getAvailable: () => input.available,
    isProviderRequestReady: (provider: string) => ready.has(provider),
    getProviderAuthMode: (provider: string) => input.authModes?.[provider] ?? "apiKey",
  };
}

function phasePrefs(overrides: GSDPreferences = {}): GSDPreferences {
  return applyPhaseDisciplinePreset({
    milestone_profile: "phase-discipline-8step",
    ...overrides,
  }).preferences;
}

test("phase-discipline preflight is a no-op when profile is not enabled", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: {},
    modelRegistry: registry({ available: [], ready: [] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checked.length, 0);
  assert.equal(result.issues.length, 0);
});

test("phase-discipline preflight fails before auto when a required preset provider is not ready", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai"],
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.role === "reviewer:code-review"));
  assert.ok(result.failures.some((failure) => failure.role === "reviewer:design-review"));
  assert.ok(result.issues.some((issue) => issue.stage === "bootstrap" && issue.level === "fatal" && issue.code === "provider_not_ready"));
  assert.match(formatPhaseDisciplinePreflightFailure(result), /anthropic\/claude-opus-4-6/);
});

test("phase-discipline preflight validates reviewer and scout providers without requiring hook models in getAvailable", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.issues.length, 0);
  assert.ok(result.checked.some((entry) => entry.role === "pre-dispatch:scout-fanout"));
  assert.ok(result.checked.some((entry) => entry.role === "reviewer:code-review"));
  assert.ok(result.checked.some((entry) => entry.role === "reviewer:design-review"));
});

test("phase-discipline preflight skips disabled hooks", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: phasePrefs({
      post_unit_hooks: [
        {
          name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
          after: ["execute-task"],
          prompt: "custom disabled code review",
          builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
          model: "claude-opus-4-6",
          provider: "anthropic",
          enabled: false,
        },
        {
          name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview,
          after: ["plan-slice"],
          prompt: "custom disabled design review",
          builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview,
          model: "claude-opus-4-6",
          provider: "anthropic",
          enabled: false,
        },
      ],
    }),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai"],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.checked.some((entry) => entry.provider === "anthropic"), false);
  assert.equal(result.issues.length, 0);
});

test("phase-discipline preflight allows a main model phase when an available fallback can run", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: phasePrefs({
      models: {
        execution: {
          model: "missing-gpt",
          provider: "openai",
          fallbacks: ["openai/gpt-5.4"],
        },
      },
    }),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
  });

  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.role === "main:execution"));
  assert.ok(result.issues.some((issue) => issue.level === "warning" && issue.code === "fallback_used"));
});

test("phase-discipline preflight treats unavailable fallback-only models as warnings when primary can run", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: phasePrefs({
      models: {
        execution: {
          model: "gpt-5.4",
          provider: "openai",
          fallbacks: ["anthropic/claude-opus-4-6"],
        },
      },
    }),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.some((warning) => warning.role === "main:execution:fallback"));
  assert.ok(result.issues.some((issue) => issue.level === "warning" && issue.code === "model_not_available"));
});

test("phase-discipline preflight lets unqualified main-model fallbacks inherit the configured provider", () => {
  const result = validatePhaseDisciplinePreflight({
    preferences: phasePrefs({
      models: {
        execution: {
          model: "missing-primary",
          provider: "sandboxai",
          fallbacks: ["fallback-model"],
        },
      },
    }),
    modelRegistry: registry({
      available: [
        { provider: "openai", id: "gpt-5.4" },
        { provider: "sandboxai", id: "fallback-model" },
      ],
      ready: ["openai", "anthropic", "sandboxai"],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.some((warning) => warning.role === "main:execution" && warning.reason === "fallback_used"));
  assert.ok(result.issues.some((issue) => issue.level === "warning" && issue.code === "fallback_used"));
});
