import type { PostUnitHookConfig, PreDispatchHookConfig } from "../types.js";
import { buildPhaseDisciplineFindingsToMemoriesPrompt } from "./findings-carry.js";

export const PHASE_DISCIPLINE_PRESET_HOOK_NAMES = {
  profileDispatch: "phase-discipline-profile-dispatch",
  codeReview: "phase-discipline-code-review",
  designReview: "phase-discipline-design-review",
  findingsToMemories: "phase-discipline-findings-to-memories",
} as const;

export const phaseDiscipline8StepPostUnitHooks: PostUnitHookConfig[] = [
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
    after: ["execute-task"],
    prompt: "Run the phase-discipline code-review fan-out for this completed task and write the review artifact.",
    builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.codeReview,
    cross_review: 2,
    artifact: "CODE-REVIEW.md",
    retry_on: "CODE-REVIEW-RETRY.md",
    max_cycles: 2,
  },
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview,
    after: ["plan-slice", "refine-slice"],
    prompt: "Run the phase-discipline design-review fan-out for this slice plan and write the review artifact.",
    builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.designReview,
    cross_review: 2,
    artifact: "DESIGN-REVIEW.md",
    retry_on: "DESIGN-REVIEW-RETRY.md",
    max_cycles: 2,
  },
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.findingsToMemories,
    after: ["complete-slice"],
    prompt: buildPhaseDisciplineFindingsToMemoriesPrompt(),
    max_cycles: 1,
  },
];

export const phaseDiscipline8StepPreDispatchHooks: PreDispatchHookConfig[] = [
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch,
    builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.profileDispatch,
    before: [
      "discuss-milestone",
      "research-milestone",
      "research-slice",
      "plan-slice",
      "refine-slice",
      "execute-task",
      "validate-milestone",
      "complete-slice",
      "complete-milestone",
    ],
    action: "advise",
    unit_type: "plan-slice",
  },
];

export const phaseDiscipline8StepPreset = {
  postUnitHooks: phaseDiscipline8StepPostUnitHooks,
  preDispatchHooks: phaseDiscipline8StepPreDispatchHooks,
};
