/**
 * Auto-Mode API Key Validator
 */

import type { ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AutoModeValidationResult {
  valid: boolean;
  apiKeyMasked: string | null;
  availableModels: string[];
  primaryModel: string;
  reviewerModel: string;
  protocol: "anthropic" | "openai";
  error?: string;
}

export interface AutoModeConfig {
  apiUrl: string;
  apiKey: string | null;
  primaryModel: string;
  reviewerModel: string;
  preferredProtocol: "anthropic" | "openai";
}

export const DEFAULT_AUTO_MODE_CONFIG: AutoModeConfig = {
  apiUrl: "https://api.sandboxai.top/v1",
  apiKey: null,
  primaryModel: "gpt-5.4",
  reviewerModel: "claude-opus-4-6",
  preferredProtocol: "anthropic",
};

export function getAutoModeApiKey(): string | null {
  const envKey = process.env.SANDBOXAI_API_KEY;
  if (envKey?.trim()) return envKey.trim();

  const configPath = join(homedir(), ".gsd", "agent", "models.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      const psData = config?.["[redacted]s"] as Record<string, { apiKey?: string }> | undefined;
      const sandboxaiConfig = psData?.["sandboxai"];
      if (sandboxaiConfig?.apiKey) {
        const key = sandboxaiConfig.apiKey;
        if (typeof key === "string" && key.startsWith("env:")) {
          return process.env[key.slice(4)] ?? null;
        }
        return key;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

export async function validateAutoModeApiKey(
  apiKey: string,
  apiUrl: string = DEFAULT_AUTO_MODE_CONFIG.apiUrl,
): Promise<AutoModeValidationResult> {
  try {
    const response = await fetch(apiUrl + "/models", {
      headers: { "Authorization": "Bearer " + apiKey },
    });

    if (!response.ok) {
      return {
        valid: false,
        apiKeyMasked: null,
        availableModels: [],
        primaryModel: DEFAULT_AUTO_MODE_CONFIG.primaryModel,
        reviewerModel: DEFAULT_AUTO_MODE_CONFIG.reviewerModel,
        protocol: "openai",
        error: "HTTP " + response.status + ": " + response.statusText,
      };
    }

    const data = await response.json() as { success?: boolean; error?: { message?: string }; data?: Array<{ id: string }> };

    if (!data.success && data.error) {
      return {
        valid: false,
        apiKeyMasked: null,
        availableModels: [],
        primaryModel: DEFAULT_AUTO_MODE_CONFIG.primaryModel,
        reviewerModel: DEFAULT_AUTO_MODE_CONFIG.reviewerModel,
        protocol: "openai",
        error: data.error?.message || "Unknown error",
      };
    }

    const models = Array.isArray(data) ? data : data.data || [];
    const modelIds = models.map((m) => m.id).filter(Boolean);

    const hasGpt54 = modelIds.includes("gpt-5.4");
    const hasClaudeOpus = modelIds.includes("claude-opus-4-6");

    if (!hasGpt54) {
      return {
        valid: false,
        apiKeyMasked: maskApiKey(apiKey),
        availableModels: modelIds,
        primaryModel: DEFAULT_AUTO_MODE_CONFIG.primaryModel,
        reviewerModel: DEFAULT_AUTO_MODE_CONFIG.reviewerModel,
        protocol: "openai",
        error: "gpt-5.4 model not available",
      };
    }

    return {
      valid: true,
      apiKeyMasked: maskApiKey(apiKey),
      availableModels: modelIds,
      primaryModel: DEFAULT_AUTO_MODE_CONFIG.primaryModel,
      reviewerModel: hasClaudeOpus ? DEFAULT_AUTO_MODE_CONFIG.reviewerModel : DEFAULT_AUTO_MODE_CONFIG.primaryModel,
      protocol: hasClaudeOpus ? "anthropic" : "openai",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      apiKeyMasked: null,
      availableModels: [],
      primaryModel: DEFAULT_AUTO_MODE_CONFIG.primaryModel,
      reviewerModel: DEFAULT_AUTO_MODE_CONFIG.reviewerModel,
      protocol: "openai",
      error: "Connection failed: " + errorMsg,
    };
  }
}

export async function validateAndNotifyAutoModeApiKey(
  ctx: ExtensionCommandContext,
  _pi: { ui: ExtensionCommandContext["ui"] },
): Promise<boolean> {
  const apiKey = getAutoModeApiKey();

  if (!apiKey) {
    ctx.ui.notify(
      "Auto-mode requires SANDBOXAI_API_KEY environment variable or sandboxai [redacted] config in ~/.gsd/agent/models.json",
      "error",
    );
    ctx.ui.notify(
      "Set it with: export SANDBOXAI_API_KEY=sk-YOUR-KEY-HERE",
      "info",
    );
    return false;
  }

  ctx.ui.notify("Validating auto-mode API key...", "info");

  const result = await validateAutoModeApiKey(apiKey);

  if (!result.valid) {
    ctx.ui.notify(
      "Auto-mode API key validation failed: " + result.error,
      "error",
    );
    if (result.availableModels.length > 0) {
      ctx.ui.notify(
        "Available models: " + result.availableModels.slice(0, 5).join(", "),
        "warning",
      );
    }
    return false;
  }

  ctx.ui.notify(
    "Auto-mode API key validated: " + result.primaryModel + " (primary), " + result.reviewerModel + " (reviewer)",
    "info",
  );

  return true;
}

export function getEffectiveAutoModeConfig(): AutoModeConfig & { apiKeyMasked: string | null } {
  const apiKey = getAutoModeApiKey();
  return {
    ...DEFAULT_AUTO_MODE_CONFIG,
    apiKey,
    apiKeyMasked: apiKey ? maskApiKey(apiKey) : null,
  };
}
