import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectDoctorConfig } from "../doctor-config.ts";
import { _clearGsdRootCache } from "../paths.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withProject<T>(fn: (ctx: { projectDir: string; gsdHome: string; settingsPath: string; authPath: string; modelsPath: string }) => T): T {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalGsdHome = process.env.GSD_HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "gsd-doctor-config-project-")));
  const gsdHome = realpathSync(mkdtempSync(join(tmpdir(), "gsd-doctor-config-home-")));
  const settingsPath = join(projectDir, ".pi", "settings.json");
  const authPath = join(gsdHome, "agent", "auth.json");
  const modelsPath = join(gsdHome, "agent", "models.json");

  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  mkdirSync(join(projectDir, ".gsd"), { recursive: true });
  mkdirSync(join(gsdHome, "agent"), { recursive: true });

  try {
    process.chdir(projectDir);
    process.env.HOME = gsdHome;
    process.env.GSD_HOME = gsdHome;
    process.env.PI_CODING_AGENT_DIR = join(gsdHome, "agent");
    _clearGsdRootCache();
    return fn({ projectDir, gsdHome, settingsPath, authPath, modelsPath });
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    _clearGsdRootCache();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(gsdHome, { recursive: true, force: true });
  }
}

function getFinding(findings: ReturnType<typeof inspectDoctorConfig>, scope: string) {
  return findings.find((finding) => finding.scope === scope);
}

test("inspectDoctorConfig reports malformed models.json without suppressing other findings", () => {
  withProject(({ settingsPath, modelsPath }) => {
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" }, null, 2));
    writeFileSync(modelsPath, "{ invalid json\n", "utf-8");

    withEnv({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_OAUTH_TOKEN: undefined, PATH: process.env.PATH }, () => {
      const findings = inspectDoctorConfig();

      const models = getFinding(findings, "models");
      const settings = getFinding(findings, "settings");
      const availability = getFinding(findings, "key_model");
      const auth = getFinding(findings, "auth");
      const preferences = findings.filter((finding) => finding.scope === "preferences");

      assert.ok(models, "models finding should exist");
      assert.equal(models!.code, "models_json_invalid");
      assert.equal(models!.severity, "error");
      assert.match(models!.message, /could not be parsed/i);

      assert.ok(settings, "settings finding should still exist despite broken models.json");
      assert.equal(settings!.code, "default_model_fallback");
      assert.equal(settings!.severity, "warning");
      assert.match(settings!.message, /would fall back/i);

      assert.ok(availability, "key model finding should still exist despite broken models.json");
      assert.equal(availability!.code, "key_model_fallback");
      assert.equal(availability!.severity, "warning");

      assert.ok(auth, "auth finding should still exist despite broken models.json");
      assert.equal(auth!.code, "config_surface_ok");
      assert.equal(preferences.length, 2, "both preference-scope findings should be preserved");
    });
  });
});

test("inspectDoctorConfig reports malformed auth.json without leaking secrets", () => {
  withProject(({ authPath, modelsPath }) => {
    writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2));
    writeFileSync(authPath, '{"anthropic":', "utf-8");

    const before = readFileSync(authPath, "utf-8");
    const findings = inspectDoctorConfig();
    const after = readFileSync(authPath, "utf-8");

    const auth = getFinding(findings, "auth");
    assert.ok(auth, "auth finding should exist");
    assert.equal(auth!.code, "auth_json_invalid");
    assert.equal(auth!.severity, "error");
    assert.match(auth!.message, /could not be loaded/i);
    assert.equal(after, before, "doctor config inspection must not mutate auth.json");
    assert.ok(!auth!.message.includes("sk-"), "error output must not echo secret-looking tokens");
  });
});

test("inspectDoctorConfig reports key model availability fallback when configured default model is unavailable but a provider fallback exists", () => {
  withProject(({ settingsPath, authPath }) => {
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "does-not-exist" }, null, 2));
    writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test" } }, null, 2));

    const before = readFileSync(settingsPath, "utf-8");
    const findings = inspectDoctorConfig();
    const after = readFileSync(settingsPath, "utf-8");

    const settings = getFinding(findings, "settings");
    const availability = getFinding(findings, "key_model");
    assert.ok(settings, "settings finding should exist");
    assert.equal(settings!.code, "default_model_fallback");
    assert.equal(settings!.severity, "warning");
    assert.match(settings!.message, /would fall back/i);
    assert.match(settings!.detail ?? "", /effective runtime default:/i);

    assert.ok(availability, "key model finding should exist");
    assert.equal(availability!.code, "key_model_fallback");
    assert.equal(availability!.severity, "warning");
    assert.match(availability!.message, /would use/i);
    assert.match(availability!.detail ?? "", /configured default: anthropic\/does-not-exist/i);
    assert.equal(after, before, "doctor config inspection must not rewrite settings.json");
  });
});

test("inspectDoctorConfig reports healthy key model availability when configured runtime path resolves", () => {
  withProject(({ settingsPath, authPath, modelsPath }) => {
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" }, null, 2));
    writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test" } }, null, 2));
    writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2));

    const findings = inspectDoctorConfig();

    const models = getFinding(findings, "models");
    const auth = getFinding(findings, "auth");
    const settings = getFinding(findings, "settings");
    const availability = getFinding(findings, "key_model");

    assert.equal(models?.code, "config_surface_ok");
    assert.equal(models?.severity, "info");
    assert.equal(auth?.code, "config_surface_ok");
    assert.equal(auth?.severity, "info");
    assert.equal(settings?.code, "config_surface_ok");
    assert.equal(settings?.severity, "info");
    assert.match(settings?.message ?? "", /resolves to an available runtime model/i);

    assert.ok(availability, "key model finding should exist");
    assert.equal(availability!.code, "key_model_available");
    assert.equal(availability!.severity, "info");
    assert.match(availability!.message, /is runtime-ready/i);
    assert.match(availability!.detail ?? "", /effective runtime default:/i);
  });
});

test("inspectDoctorConfig reports informational fallback when no explicit default model is configured", () => {
  withProject(({ authPath, modelsPath }) => {
    writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test" } }, null, 2));
    writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2));

    const findings = inspectDoctorConfig();
    const settings = getFinding(findings, "settings");
    const availability = getFinding(findings, "key_model");

    assert.ok(settings, "settings finding should exist");
    assert.equal(settings!.code, "config_surface_ok");
    assert.equal(settings!.severity, "info");
    assert.match(settings!.message, /resolves to an available runtime model|No explicit default model is configured/i);
    assert.match(settings!.detail ?? "", /effective runtime default:/i);

    assert.ok(availability, "key model finding should exist");
    assert.equal(availability!.code, "key_model_available");
    assert.equal(availability!.severity, "info");
    assert.match(availability!.message, /runtime-ready/i);
  });
});

test("inspectDoctorConfig reports key model unavailable when no runtime-ready model exists", () => {
  withProject(({ settingsPath, modelsPath }) => {
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" }, null, 2));
    writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2));

    withEnv({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_OAUTH_TOKEN: undefined, OPENAI_API_KEY: undefined, PATH: process.env.PATH }, () => {
      const findings = inspectDoctorConfig();
      const availability = getFinding(findings, "key_model");

      assert.ok(availability, "key model finding should exist");
      assert.equal(availability!.code, "key_model_unavailable");
      assert.equal(availability!.severity, "error");
      assert.match(availability!.message, /no runtime-ready model/i);
      assert.match(availability!.remediation, /Configure at least one ready provider\/model path/i);
      assert.match(availability!.detail ?? "", /configured default: anthropic\/claude-sonnet-4-5/i);
    });
  });
});
