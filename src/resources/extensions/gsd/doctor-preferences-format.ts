import type { PreferenceDoctorFinding } from "./doctor-preferences.js";

function iconForSeverity(severity: PreferenceDoctorFinding["severity"]): string {
  switch (severity) {
    case "error":
      return "✗";
    case "warning":
      return "⚠";
    default:
      return "✓";
  }
}

export function formatPreferenceDoctorReport(findings: PreferenceDoctorFinding[]): string {
  const lines: string[] = [];
  lines.push("GSD doctor report");
  lines.push("");
  lines.push("Preference health:");

  for (const finding of findings) {
    lines.push(`- ${iconForSeverity(finding.severity)} ${finding.scope}: ${finding.message}`);
    lines.push(`  code: ${finding.code}`);
    lines.push(`  path: ${finding.effectivePath}`);
    lines.push(`  remediation: ${finding.remediation}`);
  }

  return lines.join("\n");
}
