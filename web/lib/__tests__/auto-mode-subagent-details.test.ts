import { describe, test } from "node:test"
import assert from "node:assert/strict"

import { extractSubagentSnapshotGroups } from "../auto-mode-subagent-details.ts"

describe("extractSubagentSnapshotGroups", () => {
  test("pairs tool results back onto the matching tool call when toolCallId is present", () => {
    const groups = extractSubagentSnapshotGroups({
      mode: "single",
      agentScope: "project",
      projectAgentsDir: null,
      results: [
        {
          agent: "researcher",
          step: 2,
          messages: [
            {
              role: "assistant",
              content: [
                { type: "text", text: "Searching files" },
                { type: "toolCall", id: "call-1", name: "Grep", arguments: { pattern: "auto-console", path: "web" } },
              ],
            },
            {
              role: "toolResult",
              toolCallId: "call-1",
              toolName: "Grep",
              isError: false,
              content: [
                { type: "text", text: "web/components/gsd/auto-mode-console.tsx" },
              ],
            },
            {
              role: "assistant",
              content: [
                { type: "text", text: "Found the component." },
              ],
            },
          ],
        },
      ],
    })

    assert.deepEqual(groups, [
      {
        agent: "researcher",
        step: 2,
        items: [
          { type: "assistant-text", text: "Searching files" },
          {
            type: "tool-call",
            name: "Grep",
            args: { pattern: "auto-console", path: "web" },
            resultText: "web/components/gsd/auto-mode-console.tsx",
            resultIsError: false,
          },
          { type: "assistant-text", text: "Found the component." },
        ],
      },
    ])
  })

  test("keeps orphan tool results standalone and drops empty result groups", () => {
    const groups = extractSubagentSnapshotGroups({
      results: [
        {
          agent: "planner",
          messages: [
            {
              role: "toolResult",
              toolName: "Bash",
              isError: true,
              content: "command failed",
            },
          ],
        },
        {
          agent: "silent",
          messages: [],
        },
      ],
    })

    assert.deepEqual(groups, [
      {
        agent: "planner",
        items: [
          { type: "tool-result", toolName: "Bash", text: "command failed", isError: true },
        ],
      },
    ])
  })

  test("returns null when details do not contain subagent results", () => {
    assert.equal(extractSubagentSnapshotGroups(undefined), null)
    assert.equal(extractSubagentSnapshotGroups({}), null)
    assert.equal(extractSubagentSnapshotGroups({ results: [] }), null)
  })
})
