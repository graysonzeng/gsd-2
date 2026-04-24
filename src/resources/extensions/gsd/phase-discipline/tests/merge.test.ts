import assert from "node:assert/strict";
import test from "node:test";

import { applyPhaseDisciplinePreset } from "../../phase-discipline/merge.ts";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "../../phase-discipline/preset.ts";

test("applyPhaseDisciplinePreset injects preset hooks when milestone_profile is enabled", () => {
  const result = applyPhaseDisciplinePreset({ milestone_profile: "phase-discipline-8step" });

  assert.equal(result.preferences.models?.research && typeof result.preferences.models.research === "object" ? result.preferences.models.research.model : undefined, "gpt-5.4");
  assert.equal(result.preferences.models?.research && typeof result.preferences.models.research === "object" ? result.preferences.models.research.provider : undefined, "openai");
  assert.equal(result.preferences.post_unit_hooks?.length, 6);
  assert.equal(result.preferences.pre_dispatch_hooks?.length, 2);
  assert.equal(result.preferences.pre_dispatch_hooks?.[0]?.name, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch);
  assert.equal(result.preferences.pre_dispatch_hooks?.[0]?.builtin, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch);
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.name, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut);
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.builtin, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut);
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.action, "modify");
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.model, "gpt-5.4");
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.provider, "openai");
  assert.ok(result.preferences.post_unit_hooks?.some((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission));
  assert.equal(
    result.preferences.post_unit_hooks?.find(
      (hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission,
    )?.builtin,
    undefined,
  );
  assert.ok(
    result.preferences.post_unit_hooks?.some(
      (hook) => hook.builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
    ),
  );
  assert.equal(
    result.preferences.post_unit_hooks?.find((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview)?.model,
    "claude-opus-4-6",
  );
  assert.equal(
    result.preferences.post_unit_hooks?.find((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview)?.provider,
    "anthropic",
  );
  assert.ok(
    result.preferences.post_unit_hooks?.some(
      (hook) => hook.builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview,
    ),
  );
  assert.equal(
    result.preferences.post_unit_hooks?.find((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview)?.model,
    "claude-opus-4-6",
  );
  assert.equal(
    result.preferences.post_unit_hooks?.find((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview)?.provider,
    "anthropic",
  );
  assert.ok(
    result.preferences.post_unit_hooks?.some(
      (hook) => hook.builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.implPlanValidator,
    ),
  );
  assert.ok(
    result.preferences.post_unit_hooks?.some(
      (hook) => hook.builtin === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.verifyFuse,
    ),
  );
  assert.equal(result.warnings.length, 0);
});

test("applyPhaseDisciplinePreset lets user hook shadow preset and warns on missing cross_review", () => {
  const result = applyPhaseDisciplinePreset({
    milestone_profile: "phase-discipline-8step",
    post_unit_hooks: [
      {
        name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
        after: ["execute-task"],
        prompt: "custom review",
      },
    ],
  });

  assert.equal(
    result.preferences.post_unit_hooks?.filter((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview).length,
    1,
  );
  const mergedCodeReview = result.preferences.post_unit_hooks?.find(
    (hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
  );
  assert.equal(mergedCodeReview?.prompt, "custom review");
  assert.equal(mergedCodeReview?.builtin, undefined);
  assert.ok(result.preferences.post_unit_hooks?.some((hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission));
  assert.ok(result.warnings.some((warning) => warning.includes("shadowed by user hook")));
  assert.ok(result.warnings.some((warning) => warning.includes("lacks cross_review")));
});

test("applyPhaseDisciplinePreset keeps preset pre-dispatch hook before user hooks", () => {
  const result = applyPhaseDisciplinePreset({
    milestone_profile: "phase-discipline-8step",
    pre_dispatch_hooks: [
      {
        name: "user-modify",
        before: ["execute-task"],
        action: "modify",
        prepend: "user note",
      },
    ],
  });

  assert.equal(result.preferences.pre_dispatch_hooks?.[0]?.name, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch);
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.name, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut);
  assert.equal(result.preferences.pre_dispatch_hooks?.[2]?.name, "user-modify");
});

test("applyPhaseDisciplinePreset lets user shadow scout fan-out pre-dispatch hook by name", () => {
  const result = applyPhaseDisciplinePreset({
    milestone_profile: "phase-discipline-8step",
    pre_dispatch_hooks: [
      {
        name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut,
        before: ["research-slice"],
        action: "modify",
        prepend: "custom scout note",
      },
    ],
  });

  const scoutHooks = result.preferences.pre_dispatch_hooks?.filter(
    (hook) => hook.name === PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut,
  );
  assert.equal(scoutHooks?.length, 1);
  assert.equal(scoutHooks?.[0]?.prepend, "custom scout note");
  assert.equal(scoutHooks?.[0]?.builtin, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes("phase-discipline-scout-fanout")));
});
