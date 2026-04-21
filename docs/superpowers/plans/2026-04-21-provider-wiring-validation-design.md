# Provider Wiring Validation Design Note

> Validation-only artifact. No source edits planned.

## Goal
Confirm that provider wiring behavior is already covered by existing repository patterns and identify the minimum verification surface.

## Design
Use the repo’s existing architecture as the design source of truth:

1. **Model resolution is validated through focused unit tests**
   - `hook-model-resolution.test.ts`
2. **Session bootstrap/provider precedence is validated through structural source assertions**
   - `auto-start-model-capture.test.ts`
3. **User-facing provider/model selection is validated through UI-fake command tests**
   - `core-overlay-fallback.test.ts`
   - `extension-selector-separator.test.ts`
4. **Provider/API semantics are constrained by ADRs**
   - ADR-012 for `provider` vs `api`
   - ADR-005 for broader multi-provider/tool compatibility context

## Boundaries
In scope:
- existing wiring patterns
- reusable tests
- architectural rules
- verification entry points

Out of scope:
- changing provider implementations
- adding new providers
- changing docs outside these minimal artifacts
- refactoring model registry or routing

## Key Review Questions
- Are provider-qualified selections persisted exactly as `{ provider, id }`?
- Do bare model IDs resolve with current-provider preference?
- Are custom providers protected from being overridden by preference defaults during auto-start?
- Are provider comparisons only used where transport identity matters, not where API shape matters?
- Does the UI keep provider-first disambiguation when model IDs collide?

## Reusable Components
- source-order structural assertions
- in-memory available-model fixtures
- fake `ctx.ui.select()` flows
- ADR-012 rule as reviewer rubric

## Expected Outcome
A reviewer or later executor should be able to validate provider wiring by reading the listed files and running the targeted existing tests, with no code changes required unless a gap is discovered.
