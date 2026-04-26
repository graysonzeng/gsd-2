import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const devCliPath = join(projectRoot, "scripts", "dev-cli.js");

function withDoctorFixture<T>(
  fn: (ctx: { projectDir: string; gsdHome: string; env: NodeJS.ProcessEnv; authPath: string; modelsPath: string; settingsPath: string }) => T,
): T {
  const tempProjectDir = mkdtempSync(join(tmpdir(), "gsd-cli-doctor-config-project-"));
  const tempGsdHome = mkdtempSync(join(tmpdir(), "gsd-cli-doctor-config-home-"));
  const projectDir = realpathSync(tempProjectDir);
  const gsdHome = realpathSync(tempGsdHome);
  const authPath = join(gsdHome, "agent", "auth.json");
  const modelsPath = join(gsdHome, "agent", "models.json");
  const settingsPath = join(projectDir, ".pi", "settings.json");

  mkdirSync(join(projectDir, ".gsd"), { recursive: true });
  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  mkdirSync(join(gsdHome, "agent"), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GSD_HOME: gsdHome,
    HOME: gsdHome,
    PI_CODING_AGENT_DIR: join(gsdHome, "agent"),
    GSD_DISABLE_UPDATE_CHECK: "1",
    GSD_FIRST_RUN_BANNER: "1",
  };

  try {
    return fn({ projectDir, gsdHome, env, authPath, modelsPath, settingsPath });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(gsdHome, { recursive: true, force: true });
  }
}

function runDoctor(projectDir: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [devCliPath, "doctor"], {
    cwd: projectDir,
    env,
    encoding: "utf-8",
  });
}

test("gsd doctor prints a combined healthy report across preferences, models, auth, and settings", () => {
  withDoctorFixture(({ projectDir, gsdHome, env, authPath, modelsPath, settingsPath }) => {
    writeFileSync(join(gsdHome, "PREFERENCES.md"), "---\nversion: 1\nmode: solo\n---\n", "utf-8");
    writeFileSync(join(projectDir, ".gsd", "PREFERENCES.md"), "---\nversion: 1\nlanguage: German\n---\n", "utf-8");
    writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test" } }, null, 2));
    writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2));
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" }, null, 2));

    const result = runDoctor(projectDir, env);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /GSD doctor report/);
    assert.match(result.stdout, /Preference health:/);
    assert.match(result.stdout, /Model registry config:/);
    assert.match(result.stdout, /Auth config:/);
    assert.match(result.stdout, /Effective default model:/);
    assert.match(result.stdout, /\[global\] Global preferences loaded from the canonical path\./);
    assert.match(result.stdout, /\[project\] Project preferences loaded from the canonical path\./);
    assert.match(result.stdout, /models\.json is valid JSON and can be loaded for runtime model registration\./);
    assert.match(result.stdout, /auth\.json is readable and contains credentials for 1 provider\./);
    assert.match(result.stdout, /settings\.json default anthropic\/claude-sonnet-4-5 resolves to an available runtime model\./);
    assert.match(result.stdout, /effective runtime default: Anthropic \(Claude\) \(anthropic\/claude-sonnet-4-5\)/);
    assert.equal(result.stderr, "");
  });
});

test("gsd doctor exits non-zero and includes per-surface findings when config files are broken", () => {
  withDoctorFixture(({ projectDir, env, authPath, modelsPath, settingsPath }) => {
    writeFileSync(authPath, '{"anthropic":', "utf-8");
    writeFileSync(modelsPath, "{ invalid json\n", "utf-8");
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" }, null, 2));

    const result = runDoctor(projectDir, env);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Preference health:/);
    assert.match(result.stdout, /Model registry config:/);
    assert.match(result.stdout, /Auth config:/);
    assert.match(result.stdout, /Effective default model:/);
    assert.match(result.stdout, /code: preferences_missing/);
    assert.match(result.stdout, /code: models_json_invalid/);
    assert.match(result.stdout, /code: auth_json_invalid/);
    assert.match(result.stdout, /code: config_surface_ok/);
    assert.match(result.stdout, /models\.json exists but could not be parsed/i);
    assert.match(result.stdout, /auth\.json exists but could not be loaded/i);
    assert.match(result.stdout, /settings\.json default anthropic\/claude-sonnet-4-6 resolves to an available runtime model\./);
    assert.match(result.stdout, /Create .*PREFERENCES\.md using YAML frontmatter delimited by ---/);
    assert.match(result.stdout, /Create or fix .*models\.json with valid JSON\./);
    assert.match(result.stdout, /Fix .*auth\.json to valid JSON or re-run \/gsd keys or \/login/);
    assert.match(result.stdout, /remediation: No action needed\./);
    assert.equal(result.stderr, "");
  });
});

test("gsd doctor stays zero with mixed warnings when runtime falls back from an unavailable configured default", () => {
  withDoctorFixture(({ projectDir, gsdHome, env, authPath, modelsPath, settingsPath }) => {
    writeFileSync(join(gsdHome, "PREFERENCES.md"), "---\nversion: 1\nmode: solo\n---\n", "utf-8");
    writeFileSync(join(projectDir, ".gsd", "preferences.md"), "---\nversion: 1\nlanguage: Japanese\n---\n", "utf-8");
    writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test" } }, null, 2));
    writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2));
    writeFileSync(settingsPath, JSON.stringify({ defaultProvider: "anthropic", defaultModel: "does-not-exist" }, null, 2));

    const result = runDoctor(projectDir, env);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /code: default_model_fallback/);
    assert.match(result.stdout, /\[project\] Project preferences loaded from the canonical path\.|\[project\] Project preferences loaded from a legacy fallback path\./);
    assert.match(result.stdout, /settings\.json default anthropic\/does-not-exist is not currently resolvable; runtime would fall back to anthropic\//);
    assert.match(result.stdout, /effective runtime default: Anthropic \(Claude\) \(anthropic\//);
    assert.match(result.stdout, /Update .*settings\.json so defaultProvider\/defaultModel point at an available runtime model/);
    assert.equal(result.stderr, "");
  });
});
