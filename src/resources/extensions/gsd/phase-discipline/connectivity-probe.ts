/**
 * Default ConnectivityProbe factory for auto-mode preflight.
 *
 * Builds a lightweight probe that verifies provider reachability by hitting the
 * provider's models list endpoint (or a provider-specific health endpoint) with
 * a short timeout. Providers using external CLI auth (e.g., claude-code) always
 * return ok since their connectivity is managed by the host CLI.
 *
 * The probe is intentionally simple: it only checks that the provider's API is
 * reachable and responds within the timeout. It does NOT validate model availability
 * or run inference — those checks are handled by the registry validation phase.
 */

import type { ConnectivityProbe } from "./preflight.js";

/**
 * Minimal ModelRegistry interface needed by the probe.
 * Avoids importing the full ModelRegistry class to prevent circular deps.
 */
export interface ProbeModelRegistry {
  getProviderAuthMode?(provider: string): string;
  getApiKeyForProvider(provider: string, sessionId?: string): Promise<string | undefined>;
  find(provider: string, modelId: string): { baseUrl: string } | undefined;
}

/** Providers that use external CLI auth — always "reachable" (host handles connectivity). */
const CLI_AUTH_PROVIDERS = new Set(["claude-code", "openai-codex", "google-gemini-cli", "google-antigravity"]);

/** Known provider base URLs when model lookup fails. */
const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  google: "https://generativelanguage.googleapis.com",
  openrouter: "https://openrouter.ai",
  "anthropic-vertex": "https://us-east5-aiplatform.googleapis.com",
};

/** Lightweight health endpoints per provider (prefer short responses). */
function getHealthUrl(provider: string, baseUrl: string): string {
  // Use the models list endpoint as a connectivity check — most providers support it
  // and it returns quickly with auth headers.
  if (provider === "anthropic") return `${baseUrl}/v1/models`;
  if (provider === "google") return `${baseUrl}/v1beta/models`;
  // OpenAI-compatible providers
  return `${baseUrl}/v1/models`;
}

/**
 * Create a default connectivity probe using the model registry for auth and URL resolution.
 *
 * @param registry - Model registry instance for API key and URL lookups
 * @param sessionId - Optional session ID for sticky credential selection
 */
export function createDefaultConnectivityProbe(
  registry: ProbeModelRegistry,
  sessionId?: string,
): ConnectivityProbe {
  return async (provider: string, model: string, timeoutMs: number) => {
    // Skip network check for CLI-auth providers
    const authMode = registry.getProviderAuthMode?.(provider);
    if (authMode === "externalCli" || authMode === "none" || CLI_AUTH_PROVIDERS.has(provider)) {
      return { ok: true };
    }

    // Resolve base URL from model registry
    const modelEntry = registry.find(provider, model);
    const baseUrl = modelEntry?.baseUrl ?? DEFAULT_PROVIDER_URLS[provider];
    if (!baseUrl) {
      // Can't determine URL — skip rather than false-fail
      return { ok: true };
    }

    // Get API key for authentication
    const apiKey = await registry.getApiKeyForProvider(provider, sessionId);

    const url = getHealthUrl(provider, baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        if (provider === "anthropic") {
          headers["x-api-key"] = apiKey;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      // 2xx/3xx/4xx all indicate the provider is reachable.
      // Even 401/403 means the endpoint is up — auth issues are caught by registry checks.
      // Only 5xx or network errors indicate unreachability.
      if (response.status >= 500) {
        return { ok: false, error: `${response.status} ${response.statusText}` };
      }
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, error: `Timeout after ${timeoutMs}ms` };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  };
}
