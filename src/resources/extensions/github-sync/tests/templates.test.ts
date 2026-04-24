import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMilestoneIssueBody,
  formatSlicePRBody,
  formatTaskIssueBody,
  formatSummaryComment,
  formatSwarmLanePRBody,
  formatSwarmReleaseChecklistBody,
  SWARM_LANE_LABELS,
} from "../templates.ts";

describe("templates", () => {
  describe("formatMilestoneIssueBody", () => {
    it("includes title and vision", () => {
      const body = formatMilestoneIssueBody({
        id: "M001",
        title: "Build Auth",
        vision: "Secure authentication for all users",
      });
      assert.ok(body.includes("M001: Build Auth"));
      assert.ok(body.includes("Secure authentication"));
    });

    it("renders success criteria as checkboxes", () => {
      const body = formatMilestoneIssueBody({
        id: "M001",
        title: "Auth",
        successCriteria: ["Users can log in", "OAuth works"],
      });
      assert.ok(body.includes("- [ ] Users can log in"));
      assert.ok(body.includes("- [ ] OAuth works"));
    });

    it("renders slice table", () => {
      const body = formatMilestoneIssueBody({
        id: "M001",
        title: "Auth",
        slices: [
          { id: "S01", title: "Core types", taskCount: 3 },
          { id: "S02", title: "OAuth", taskCount: 5 },
        ],
      });
      assert.ok(body.includes("| S01 | Core types | 3 |"));
      assert.ok(body.includes("| S02 | OAuth | 5 |"));
    });
  });

  describe("formatSlicePRBody", () => {
    it("includes goal and must-haves", () => {
      const body = formatSlicePRBody({
        id: "S01",
        title: "Core Auth Types",
        goal: "Define all auth types",
        mustHaves: ["User type", "Session type"],
      });
      assert.ok(body.includes("Define all auth types"));
      assert.ok(body.includes("- User type"));
      assert.ok(body.includes("- Session type"));
    });

    it("renders task checklist with issue links", () => {
      const body = formatSlicePRBody({
        id: "S01",
        title: "Auth",
        tasks: [
          { id: "T01", title: "Types", issueNumber: 43 },
          { id: "T02", title: "Schema" },
        ],
      });
      assert.ok(body.includes("- [ ] T01: Types (#43)"));
      assert.ok(body.includes("- [ ] T02: Schema"));
      assert.ok(!body.includes("T02: Schema (#"));
    });
  });

  describe("formatTaskIssueBody", () => {
    it("includes files and verification", () => {
      const body = formatTaskIssueBody({
        id: "T01",
        title: "Add types",
        files: ["src/types.ts"],
        verifyCriteria: ["Types compile"],
      });
      assert.ok(body.includes("`src/types.ts`"));
      assert.ok(body.includes("- [ ] Types compile"));
    });
  });

  describe("formatSummaryComment", () => {
    it("includes one-liner and body", () => {
      const comment = formatSummaryComment({
        oneLiner: "Added retry logic",
        body: "Implemented exponential backoff",
      });
      assert.ok(comment.includes("**Summary:** Added retry logic"));
      assert.ok(comment.includes("Implemented exponential backoff"));
    });

    it("wraps frontmatter in details block", () => {
      const comment = formatSummaryComment({
        frontmatter: { duration: "45m", key_files: ["a.ts"] },
      });
      assert.ok(comment.includes("<details>"));
      assert.ok(comment.includes("duration:"));
    });

    it("handles empty data gracefully", () => {
      const comment = formatSummaryComment({});
      assert.equal(typeof comment, "string");
    });
  });

  describe("swarm delivery routines", () => {
    it("formats lane PR bodies with impact, risks, rollback, and evidence", () => {
      const body = formatSwarmLanePRBody({
        lane: {
          id: "writer",
          branch: "lane/single-writer",
          owner: "@owner",
          latestCommit: "abc1234",
          changedContracts: ["WriterToken"],
          testEvidence: ["npm run typecheck:extensions"],
        },
        impactArea: "Single-writer UOK metadata.",
        transitionRisks: ["Writer token lifecycle regression"],
        rollbackPlan: ["Disable writer sequence enrichment"],
        linkedIssue: 123,
      });

      assert.ok(body.includes("`lane/writer`"));
      assert.ok(body.includes("Single-writer UOK metadata."));
      assert.ok(body.includes("- [ ] Writer token lifecycle regression"));
      assert.ok(body.includes("- [ ] Disable writer sequence enrichment"));
      assert.ok(body.includes("- [ ] npm run typecheck:extensions"));
      assert.ok(body.includes("Closes #123"));
    });

    it("formats release checklist bodies from lane state", () => {
      const body = formatSwarmReleaseChecklistBody({
        integrationBranch: "integration/uok-swarm",
        lanes: [
          { id: "workflow", branch: "lane/workflow-engine", owner: "@a", latestCommit: "1111111" },
          { id: "state", branch: "lane/state-machine", blockers: ["matrix gap"] },
        ],
        parityReport: "No critical mismatches.",
        rollbackDrill: "Passed fallback drill.",
        requiredChecks: ["unit", "integration"],
      });

      assert.ok(body.includes("`integration/uok-swarm`"));
      assert.ok(body.includes("| `lane/workflow` | `lane/workflow-engine` | @a | `1111111` | ready |"));
      assert.ok(body.includes("| `lane/state` | `lane/state-machine` |  |  | blocked |"));
      assert.ok(body.includes("- [ ] UOK parity report attached or linked"));
      assert.ok(body.includes("- [ ] unit"));
      assert.ok(body.includes("Passed fallback drill."));
    });

    it("declares expected swarm lane labels for generated GitHub routines", () => {
      assert.deepEqual(Object.values(SWARM_LANE_LABELS), [
        "lane/workflow",
        "lane/state",
        "lane/writer",
        "lane/uok",
        "lane/github",
      ]);
    });
  });
});
