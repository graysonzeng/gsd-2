export const VALIDATION_ERROR_CODES = {
  MILESTONE_ID_INVALID: "VALIDATION_MILESTONE_ID_INVALID",
  VERDICT_INVALID: "VALIDATION_VERDICT_INVALID",
  ARTIFACT_RENDER_FAILED: "VALIDATION_ARTIFACT_RENDER_FAILED",
  ARTIFACT_MISSING: "VALIDATION_ARTIFACT_MISSING",
  ARTIFACT_DESYNCED: "VALIDATION_ARTIFACT_DESYNCED",
  REMEDIATION_REQUIRED_BUT_NO_PLAN: "REMEDIATION_REQUIRED_BUT_NO_PLAN",
  REMEDIATION_REQUIRED_BUT_NO_SLICE: "REMEDIATION_REQUIRED_BUT_NO_SLICE",
} as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[keyof typeof VALIDATION_ERROR_CODES];

export const VALIDATION_STUCK_ERROR_CODES = [
  VALIDATION_ERROR_CODES.ARTIFACT_MISSING,
  VALIDATION_ERROR_CODES.VERDICT_INVALID,
  VALIDATION_ERROR_CODES.REMEDIATION_REQUIRED_BUT_NO_PLAN,
  VALIDATION_ERROR_CODES.REMEDIATION_REQUIRED_BUT_NO_SLICE,
] as const satisfies readonly ValidationErrorCode[];

export function isValidationErrorCode(value: string | null | undefined): value is ValidationErrorCode {
  return typeof value === "string"
    && Object.values(VALIDATION_ERROR_CODES).includes(value as ValidationErrorCode);
}

export function isValidationStuckErrorCode(value: string | null | undefined): value is ValidationErrorCode {
  return typeof value === "string"
    && (VALIDATION_STUCK_ERROR_CODES as readonly string[]).includes(value);
}
