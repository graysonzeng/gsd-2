import type { ConfigDoctorFinding } from "./doctor-config.js";

function iconForSeverity(severity: ConfigDoctorFinding["severity"]): string {
  switch (severity) {
    case "error":
      return "✗";
    case "warning":
      return "⚠";
    default:
      return "✓";
  }
}

function sectionTitle(scope: ConfigDoctorFinding["scope"]): string {
  switch (scope) {
    case "preferences":
      return "Preference health";
    case "models":
      return "Model registry config";
    case "auth":
      return "Auth config";
    case "settings":
      return "Effective default model";
  }
}

const scopeOrder: ConfigDoctorFinding["scope"][] = ["preferences", "models", "auth", "settings"];

export function formatConfigDoctorReport(findings: ConfigDoctorFinding[]): string {
  const lines: string[] = [];
  lines.push("GSD doctor report");

  for (const scope of scopeOrder) {
    const scopedFindings = findings.filter((finding) => finding.scope === scope);
    if (scopedFindings.length === 0) continue;

    lines.push("");
    lines.push(`${sectionTitle(scope)}:`);

    for (const finding of scopedFindings) {
      lines.push(`- ${iconForSeverity(finding.severity)} ${finding.message}`);
      lines.push(`  code: ${finding.code}`);
      lines.push(`  path: ${finding.effectivePath}`);
      if (finding.detail) {
        lines.push(`  detail: ${finding.detail}`);
      }
      lines.push(`  remediation: ${finding.remediation}`);
    }
  }

  return lines.join("\n");
}
