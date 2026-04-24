import type { PostUnitHookConfig, PreDispatchHookConfig } from "../types.js";
import { buildPhaseDisciplineFindingsToMemoriesPrompt } from "./findings-carry.js";

function buildPhaseDisciplineAdmissionPrompt(): string {
  return [
    "Run the phase-discipline admission checklist for milestone {milestoneId} after discuss-milestone completes.",
    "Review the milestone goal, current context, and existing planning artifacts before deciding whether execution should start. Prioritize the latest milestone discussion notes, any milestone roadmap, and any planning artifacts already present under `.gsd/milestones/{milestoneId}/`.",
    "Write the checklist to `.gsd/milestones/{milestoneId}/ADMISSION-CHECKLIST.md` as markdown using 6-8 checklist items with `- [x]` / `- [ ]` format and a brief rationale under each item.",
    "The checklist must explicitly cover: concrete deliverable clarity, dependency readiness/no blocking prerequisite milestone, scope size staying within 5 slices, measurable acceptance criteria with verification commands or manual validation steps, identified risks, reasonable milestone estimate, and any critical unknowns that still need clarification.",
    "End the checklist with `Admission Decision: pass` or `Admission Decision: needs-rework`.",
    "If and only if the Admission Decision is `needs-rework`, also write `.gsd/milestones/{milestoneId}/ADMISSION-RETRY.md` summarizing the missing start conditions and the exact follow-up needed before retry. If the Admission Decision is `pass`, do not create the retry artifact.",
  ].join("\n\n");
}

export const PHASE_DISCIPLINE_PRESET_HOOK_NAMES = {
  admission: "phase-discipline-admission",
  profileDispatch: "phase-discipline-profile-dispatch",
  scoutFanOut: "phase-discipline-scout-fanout",
  implPlanValidator: "phase-discipline-impl-plan-validator",
  codeReview: "phase-discipline-code-review",
  designReview: "phase-discipline-design-review",
  verifyFuse: "phase-discipline-verify-fuse",
  findingsToMemories: "phase-discipline-findings-to-memories",
} as const;

export const phaseDiscipline8StepPostUnitHooks: PostUnitHookConfig[] = [
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.admission,
    after: ["discuss-milestone"],
    prompt: buildPhaseDisciplineAdmissionPrompt(),
    artifact: "ADMISSION-CHECKLIST.md",
    retry_on: "ADMISSION-RETRY.md",
    max_cycles: 2,
  },
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
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.implPlanValidator,
    after: ["plan-slice", "refine-slice"],
    prompt: "Validate the generated implementation plan structure and write the validation artifact.",
    builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.implPlanValidator,
    artifact: "IMPL-PLAN-VALIDATION.md",
    retry_on: "IMPL-PLAN-RETRY.md",
    max_cycles: 2,
  },
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.verifyFuse,
    after: ["validate-milestone"],
    prompt: "Record the verify-fuse decision for the latest validate-milestone result.",
    builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.verifyFuse,
    artifact: "VERIFY-FUSE.md",
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
  {
    name: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut,
    builtin: PHASE_DISCIPLINE_PRESET_HOOK_NAMES.scoutFanOut,
    before: ["research-slice"],
    action: "modify",
  },
];

export const phaseDiscipline8StepPreset = {
  postUnitHooks: phaseDiscipline8StepPostUnitHooks,
  preDispatchHooks: phaseDiscipline8StepPreDispatchHooks,
};
