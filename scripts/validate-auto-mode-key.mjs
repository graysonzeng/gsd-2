#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const API_URL = "https://api.sandboxai.top/v1";
const CONFIG_PATH = "/root/.gsd/agent/models.json";

function getApiKey() {
  const envKey = process.env.SANDBOXAI_API_KEY;
  if (envKey) return envKey;

  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      const pData = config && config["[redacted]s"];
      const sbConfig = pData && pData["sandboxai"];
      if (sbConfig && sbConfig.apiKey) {
        const key = sbConfig.apiKey;
        if (key.startsWith("env:")) {
          return process.env[key.slice(4)] ?? null;
        }
        return key;
      }
    } catch {}
  }
  return null;
}

function validateApiKey(apiKey) {
  return new Promise((resolve) => {
    try {
      const curlCmd = `curl -s "${API_URL}/models" -H "Authorization: Bearer ${apiKey}"`;
      const output = execSync(curlCmd, { timeout: 10000, encoding: "utf-8" });
      const data = JSON.parse(output);

      if (!data.success && data.error) {
        resolve({ valid: false, apiKeyMasked: null, availableModels: [], primaryModel: "gpt-5.4", reviewerModel: "claude-opus-4-6", protocol: "openai", error: data.error.message || "Unknown error" });
        return;
      }

      const models = Array.isArray(data) ? data : data.data || [];
      const modelIds = models.map((m) => m.id).filter(Boolean);
      const hasGpt54 = modelIds.includes("gpt-5.4");
      const hasClaudeOpus = modelIds.includes("claude-opus-4-6");

      if (!hasGpt54) {
        resolve({ valid: false, apiKeyMasked: maskKey(apiKey), availableModels: modelIds, primaryModel: "gpt-5.4", reviewerModel: "claude-opus-4-6", protocol: "openai", error: "gpt-5.4 model not available" });
        return;
      }

      resolve({ valid: true, apiKeyMasked: maskKey(apiKey), availableModels: modelIds, primaryModel: "gpt-5.4", reviewerModel: hasClaudeOpus ? "claude-opus-4-6" : "gpt-5.4", protocol: hasClaudeOpus ? "anthropic" : "openai" });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      resolve({ valid: false, apiKeyMasked: null, availableModels: [], primaryModel: "gpt-5.4", reviewerModel: "claude-opus-4-6", protocol: "openai", error: `Connection failed: ${errorMsg}` });
    }
  });
}

function maskKey(key) {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function main() {
  console.log("Auto-Mode API Key Validation\n");
  const apiKey = getApiKey();

  if (!apiKey) {
    console.log("ERROR: No API key found");
    console.log("\nPlease set SANDBOXAI_API_KEY environment variable:");
    console.log("  export SANDBOXAI_API_KEY=sk-YOUR-KEY-HERE");
    process.exit(1);
  }

  console.log(`Testing API Key: ${API_URL}`);
  console.log(`API Key: ${maskKey(apiKey)}\n`);
  const result = await validateApiKey(apiKey);

  if (!result.valid) {
    console.log("ERROR: Validation FAILED");
    console.log(`   Error: ${result.error}`);
    if (result.availableModels.length > 0) {
      console.log(`   Available models: ${result.availableModels.join(", ")}`);
    }
    process.exit(1);
  }

  console.log("SUCCESS: Validation PASSED\n");
  console.log("Configuration:");
  console.log(`   Primary Model:    ${result.primaryModel}`);
  console.log(`   Reviewer Model:   ${result.reviewerModel}`);
  console.log(`   Protocol:         ${result.protocol}`);
  console.log(`   Available Models: ${result.availableModels.slice(0, 5).join(", ")}${result.availableModels.length > 5 ? "..." : ""}`);
  console.log("\n--- VALIDATION_RESULT ---");
  console.log(JSON.stringify({ valid: result.valid, primaryModel: result.primaryModel, reviewerModel: result.reviewerModel, protocol: result.protocol, timestamp: new Date().toISOString() }));
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
