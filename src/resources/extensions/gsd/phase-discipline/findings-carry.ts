export function buildPhaseDisciplineFindingsToMemoriesPrompt(): string {
  return [
    "Review the current slice's phase-discipline review artefacts and promote only durable lessons into memory.",
    "",
    "Required steps:",
    "1. Read the slice artefacts directory and inspect any *-CODE-REVIEW.md, *-DESIGN-REVIEW.md, *-FINDINGS.md, or *-REVIEW.md files.",
    "2. Identify unresolved findings that represent reusable gotchas, conventions, or architectural lessons.",
    "3. Call `capture_thought` once per durable insight with category `gotcha`, `convention`, or `architecture`.",
    "4. Skip one-off implementation details, secrets, or transient state.",
    "5. Cap the extraction at 5 memories per slice completion.",
  ].join("\n");
}
