import assert from "node:assert/strict";
import test from "node:test";

import { applyPhaseDisciplinePreset } from "../merge.ts";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "../preset.ts";
import { collectPingTargets, formatPhaseDisciplinePreflightFailure, validatePhaseDisciplinePreflight } from "../preflight.ts";
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

test("phase-discipline preflight is a no-op when profile is not enabled", async () => {
  const result = await validatePhaseDisciplinePreflight({
    preferences: {},
    modelRegistry: registry({ available: [], ready: [] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checked.length, 0);
  assert.equal(result.issues.length, 0);
});

test("phase-discipline preflight fails before auto when a required preset provider is not ready", async () => {
  const result = await validatePhaseDisciplinePreflight({
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

test("phase-discipline preflight validates reviewer and scout providers without requiring hook models in getAvailable", async () => {
  const result = await validatePhaseDisciplinePreflight({
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

test("phase-discipline preflight skips disabled hooks", async () => {
  const result = await validatePhaseDisciplinePreflight({
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

test("phase-discipline preflight allows a main model phase when an available fallback can run", async () => {
  const result = await validatePhaseDisciplinePreflight({
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

test("phase-discipline preflight treats unavailable fallback-only models as warnings when primary can run", async () => {
  const result = await validatePhaseDisciplinePreflight({
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

test("phase-discipline preflight lets unqualified main-model fallbacks inherit the configured provider", async () => {
  const result = await validatePhaseDisciplinePreflight({
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

// ── Connectivity probe tests ─────────────────────────────────────────────────

test("connectivity probe: all reachable → preflight ok", async () => {
  const probe = async () => ({ ok: true as const });
  const result = await validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
    connectivityCheck: true,
    connectivityProbe: probe,
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
});

test("connectivity probe: one provider unreachable → preflight failure", async () => {
  const probe = async (provider: string) => {
    if (provider === "anthropic") return { ok: false as const, error: "503 Service Unavailable" };
    return { ok: true as const };
  };
  const result = await validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
    connectivityCheck: true,
    connectivityProbe: probe,
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.reason === "connectivity_failed" && f.provider === "anthropic"));
  assert.match(formatPhaseDisciplinePreflightFailure(result), /connectivity/i);
});

test("connectivity probe: probe exception → preflight failure", async () => {
  const probe = async () => { throw new Error("network timeout"); };
  const result = await validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
    connectivityCheck: true,
    connectivityProbe: probe,
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.reason === "connectivity_failed"));
});

test("connectivity probe: skipped when connectivityCheck is false", async () => {
  let called = false;
  const probe = async () => { called = true; return { ok: false as const, error: "should not be called" }; };
  const result = await validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
    connectivityCheck: false,
    connectivityProbe: probe,
  });

  assert.equal(result.ok, true);
  assert.equal(called, false);
});

test("connectivity probe: skipped when no probe function provided", async () => {
  const result = await validatePhaseDisciplinePreflight({
    preferences: phasePrefs(),
    modelRegistry: registry({
      available: [{ provider: "openai", id: "gpt-5.4" }],
      ready: ["openai", "anthropic"],
    }),
    connectivityCheck: true,
    // no connectivityProbe
  });

  assert.equal(result.ok, true);
});

test("collectPingTargets deduplicates same provider+model across roles", () => {
  const targets = collectPingTargets([
    { role: "main:execution", source: "preferences.models.execution", provider: "openai", model: "gpt-5.4", kind: "main" },
    { role: "main:research", source: "preferences.models.research", provider: "openai", model: "gpt-5.4", kind: "main" },
    { role: "reviewer:code-review", source: "post_unit_hooks.code-review", provider: "anthropic", model: "claude-opus-4-6", kind: "provider" },
  ]);

  assert.equal(targets.length, 2);
  assert.ok(targets.some((t) => t.provider === "openai" && t.model === "gpt-5.4"));
  assert.ok(targets.some((t) => t.provider === "anthropic" && t.model === "claude-opus-4-6"));
});

test("collectPingTargets skips optional and unknown-provider requirements", () => {
  const targets = collectPingTargets([
    { role: "main:execution", source: "s", provider: "openai", model: "gpt-5.4", kind: "main" },
    { role: "main:execution:fallback", source: "s", provider: "openai", model: "gpt-5.3", kind: "main", optional: true },
    { role: "main:research", source: "s", provider: "unknown", model: "bad-model", kind: "main" },
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0]!.provider, "openai");
  assert.equal(targets[0]!.model, "gpt-5.4");
});

// ── createDefaultConnectivityProbe integration tests ─────────────────────────

import { createDefaultConnectivityProbe } from "../connectivity-probe.ts";

test("createDefaultConnectivityProbe: CLI-auth providers always return ok", async () => {
  const mockRegistry = {
    getProviderAuthMode: () => "externalCli",
    getApiKeyForProvider: async () => undefined,
    find: () => undefined,
  };
  const probe = createDefaultConnectivityProbe(mockRegistry);
  const result = await probe("claude-code", "claude-opus-4-6", 1000);
  assert.equal(result.ok, true);
});

test("createDefaultConnectivityProbe: returns ok:false on 500+ status", async () => {
  // Mock fetch globally for this test
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503, statusText: "Service Unavailable" });
  try {
    const mockRegistry = {
      getProviderAuthMode: () => "apiKey",
      getApiKeyForProvider: async () => "test-key",
      find: () => ({ baseUrl: "https://api.openai.com" }),
    };
    const probe = createDefaultConnectivityProbe(mockRegistry);
    const result = await probe("openai", "gpt-5.4", 5000);
    assert.equal(result.ok, false);
    assert.match(result.error!, /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createDefaultConnectivityProbe: returns ok:true on 4xx (auth issue = reachable)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401, statusText: "Unauthorized" });
  try {
    const mockRegistry = {
      getProviderAuthMode: () => "apiKey",
      getApiKeyForProvider: async () => "bad-key",
      find: () => ({ baseUrl: "https://api.openai.com" }),
    };
    const probe = createDefaultConnectivityProbe(mockRegistry);
    const result = await probe("openai", "gpt-5.4", 5000);
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createDefaultConnectivityProbe: returns ok:false on network error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const mockRegistry = {
      getProviderAuthMode: () => "apiKey",
      getApiKeyForProvider: async () => "test-key",
      find: () => ({ baseUrl: "https://api.openai.com" }),
    };
    const probe = createDefaultConnectivityProbe(mockRegistry);
    const result = await probe("openai", "gpt-5.4", 5000);
    assert.equal(result.ok, false);
    assert.match(result.error!, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createDefaultConnectivityProbe: skips probe when no baseUrl resolvable and provider unknown", async () => {
  const mockRegistry = {
    getProviderAuthMode: () => "apiKey",
    getApiKeyForProvider: async () => "test-key",
    find: () => undefined,
  };
  const probe = createDefaultConnectivityProbe(mockRegistry);
  // Provider "custom-unknown" has no default URL — should skip gracefully
  const result = await probe("custom-unknown", "some-model", 5000);
  assert.equal(result.ok, true);
});

test("auto-mode preflight with real probe: provider 503 causes startup failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503, statusText: "Service Unavailable" });
  try {
    const mockRegistry = {
      getAvailable: () => [{ provider: "openai", id: "gpt-5.4" }],
      isProviderRequestReady: (provider: string) => ["openai", "anthropic"].includes(provider),
      getProviderAuthMode: () => "apiKey",
      getApiKeyForProvider: async () => "test-key",
      find: (_p: string, _m: string) => ({ baseUrl: "https://api.openai.com" }),
    };
    const probe = createDefaultConnectivityProbe(mockRegistry);
    const result = await validatePhaseDisciplinePreflight({
      preferences: phasePrefs(),
      modelRegistry: mockRegistry,
      connectivityCheck: true,
      connectivityProbe: probe,
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.reason === "connectivity_failed"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
