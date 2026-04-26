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
  fn: (ctx: { projectDir: string; gsdHome: string; env: NodeJS.ProcessEnv }) => T,
): T {
  const tempProjectDir = mkdtempSync(join(tmpdir(), "gsd-cli-doctor-project-"));
  const tempGsdHome = mkdtempSync(join(tmpdir(), "gsd-cli-doctor-home-"));
  const projectDir = realpathSync(tempProjectDir);
  const gsdHome = realpathSync(tempGsdHome);

  mkdirSync(join(projectDir, ".gsd"), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GSD_HOME: gsdHome,
    HOME: process.env.HOME,
    GSD_DISABLE_UPDATE_CHECK: "1",
    GSD_FIRST_RUN_BANNER: "1",
  };

  try {
    return fn({ projectDir, gsdHome, env });
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

test("gsd doctor reports missing global and project preferences without entering interactive mode", () => {
  withDoctorFixture(({ projectDir, env }) => {
    const result = runDoctor(projectDir, env);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /GSD doctor report/);
    assert.match(result.stdout, /Preference health:/);
    assert.match(result.stdout, /global: Global preferences file not found\./);
    assert.match(result.stdout, /project: Project preferences file not found\./);
    assert.match(result.stdout, /Create .*PREFERENCES\.md using YAML frontmatter delimited by ---/);
    assert.equal(result.stderr, "");
  });
});

test("gsd doctor reports separate canonical project and global successes", () => {
  withDoctorFixture(({ projectDir, gsdHome, env }) => {
    writeFileSync(join(gsdHome, "PREFERENCES.md"), "---\nversion: 1\nmode: solo\n---\n", "utf-8");
    writeFileSync(join(projectDir, ".gsd", "PREFERENCES.md"), "---\nversion: 1\nlanguage: German\n---\n", "utf-8");

    const result = runDoctor(projectDir, env);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /global: Global preferences loaded from the canonical path\./);
    assert.match(result.stdout, /project: Project preferences loaded from the canonical path\./);
    assert.match(result.stdout, /code: preferences_ok/g);
    assert.match(result.stdout, /remediation: No action needed\./);
    assert.equal(result.stderr, "");
  });
});

test("gsd doctor surfaces malformed global content and still reports the project preference file without crashing", () => {
  withDoctorFixture(({ projectDir, gsdHome, env }) => {
    writeFileSync(join(gsdHome, "PREFERENCES.md"), "this is not frontmatter\n", "utf-8");
    writeFileSync(join(projectDir, ".gsd", "preferences.md"), "---\nversion: 1\nlanguage: Japanese\n---\n", "utf-8");

    const result = runDoctor(projectDir, env);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /global: Global preferences file exists but could not be recognized as a supported preferences format\./);
    assert.match(result.stdout, /code: preferences_unrecognized_format/);
    assert.match(result.stdout, /Fix .*PREFERENCES\.md to use valid YAML frontmatter/);
    assert.match(result.stdout, /project: Project preferences loaded from (?:the canonical path|a legacy fallback path)\./);
    assert.match(result.stdout, /path: .*\.gsd[\\/](?:PREFERENCES|preferences)\.md/);
    assert.ok(
      /code: preferences_ok/.test(result.stdout) || /code: preferences_legacy_fallback/.test(result.stdout),
      `expected a successful or fallback project finding in output:\n${result.stdout}`,
    );
    assert.match(result.stderr, /Warning: preferences file has unrecognized format/);
  });
});
