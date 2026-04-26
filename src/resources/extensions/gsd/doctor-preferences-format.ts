import type { PreferenceDoctorFinding } from "./doctor-preferences.js";
import { formatConfigDoctorReport } from "./doctor-config-format.js";

export function formatPreferenceDoctorReport(findings: PreferenceDoctorFinding[]): string {
  return formatConfigDoctorReport(findings.map((finding) => ({
    scope: "preferences" as const,
    severity: finding.severity,
    code: finding.code,
    effectivePath: finding.effectivePath,
    message: `[${finding.scope}] ${finding.message}`,
    remediation: finding.remediation,
    detail: finding.legacyFallback ? "Loaded from a legacy fallback path." : undefined,
  })));
}
