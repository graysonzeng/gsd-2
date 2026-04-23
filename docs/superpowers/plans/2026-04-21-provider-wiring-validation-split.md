# Provider Wiring Validation Split

> Minimal split artifact for fresh-run validation-only work. Do not resume prior run state.

## Scope
This task is small enough to execute as a single track. If split is needed for review, split by implementation anchor while keeping the canonical anchor set fixed.

## Track A — Model resolution and bootstrap capture
Files:
- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/auto-start.ts`

Purpose:
- validate provider-qualified and bare-ID resolution
- validate bootstrap model snapshot capture and precedence
- validate where session-model state is captured before guided-flow mutation

## Track B — API-shape predicates and registrations
Files:
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`

Purpose:
- validate API-family predicate boundaries
- validate built-in API registrations match the predicate families
- validate ADR-012's rule that API-shape behavior keys off `api`, not `provider`

## No-edit rule
Both tracks are review and verification only. No source-file edits are part of this split.

## Completion rule
The split is complete when both tracks point to the same canonical anchor set and the fresh validation run has been executed against the read-only scope references.
