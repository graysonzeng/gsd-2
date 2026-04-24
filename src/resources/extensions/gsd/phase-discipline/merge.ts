import type { GSDPreferences } from "../preferences-types.js";
import type { PostUnitHookConfig, PreDispatchHookConfig } from "../types.js";
import { phaseDiscipline8StepDefaultModels, phaseDiscipline8StepPreset } from "./preset.js";

export interface PresetMergeResult {
  preferences: GSDPreferences;
  warnings: string[];
}

function mergePostUnitHooks(
  userHooks: PostUnitHookConfig[] | undefined,
  presetHooks: PostUnitHookConfig[],
): { hooks: PostUnitHookConfig[]; warnings: string[] } {
  const warnings: string[] = [];
  const userList = userHooks ?? [];
  const shadowed = new Set(userList.map((hook) => hook.name));
  const merged: PostUnitHookConfig[] = [];

  for (const presetHook of presetHooks) {
    if (shadowed.has(presetHook.name)) {
      const userHook = userList.find((hook) => hook.name === presetHook.name)!;
      warnings.push(`phase-discipline preset hook "${presetHook.name}" shadowed by user hook; preset fields not inherited`);
      if ((presetHook.cross_review ?? 1) > 1 && userHook.cross_review === undefined) {
        warnings.push(
          `user hook "${presetHook.name}" lacks cross_review; defaulting to single-reviewer (preset wanted ${presetHook.cross_review})`,
        );
      }
      continue;
    }
    merged.push(presetHook);
  }

  merged.push(...userList);
  return { hooks: merged, warnings };
}

function mergePreDispatchHooks(
  userHooks: PreDispatchHookConfig[] | undefined,
  presetHooks: PreDispatchHookConfig[],
): { hooks: PreDispatchHookConfig[]; warnings: string[] } {
  const warnings: string[] = [];
  const userList = userHooks ?? [];
  const shadowed = new Set(userList.map((hook) => hook.name));
  const merged = presetHooks.filter((hook) => !shadowed.has(hook.name));

  for (const presetHook of presetHooks) {
    if (shadowed.has(presetHook.name)) {
      warnings.push(`phase-discipline preset hook "${presetHook.name}" shadowed by user hook; preset fields not inherited`);
    }
  }

  merged.push(...userList);
  return { hooks: merged, warnings };
}

export function applyPhaseDisciplinePreset(preferences: GSDPreferences): PresetMergeResult {
  if (preferences.milestone_profile !== "phase-discipline-8step") {
    return { preferences, warnings: [] };
  }

  const postMerge = mergePostUnitHooks(
    preferences.post_unit_hooks,
    phaseDiscipline8StepPreset.postUnitHooks,
  );
  const preMerge = mergePreDispatchHooks(
    preferences.pre_dispatch_hooks,
    phaseDiscipline8StepPreset.preDispatchHooks,
  );

  return {
    preferences: {
      ...preferences,
      models: {
        ...phaseDiscipline8StepDefaultModels,
        ...(preferences.models ?? {}),
      },
      post_unit_hooks: postMerge.hooks,
      pre_dispatch_hooks: preMerge.hooks,
    },
    warnings: [...postMerge.warnings, ...preMerge.warnings],
  };
}
