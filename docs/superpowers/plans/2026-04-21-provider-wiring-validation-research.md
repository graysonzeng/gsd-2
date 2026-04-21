# Provider Wiring Validation Research

**Requirement:** Validate provider wiring only. Do not edit source files. Produce minimal plan artifacts for research, design, review, and split.

## Summary
This repo already has strong prior art for provider/model wiring validation. The dominant pattern is **structural test coverage plus ADR-backed invariants**, not ad hoc implementation notes. For this requirement, the reusable path is to inspect and, if needed later, extend existing provider-wiring tests rather than design new runtime code.

## Recommendation
Treat this as **light research** and a **verification-only planning unit**. Reuse existing tests and ADR language to confirm provider identity, API-shape gating, model resolution, picker flow, and auto-start snapshot behavior. Do not plan source edits.

## Implementation Landscape

### 1. Provider/model resolution patterns
- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
  - Canonical pattern for validating `resolveModelId(...)`
  - Covers:
    - bare model IDs preferring current provider
    - provider-qualified IDs (`provider/model`)
    - case-insensitive matching
    - OpenRouter-style `org/model` IDs
    - ambiguity across providers
- Reusable component: table-driven test model fixtures with `{ id, provider }`

### 2. Session bootstrap / auto-start wiring
- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
  - Structural assertions against `auto-start.ts`
  - Verifies:
    - model snapshot is captured before guided flow mutates session state
    - manual override and preference fallback ordering
    - custom-provider precedence over `PREFERENCES.md`
    - preferred model validation against live registry auth/config
- Reusable component: source-order assertions using `readFileSync(...).indexOf(...)`

### 3. Interactive provider → model selection
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`
  - Existing pattern for two-step provider-first selection and exact provider-qualified persistence
- Reusable component:
  - grouped provider option lists with model counts
  - model choice lists scoped by selected provider
  - exact persisted selection `{ provider, id }`

### 4. Provider identity vs API-shape rules
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
  - Core architectural rule: gate wire-protocol behavior on `model.api`, not `model.provider`
  - Explicit exceptions where provider equality is still correct: auth resolution, doctor checks, transport-specific fallback targeting, labels/onboarding
- Reusable component: ADR language as the review checklist for whether a provider check is legitimate

### 5. Multi-provider routing and capability strategy
- `docs/dev/ADR-005-multi-model-provider-tool-strategy.md`
  - Describes provider capability registry/tool compatibility direction
  - Useful as scope boundary: validation should focus on routing constraints and compatibility assumptions, not invent new provider abstractions

### 6. Provider error / fallback wiring
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
  - Broad regression surface for provider error classification and recovery
  - Reusable component: validate provider-related behavior through test assertions instead of runtime probes

## Reusable Components
- **Structural source assertions**
  - Pattern: read source, assert ordering / presence of exact expressions
  - Seen in `auto-start-model-capture.test.ts`
- **Fixture model registries**
  - Pattern: small in-memory `AVAILABLE_MODELS` arrays with repeated IDs across providers
  - Seen in `hook-model-resolution.test.ts`
- **UI selection fakes**
  - Pattern: fake `ctx.ui.select()` and assert exact option lists and persisted selection
  - Seen in `core-overlay-fallback.test.ts`
- **ADR-backed review rules**
  - Pattern: evaluate provider comparisons against ADR-012 instead of taste

## Likely Files Relevant to a Validation Pass
- `src/resources/extensions/gsd/tests/hook-model-resolution.test.ts`
- `src/resources/extensions/gsd/tests/auto-start-model-capture.test.ts`
- `src/resources/extensions/gsd/tests/core-overlay-fallback.test.ts`
- `src/resources/extensions/gsd/tests/extension-selector-separator.test.ts`
- `src/resources/extensions/gsd/tests/provider-errors.test.ts`
- `docs/dev/ADR-012-provider-id-vs-api-shape.md`
- `docs/dev/ADR-005-multi-model-provider-tool-strategy.md`
- Potential implementation files for read-only inspection if needed later:
  - `src/resources/extensions/gsd/auto-model-selection.ts`
  - `src/resources/extensions/gsd/auto-start.ts`
  - `packages/pi-ai/src/providers/api-family.ts`
  - `packages/pi-ai/src/providers/register-builtins.ts`

## Constraints
- No source edits.
- Minimal artifacts only.
- Prefer existing tests and ADRs over new design work.
- Validation should distinguish:
  - transport identity (`provider`)
  - wire protocol / behavior shape (`api`)

## Verification Shape
If this proceeds beyond planning, the natural verification is existing targeted test execution around provider/model wiring, not manual behavioral QA.
