/**
 * composed-lite/index.ts — Public API for the composed-lite runtime.
 */

export { runComposedLite } from "./runner.js";
export type { ComposedLiteRunRequest } from "./types.js";

export function parseComposedLiteDispatchArgs(input: string): {
  requirement: string;
  mode: "full" | "plan";
  admissionAction: "approve" | "reject" | null;
} {
  const isPlan = /(?:^|\s)--plan(?:\s|$)/.test(input);
  const hasApprove = /(?:^|\s)--approve(?:\s|$)/.test(input);
  const hasReject = /(?:^|\s)--reject(?:\s|$)/.test(input);
  const requirement = input
    .replace(/(?:^|\s)--plan(?:\s|$)/g, " ")
    .replace(/(?:^|\s)--approve(?:\s|$)/g, " ")
    .replace(/(?:^|\s)--reject(?:\s|$)/g, " ")
    .trim();

  return {
    requirement,
    mode: isPlan ? "plan" : "full",
    admissionAction: hasReject ? "reject" : hasApprove ? "approve" : null,
  };
}
