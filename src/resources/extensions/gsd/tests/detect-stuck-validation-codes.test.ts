import test from "node:test";
import assert from "node:assert/strict";

import { detectStuck } from "../auto/detect-stuck.ts";
import { VALIDATION_ERROR_CODES } from "../validation-error-codes.ts";

test("detectStuck trips after two repeated structured validation codes", () => {
  const result = detectStuck([
    { key: "validate-milestone/M007", error: VALIDATION_ERROR_CODES.ARTIFACT_MISSING },
    { key: "validate-milestone/M007", error: VALIDATION_ERROR_CODES.ARTIFACT_MISSING },
  ]);

  assert.ok(result?.stuck, "expected structured validation code to trigger stuck detection");
  assert.match(result?.reason ?? "", /VALIDATION_ARTIFACT_MISSING/);
});

test("detectStuck ignores a single structured validation code occurrence", () => {
  const result = detectStuck([
    { key: "validate-milestone/M007" },
    { key: "validate-milestone/M007", error: VALIDATION_ERROR_CODES.ARTIFACT_MISSING },
  ]);

  assert.equal(result, null);
});
