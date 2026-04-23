import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Agent } from "@gsd/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import type { ToolDefinition } from "./extensions/index.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import { ModelRegistry } from "./model-registry.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

let testDir = "";

function exampleExtraTool(): ToolDefinition {
  return {
    name: "example_extra",
    label: "Example Extra",
    description: "Example extension-like SDK tool for restriction tests.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  };
}

async function createSession(options?: {
  initialActiveToolNames?: string[];
  includeBuiltInSkillTool?: boolean;
  autoActivateNewExtensionTools?: boolean;
  extraActiveToolNames?: string[];
  customTools?: Array<ReturnType<typeof exampleExtraTool>>;
}) {
  const agentDir = join(testDir, "agent-home");
  mkdirSync(agentDir, { recursive: true });
  const authStorage = AuthStorage.inMemory({});
  const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: testDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  return new AgentSession({
    agent: new Agent(),
    sessionManager: SessionManager.inMemory(testDir),
    settingsManager,
    cwd: testDir,
    resourceLoader,
    modelRegistry,
    initialActiveToolNames: options?.initialActiveToolNames,
    includeBuiltInSkillTool: options?.includeBuiltInSkillTool,
    autoActivateNewExtensionTools: options?.autoActivateNewExtensionTools,
    customTools: options?.customTools,
  });
}

describe("AgentSession tool restriction", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "agent-session-tool-restriction-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not auto-register Skill when includeBuiltInSkillTool=false", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read"],
      includeBuiltInSkillTool: false,
    });

    assert.deepEqual(session.getActiveToolNames(), ["read"]);
    assert.equal(session.getAllTools().some((tool) => tool.name === "Skill"), false);
  });

  it("does not auto-activate extension tools when autoActivateNewExtensionTools=false", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read"],
      autoActivateNewExtensionTools: false,
      customTools: [exampleExtraTool()],
    });

    assert.deepEqual(session.getActiveToolNames(), ["read", "Skill"]);
    assert.equal(session.getActiveToolNames().includes("example_extra"), false);
    assert.equal(session.getAllTools().some((tool) => tool.name === "example_extra"), true);
  });

  it("activates extension tools listed in initialActiveToolNames even when auto-activate is off", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read", "example_extra"],
      includeBuiltInSkillTool: false,
      autoActivateNewExtensionTools: false,
      customTools: [exampleExtraTool()],
    });

    const active = session.getActiveToolNames();
    assert.equal(active.includes("read"), true);
    assert.equal(active.includes("example_extra"), true);
    assert.equal(active.includes("Skill"), false);
  });

  it("default mode remains unchanged when both flags are omitted", async () => {
    const session = await createSession({
      customTools: [exampleExtraTool()],
    });

    assert.equal(session.getActiveToolNames().includes("Skill"), true);
    assert.equal(session.getActiveToolNames().includes("example_extra"), true);
  });

  it("restricted mode preserves the restriction across newSession and reload", async () => {
    const session = await createSession({
      initialActiveToolNames: ["read"],
      includeBuiltInSkillTool: false,
      autoActivateNewExtensionTools: false,
      customTools: [exampleExtraTool()],
    });

    await session.newSession();
    assert.deepEqual(session.getActiveToolNames(), ["read"]);
    assert.equal(session.getAllTools().some((tool) => tool.name === "Skill"), false);

    await session.reload();
    assert.deepEqual(session.getActiveToolNames(), ["read"]);
    assert.equal(session.getAllTools().some((tool) => tool.name === "Skill"), false);
    assert.equal(session.getAllTools().some((tool) => tool.name === "example_extra"), true);
  });
});
