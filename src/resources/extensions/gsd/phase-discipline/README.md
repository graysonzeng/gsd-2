# Phase Discipline Preset

This directory implements the opt-in `milestone_profile: phase-discipline-8step` preset for GSD auto-mode.

## Surface

- `preset.ts`
  - Declares the preset-owned post-unit and pre-dispatch hooks.
- `merge.ts`
  - Injects preset hooks when the milestone profile is enabled.
  - User hooks shadow preset hooks by name.
- `profile-map.ts`
  - Defines the authoritative B-min phase ordering.
- `profile-dispatch.ts`
  - Enforces advisory phase ordering through the PR-3a `action: "advise"` path.
- `reviewer-hook.ts`
  - Executes the built-in code-review and design-review fan-out hooks.
  - Writes review artifacts, retry markers, and `.phase-discipline/*.json` observability logs.
- `findings-carry.ts`
  - Supplies the prompt-only findings-to-memories hook.

## Built-in hooks

Only three preset-owned hooks have code-backed behavior:

- `phase-discipline-profile-dispatch`
- `phase-discipline-code-review`
- `phase-discipline-design-review`

They are identified at runtime through the internal `builtin` marker added by the preset merge path. This avoids treating user-authored shadow hooks with the same `name` as built-in hooks.

## Runtime boundary

This implementation stays intentionally narrow:

- No generic hook plugin framework
- No changes to PR-2 `shared-harness/*`
- No new PR-3a kernel semantics
- `phase-discipline-findings-to-memories` remains on the legacy prompt path

## Verification focus

The focused verification surface for PR-3b is:

- preset injection and shadow semantics
- built-in pre-dispatch routing through `rule-registry.ts`
- built-in reviewer short-circuiting before `newSession()`
- review artifact / retry / observability outputs
- integration coverage that the preset survives merge + revalidation in the real preference loader
