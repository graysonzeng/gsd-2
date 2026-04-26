import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectPreferenceHealth } from "../doctor-preferences.ts";
import { formatPreferenceDoctorReport } from "../doctor-preferences-format.ts";
import { _clearGsdRootCache } from "../paths.ts";

function withTempProject<T>(fn: (ctx: { projectDir: string; gsdHome: string }) => T): T {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const tempProjectDir = mkdtempSync(join(tmpdir(), "gsd-doctor-pref-project-"));
  const tempGsdHome = mkdtempSync(join(tmpdir(), "gsd-doctor-pref-home-"));
  const projectDir = realpathSync(tempProjectDir);
  const gsdHome = realpathSync(tempGsdHome);

  try {
    mkdirSync(join(projectDir, ".gsd"), { recursive: true });
    process.env.GSD_HOME = gsdHome;
    _clearGsdRootCache();
    process.chdir(projectDir);
    return fn({ projectDir, gsdHome });
  } finally {
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    _clearGsdRootCache();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(gsdHome, { recursive: true, force: true });
  }
}

test("inspectPreferenceHealth reports missing canonical files per scope", () => {
  withTempProject(() => {
    const findings = inspectPreferenceHealth();
    assert.equal(findings.length, 2);

    const global = findings.find((finding) => finding.scope === "global");
    const project = findings.find((finding) => finding.scope === "project");

    assert.equal(global?.code, "preferences_missing");
    assert.equal(global?.severity, "warning");
    assert.match(global?.effectivePath ?? "", /PREFERENCES\.md$/);

    assert.equal(project?.code, "preferences_missing");
    assert.equal(project?.severity, "warning");
    assert.match(project?.effectivePath ?? "", /\.gsd[\\/]PREFERENCES\.md$/);
  });
});

test("inspectPreferenceHealth tolerates project case-insensitive files without crashing global scope handling", () => {
  withTempProject(({ projectDir }) => {
    writeFileSync(join(projectDir, ".gsd", "preferences.md"), "---\nversion: 1\nlanguage: Japanese\n---\n", "utf-8");

    const findings = inspectPreferenceHealth();
    const global = findings.find((finding) => finding.scope === "global");
    const project = findings.find((finding) => finding.scope === "project");

    assert.equal(global?.code, "preferences_missing");
    assert.equal(global?.severity, "warning");
    assert.equal(global?.legacyFallback, false);

    assert.ok(project, "project finding should be present");
    assert.ok(
      project.code === "preferences_ok" || project.code === "preferences_legacy_fallback",
      `unexpected project code: ${project.code}`,
    );
    assert.ok(
      project.severity === "info" || project.severity === "warning",
      `unexpected project severity: ${project.severity}`,
    );
    assert.match(project.effectivePath, /\.gsd[\\/](?:PREFERENCES|preferences)\.md$/);
  });
});

test("inspectPreferenceHealth tolerates malformed and invalid preferences independently by scope", () => {
  withTempProject(({ projectDir, gsdHome }) => {
    writeFileSync(join(gsdHome, "PREFERENCES.md"), "this is not frontmatter\n", "utf-8");
    writeFileSync(join(projectDir, ".gsd", "PREFERENCES.md"), "---\nversion: 1\nbudget_ceiling: nope\n---\n", "utf-8");

    const findings = inspectPreferenceHealth();
    const global = findings.find((finding) => finding.scope === "global");
    const project = findings.find((finding) => finding.scope === "project");

    assert.equal(global?.code, "preferences_unrecognized_format");
    assert.equal(global?.severity, "error");

    assert.equal(project?.code, "invalid_preferences");
    assert.equal(project?.severity, "error");
    assert.match(project?.message ?? "", /budget_ceiling/);
  });
});

test("inspectPreferenceHealth reports canonical ok state and formatter prints paths/remediation", () => {
  withTempProject(({ projectDir, gsdHome }) => {
    writeFileSync(join(gsdHome, "PREFERENCES.md"), "---\nversion: 1\nmode: solo\n---\n", "utf-8");
    writeFileSync(join(projectDir, ".gsd", "PREFERENCES.md"), "---\nversion: 1\nlanguage: German\n---\n", "utf-8");

    const findings = inspectPreferenceHealth();
    for (const finding of findings) {
      assert.equal(finding.code, "preferences_ok");
      assert.equal(finding.severity, "info");
      assert.match(finding.message, /canonical path/);
      assert.equal(finding.remediation, "No action needed.");
    }

    const report = formatPreferenceDoctorReport(findings);
    assert.match(report, /Preference health:/);
    assert.match(report, /code:/);
    assert.match(report, /path:/);
    assert.match(report, /remediation:/);
  });
});
