# Provider Wiring Validation Research

**Requirement:** Fresh validation run. Confirm the read-only implementation anchors still map to the validation scope. Do not resume prior run state. Do not edit source files. Produce minimal plan artifacts for research, design, review, and split.

## Fresh-run scope
This research artifact is for a fresh validation pass. It does not rely on prior run state. The implementation anchors are read-only scope references, and the validation remains evidence-led.

## Read-only implementation anchors
Filesystem path verification for the required read-only anchors succeeded in this fresh pass:

- `src/resources/extensions/gsd/auto-model-selection.ts`
- `src/resources/extensions/gsd/auto-start.ts`
- `packages/pi-ai/src/providers/api-family.ts`
- `packages/pi-ai/src/providers/register-builtins.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`

## Scope mapping
These anchors still map cleanly to the provider-wiring validation scope:

- `src/resources/extensions/gsd/auto-model-selection.ts`
  - canonical implementation anchor for provider-qualified and bare model resolution
  - includes explicit provider tiebreak behavior and ADR-012-aligned comments for transport-specific exceptions
- `src/resources/extensions/gsd/auto-start.ts`
  - canonical implementation anchor for startup model snapshot capture and preference-vs-session precedence
  - validates where bootstrap captures model/provider state before guided-flow mutation
- `packages/pi-ai/src/providers/api-family.ts`
  - canonical implementation anchor for API-family predicates
  - expresses the rule that API-shape behavior keys off `api`, not `provider`
- `packages/pi-ai/src/providers/register-builtins.ts`
  - canonical implementation anchor for the concrete built-in `api` registrations the family predicates reason about
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
  - architecture review anchor defining when `provider` is valid versus when `api` or family helpers must be used

## Summary
The validation scope is still correctly anchored in implementation and ADR surfaces. No source edits are required. The task is to confirm those anchors remain the right read-only references for fresh validation work.

## Recommendation
Treat this as a verification-only unit. Use the four implementation files plus ADR-012 as the canonical read-only anchors, and keep the artifacts minimal. Do not plan source edits.

## Constraints
- No source edits.
- Minimal artifacts only.
- Fresh validation framing only; no resumed execution state.
- Validation scope is anchored by the four implementation files plus ADR-012.

## Verification shape
The intended fresh validation run is a read-only review of the implementation anchors and ADR language to confirm that provider identity, API-shape gating, model resolution, and bootstrap capture concerns are still covered by the current scope.
