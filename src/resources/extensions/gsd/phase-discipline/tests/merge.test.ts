import assert from "node:assert/strict";
import test from "node:test";

import { applyPhaseDisciplinePreset } from "../../phase-discipline/merge.ts";
import { PHASE_DISCIPLINE_PRESET_HOOK_NAMES } from "../../phase-discipline/preset.ts";

test("applyPhaseDisciplinePreset injects preset hooks when milestone_profile is enabled", () => {
  const result = applyPhaseDisciplinePreset({ milestone_profile: "phase-discipline-8step" });

  assert.equal(result.preferences.post_unit_hooks?.length, 3);
  assert.equal(result.preferences.pre_dispatch_hooks?.length, 1);
  assert.equal(result.preferences.pre_dispatch_hooks?.[0]?.name, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch);
  assert.equal(result.preferences.pre_dispatch_hooks?.[0]?.builtin, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch);
  assert.equal(result.preferences.post_unit_hooks?.[0]?.builtin, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview);
  assert.equal(result.preferences.post_unit_hooks?.[1]?.builtin, PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview);
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
  assert.equal(result.preferences.post_unit_hooks?.[2]?.prompt, "custom review");
  assert.equal(result.preferences.post_unit_hooks?.[2]?.builtin, undefined);
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
  assert.equal(result.preferences.pre_dispatch_hooks?.[1]?.name, "user-modify");
});
