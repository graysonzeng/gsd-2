export type PhaseDisciplineSequenceEntry = {
  phase: "P0" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  units: string[];
  gating: "soft" | "strict";
  completionArtifact?: string;
};

export const PHASE_DISCIPLINE_8STEP_SEQUENCE: PhaseDisciplineSequenceEntry[] = [
  { phase: "P0", units: ["discuss-milestone"], gating: "soft" },
  { phase: "P1", units: ["research-milestone", "research-slice"], gating: "soft" },
  {
    phase: "P2",
    units: ["plan-slice", "refine-slice"],
    gating: "strict",
    completionArtifact: ".gsd/milestones/{mid}/slices/{sid}/IMPL-PLAN-VALIDATION.md",
  },
  {
    phase: "P3",
    units: ["plan-slice"],
    gating: "strict",
    completionArtifact: ".gsd/milestones/{mid}/slices/{sid}/IMPL-PLAN-VALIDATION.md",
  },
  {
    phase: "P4",
    units: ["execute-task"],
    gating: "strict",
    completionArtifact: ".gsd/milestones/{mid}/slices/{sid}/tasks/*-SUMMARY.md",
  },
  { phase: "P5", units: ["validate-milestone"], gating: "soft" },
  { phase: "P6", units: ["complete-slice", "complete-milestone"], gating: "soft" },
];
