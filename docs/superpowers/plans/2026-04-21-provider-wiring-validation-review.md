# Provider Wiring Validation Review Checklist

> Validation-only artifact. No source edits planned.

## Review Targets
- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
- `docs/dev/ADR-005-multi-model-provider-tool-strategy.md`

## Checklist

### Resolution
- [ ] Bare model IDs prefer the current provider when duplicates exist.
- [ ] Provider-qualified IDs resolve deterministically.
- [ ] OpenRouter-style `org/model` IDs are preserved correctly.
- [ ] Unknown provider/model pairs fail cleanly.

### Auto-start / bootstrap
- [ ] Session model snapshot is captured before guided-flow mutation points.
- [ ] Manual session override is checked before preference fallback.
- [ ] Custom providers are not overridden by `PREFERENCES.md` defaults.
- [ ] Preferred models are validated against the live registry before capture.

### UI selection
- [ ] Interactive selection asks for provider first, then model.
- [ ] Provider groups show model counts.
- [ ] Exact persisted selection includes provider and model ID.
- [ ] Ambiguous typed model queries still disambiguate by provider.

### Architectural correctness
- [ ] Provider equality checks are only used for transport-specific behavior.
- [ ] API-shape-dependent behavior follows ADR-012 and should key off `model.api` / helpers.
- [ ] Multi-provider compatibility assumptions align with ADR-005.

### Fallback / recovery
- [ ] Provider error handling tests cover transient vs permanent classification.
- [ ] Provider-related recovery paths stay test-backed rather than inferred from behavior.

## Decision Rule
If all checklist items are satisfied by existing tests/docs, the requirement is complete as validation-only work. If any gap appears, open a follow-up plan for test additions before considering implementation changes.
