# Provider Wiring Validation Review Checklist

> Fresh-run validation-only artifact. Do not resume prior run state. No source edits planned.

## Canonical review targets
- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/auto-start.ts`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`

## Fresh-run checks
- [ ] All five canonical anchor paths exist.
- [ ] The validation run is fresh and not resumed from prior execution state.
- [ ] No source files were edited as part of the task.

## Resolution and precedence
- [ ] `auto-model-selection.ts` still owns provider-qualified and bare-ID resolution behavior.
- [ ] `auto-model-selection.ts` still contains the transport-specific provider tiebreak exceptions.
- [ ] `auto-start.ts` still captures the session model snapshot before guided-flow mutation points.
- [ ] `auto-start.ts` still checks manual session override before preference fallback.

## API-shape architecture
- [ ] `api-family.ts` still exposes API-family predicates for Anthropic, OpenAI, Gemini, and Bedrock surfaces.
- [ ] `register-builtins.ts` still registers the built-in `api` values referenced by those predicates.
- [ ] ADR-012 still states that API-shape-dependent behavior keys off `api`, not `provider`.
- [ ] ADR-012 still documents the limited cases where direct `provider` comparison is correct.

## Decision rule
If all checklist items are satisfied by the canonical anchors and ADR-012, the requirement is complete as validation-only work. Any gap should open a follow-up validation or test task, not a source-edit task.
