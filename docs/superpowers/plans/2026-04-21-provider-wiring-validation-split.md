# Provider Wiring Validation Split

> Minimal split artifact for validation-only work.

## Recommended Split
This requirement is small enough to stay as a single validation track, but if it needs to be divided for review/execution later, split by evidence type rather than subsystem.

### Track A — Resolution and selection
Files:
- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`

Purpose:
- validate provider/model identification
- validate exact persistence of provider-qualified choices
- validate provider-first disambiguation

### Track B — Bootstrap and provider semantics
Files:
- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
- `docs/dev/ADR-005-multi-model-provider-tool-strategy.md`

Purpose:
- validate auto-start precedence and snapshot timing
- validate provider error/fallback assumptions
- validate correct use of `provider` vs `api`

## Why this split
- Keeps UI-facing selection concerns separate from bootstrap/architecture concerns.
- Reuses existing test boundaries already present in the repo.
- Avoids inventing new ownership boundaries for a validation-only requirement.

## No-edit rule
Both tracks are review/verification only. No source-file edits are part of this split.
