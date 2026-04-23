# Fresh Validation Run Design Document

## Overview
This document defines a fresh, validation-only pass for provider-wiring scope mapping. It must stand on its own, must not resume prior run state, and must not trigger source-file edits.

## Goal
Confirm that the read-only implementation anchors still map to the validation scope for provider identity vs API shape, model resolution, bootstrap capture, and built-in API registration.

## Canonical read-only anchors
The design treats these as the required scope anchors:

- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/auto-start.ts`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`

## Fresh-run procedure
1. Verify all five canonical anchor paths exist.
2. Review the implementation anchors read-only.
3. Confirm ADR-012 still matches the implementation split between `provider` identity and `api` shape.
4. Record conclusions only in minimal research/design/review/split artifacts.
5. Make no edits under `src/**` or `packages/**`.

## Scope checks
- `auto-model-selection.ts` remains the model-resolution and provider-tiebreak anchor.
- `auto-start.ts` remains the bootstrap precedence and model-capture anchor.
- `api-family.ts` remains the API-shape predicate anchor.
- `register-builtins.ts` remains the built-in API registration anchor.
- ADR-012 remains the architecture review anchor for `provider` vs `api` usage.

## Design decisions
- Validation-only, no implementation work.
- Canonical evidence is fixed to the five required read-only anchors.
- Review is narrow and targeted rather than broad repo-wide validation.
- ADR-012 is the correctness rubric for whether the anchors still cover the intended scope.

## Done condition
This design is satisfied when:
- all five canonical anchor files exist,
- the implementation anchors have been reviewed in a fresh run,
- the minimal research/review/split artifacts describe the same anchor set,
- no source files were changed as part of the validation task.
