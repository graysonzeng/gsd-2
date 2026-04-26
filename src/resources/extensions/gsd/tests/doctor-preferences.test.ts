import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectPreferenceHealth } from "../doctor-preferences.ts";
import { formatPreferenceDoctorReport } from "../doctor-preferences-format.ts";

function withTempProject<T>(fn: (ctx: { projectDir: string; gsdHome: string }) => T): T {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const projectDir = mkdtempSync(join(tmpdir(), "gsd-doctor-pref-project-"));
  const gsdHome = mkdtempSync(join(tmpdir(), "gsd-doctor-pref-home-"));

  try {
    mkdirSync(join(projectDir, ".gsd"), { recursive: true });
    process.env.GSD_HOME = gsdHome;
    process.chdir(projectDir);
    return fn({ projectDir, gsdHome });
  } finally {
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
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

test("inspectPreferenceHealth flags project lowercase fallback paths without crashing global scope handling", () => {
  withTempProject(({ projectDir }) => {
    writeFileSync(join(projectDir, ".gsd", "preferences.md"), "---\nversion: 1\nlanguage: Japanese\n---\n", "utf-8");

    const findings = inspectPreferenceHealth();
    const global = findings.find((finding) => finding.scope === "global");
    const project = findings.find((finding) => finding.scope === "project");

    assert.equal(global?.code, "preferences_missing");
    assert.equal(global?.severity, "warning");
    assert.equal(global?.legacyFallback, false);

    assert.equal(project?.code, "preferences_legacy_fallback");
    assert.equal(project?.severity, "warning");
    assert.equal(project?.legacyFallback, true);
    assert.match(project?.effectivePath ?? "", /\.gsd[\\/]preferences\.md$/);
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
