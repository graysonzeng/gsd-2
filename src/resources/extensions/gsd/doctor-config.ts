import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { AuthStorage, ModelRegistry } from "@gsd/pi-coding-agent";
import type { DoctorIssueCode, DoctorSeverity } from "./doctor-types.js";
import { inspectPreferenceHealth, type PreferenceDoctorFinding } from "./doctor-preferences.js";
import { PROVIDER_REGISTRY } from "./key-manager.js";

export type ConfigDoctorScope = "preferences" | "models" | "auth" | "settings" | "key_model";

export interface ConfigDoctorFinding {
  scope: ConfigDoctorScope;
  severity: DoctorSeverity;
  code: DoctorIssueCode;
  effectivePath: string;
  message: string;
  remediation: string;
  detail?: string;
}

interface ResolvedDefaultModel {
  configuredProvider?: string;
  configuredModel?: string;
  effectiveProvider?: string;
  effectiveModel?: string;
  source: "configured" | "fallback" | "unresolved";
  status: "ok" | "warning" | "error";
  message: string;
  remediation: string;
}

interface KeyModelAvailability {
  status: "ok" | "warning" | "error";
  code: DoctorIssueCode;
  message: string;
  remediation: string;
  detail?: string;
}

interface EffectiveSettingsSnapshot {
  configuredProvider?: string;
  configuredModel?: string;
}

function getAgentDirPath(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), ".pi", "agent");
}

/**
 * Resolve models.json path with GSD → PI fallback.
 *
 * IMPORTANT: PI fallback path is intentionally hardcoded to ~/.pi/agent/models.json
 * to match the behavior in src/models-resolver.ts. Both implementations must use
 * the same PI path so that doctor diagnostics align with actual CLI runtime behavior.
 * If you change PI path resolution here, update src/models-resolver.ts as well.
 *
 * See also: src/models-resolver.ts:resolveModelsJsonPath (twin implementation,
 * kept separate due to tsconfig rootDir constraints).
 */
function resolveModelsJsonPath(): string {
  const gsdHome = process.env.GSD_HOME || join(homedir(), ".gsd");
  const gsdModelsPath = join(gsdHome, "agent", "models.json");
  // Hardcoded PI path — intentionally does NOT use getAgentDirPath() here
  // to stay aligned with src/models-resolver.ts which also hardcodes this path.
  const piModelsPath = join(homedir(), ".pi", "agent", "models.json");
  if (existsSync(gsdModelsPath)) {
    return gsdModelsPath;
  }
  if (existsSync(piModelsPath)) {
    return piModelsPath;
  }
  return gsdModelsPath;
}

function getProjectSettingsPath(basePath: string): string {
  return join(basePath, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string {
  return join(getAgentDirPath(), "settings.json");
}

function getAuthStorage(): AuthStorage {
  return AuthStorage.create(join(getAgentDirPath(), "auth.json"));
}

function providerLabel(providerId: string | undefined): string {
  if (!providerId) return "unknown provider";
  return PROVIDER_REGISTRY.find((provider) => provider.id === providerId)?.label ?? providerId;
}

function modelsFileRemediation(path: string): string {
  const canonical = join(dirname(path), "models.json");
  return `Create or fix ${canonical} with valid JSON. Define provider baseUrl/apiKey/model entries only when you need custom providers or model overrides.`;
}

function authFileRemediation(path: string): string {
  return `Fix ${path} to valid JSON or re-run /gsd keys or /login to recreate credentials without editing secret values directly.`;
}

function settingsRemediation(path: string): string {
  return `Update ${path} so defaultProvider/defaultModel point at an available runtime model, or delete those keys to let GSD fall back automatically.`;
}

function readJsonObject(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function readEffectiveSettings(basePath: string): EffectiveSettingsSnapshot {
  const globalPath = getGlobalSettingsPath();
  const projectPath = getProjectSettingsPath(basePath);

  const globalSettings = existsSync(globalPath) ? readJsonObject(globalPath) : {};
  const projectSettings = existsSync(projectPath) ? readJsonObject(projectPath) : {};
  const merged = { ...globalSettings, ...projectSettings };

  return {
    configuredProvider: typeof merged.defaultProvider === "string" ? merged.defaultProvider : undefined,
    configuredModel: typeof merged.defaultModel === "string" ? merged.defaultModel : undefined,
  };
}

function inspectModelsJson(): ConfigDoctorFinding {
  const path = resolveModelsJsonPath();
  if (!existsSync(path)) {
    return {
      scope: "models",
      severity: "info",
      code: "config_surface_ok",
      effectivePath: path,
      message: "models.json is absent; only built-in registry models will be available.",
      remediation: "No action needed unless you want custom providers, model overrides, or local registry extensions.",
    };
  }

  try {
    JSON.parse(readFileSync(path, "utf-8"));
    return {
      scope: "models",
      severity: "info",
      code: "config_surface_ok",
      effectivePath: path,
      message: "models.json is valid JSON and can be loaded for runtime model registration.",
      remediation: "No action needed.",
    };
  } catch (error) {
    return {
      scope: "models",
      severity: "error",
      code: "models_json_invalid",
      effectivePath: path,
      message: `models.json exists but could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      remediation: modelsFileRemediation(path),
    };
  }
}

function inspectAuthJson(): ConfigDoctorFinding {
  const authPath = join(getAgentDirPath(), "auth.json");
  if (!existsSync(authPath)) {
    return {
      scope: "auth",
      severity: "info",
      code: "config_surface_ok",
      effectivePath: authPath,
      message: "auth.json is absent; runtime auth will rely on environment variables, CLI auth, or models.json provider keys.",
      remediation: "No action needed unless you want persisted OAuth/API-key credentials managed by /gsd keys or /login.",
    };
  }

  try {
    JSON.parse(readFileSync(authPath, "utf-8"));
  } catch (error) {
    return {
      scope: "auth",
      severity: "error",
      code: "auth_json_invalid",
      effectivePath: authPath,
      message: `auth.json exists but could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      remediation: authFileRemediation(authPath),
    };
  }

  const auth = getAuthStorage();
  const providers = auth.list();
  return {
    scope: "auth",
    severity: "info",
    code: "config_surface_ok",
    effectivePath: authPath,
    message: providers.length > 0
      ? `auth.json is readable and contains credentials for ${providers.length} provider${providers.length === 1 ? "" : "s"}.`
      : "auth.json is readable but does not currently contain any provider credentials.",
    remediation: providers.length > 0
      ? "No action needed."
      : "Use /gsd keys or /login if you want to persist provider credentials here.",
  };
}

function resolveDefaultModel(basePath: string): ResolvedDefaultModel {
  const settingsPath = getProjectSettingsPath(basePath);
  const { configuredProvider, configuredModel } = readEffectiveSettings(basePath);
  const authStorage = getAuthStorage();
  const modelRegistry = new ModelRegistry(authStorage, resolveModelsJsonPath());
  const availableModels = modelRegistry.getAvailable();

  const configuredExists = !!(
    configuredProvider &&
    configuredModel &&
    availableModels.some((model) => model.provider === configuredProvider && model.id === configuredModel)
  );

  if (configuredProvider && configuredModel && configuredExists) {
    return {
      configuredProvider,
      configuredModel,
      effectiveProvider: configuredProvider,
      effectiveModel: configuredModel,
      source: "configured",
      status: "ok",
      message: `settings.json default ${configuredProvider}/${configuredModel} resolves to an available runtime model.`,
      remediation: "No action needed.",
    };
  }

  const fallback =
    (configuredProvider
      ? availableModels.find((model) => model.provider === configuredProvider)
      : undefined) ||
    availableModels[0];

  if (fallback) {
    const missingConfigured = configuredProvider && configuredModel
      ? `${configuredProvider}/${configuredModel}`
      : "no explicit default model";
    return {
      configuredProvider,
      configuredModel,
      effectiveProvider: fallback.provider,
      effectiveModel: fallback.id,
      source: "fallback",
      status: configuredProvider || configuredModel ? "warning" : "ok",
      message: configuredProvider && configuredModel
        ? `settings.json default ${missingConfigured} is not currently resolvable; runtime would fall back to ${fallback.provider}/${fallback.id}.`
        : `No explicit default model is configured; runtime would use ${fallback.provider}/${fallback.id}.`,
      remediation: configuredProvider && configuredModel
        ? settingsRemediation(settingsPath)
        : "Set defaultProvider/defaultModel only if you want to pin a specific runtime default.",
    };
  }

  const configuredSummary = configuredProvider && configuredModel
    ? `${configuredProvider}/${configuredModel}`
    : "no explicit default model";
  return {
    configuredProvider,
    configuredModel,
    source: "unresolved",
    status: "error",
    message: `Runtime cannot resolve ${configuredSummary} because no authenticated or otherwise ready models are available.`,
    remediation: `Configure at least one ready provider/model path, then update ${settingsPath} if you want to pin a default.`,
  };
}

function inspectEffectiveSettings(basePath: string): ConfigDoctorFinding {
  const settingsPath = getProjectSettingsPath(basePath);
  const resolved = resolveDefaultModel(basePath);
  return {
    scope: "settings",
    severity: resolved.status === "ok" ? "info" : resolved.status,
    code: resolved.status === "error" ? "default_model_unresolvable" : resolved.status === "warning" ? "default_model_fallback" : "config_surface_ok",
    effectivePath: settingsPath,
    message: resolved.message,
    remediation: resolved.remediation,
    detail: resolved.effectiveProvider && resolved.effectiveModel
      ? `effective runtime default: ${providerLabel(resolved.effectiveProvider)} (${resolved.effectiveProvider}/${resolved.effectiveModel})`
      : undefined,
  };
}

function inspectKeyModelAvailability(basePath: string): ConfigDoctorFinding {
  const settingsPath = getProjectSettingsPath(basePath);
  const resolved = resolveDefaultModel(basePath);

  let availability: KeyModelAvailability;
  if (resolved.source === "configured" && resolved.effectiveProvider && resolved.effectiveModel) {
    availability = {
      status: "ok",
      code: "key_model_available",
      message: `Key model ${resolved.effectiveProvider}/${resolved.effectiveModel} is runtime-ready now.`,
      remediation: "No action needed.",
      detail: `effective runtime default: ${providerLabel(resolved.effectiveProvider)} (${resolved.effectiveProvider}/${resolved.effectiveModel})`,
    };
  } else if (resolved.source === "fallback" && resolved.effectiveProvider && resolved.effectiveModel) {
    const configuredDetail = resolved.configuredProvider && resolved.configuredModel
      ? `configured default: ${resolved.configuredProvider}/${resolved.configuredModel}`
      : "configured default: none";
    availability = {
      status: resolved.configuredProvider && resolved.configuredModel ? "warning" : "ok",
      code: resolved.configuredProvider && resolved.configuredModel ? "key_model_fallback" : "key_model_available",
      message: resolved.configuredProvider && resolved.configuredModel
        ? `Configured key model ${resolved.configuredProvider}/${resolved.configuredModel} is not runtime-ready; runtime would use ${resolved.effectiveProvider}/${resolved.effectiveModel} instead.`
        : `Key model ${resolved.effectiveProvider}/${resolved.effectiveModel} is runtime-ready now.`,
      remediation: resolved.configuredProvider && resolved.configuredModel
        ? settingsRemediation(settingsPath)
        : "No action needed.",
      detail: resolved.configuredProvider && resolved.configuredModel
        ? `${configuredDetail}; effective runtime default: ${providerLabel(resolved.effectiveProvider)} (${resolved.effectiveProvider}/${resolved.effectiveModel})`
        : `effective runtime default: ${providerLabel(resolved.effectiveProvider)} (${resolved.effectiveProvider}/${resolved.effectiveModel})`,
    };
  } else {
    const configuredDetail = resolved.configuredProvider && resolved.configuredModel
      ? `configured default: ${resolved.configuredProvider}/${resolved.configuredModel}`
      : "configured default: none";
    availability = {
      status: "error",
      code: "key_model_unavailable",
      message: "Key model is unavailable because no runtime-ready model can be resolved right now.",
      remediation: `Configure at least one ready provider/model path, then update ${settingsPath} if you want to pin a default.`,
      detail: configuredDetail,
    };
  }

  return {
    scope: "key_model",
    severity: availability.status === "ok" ? "info" : availability.status,
    code: availability.code,
    effectivePath: settingsPath,
    message: availability.message,
    remediation: availability.remediation,
    detail: availability.detail,
  };
}

function convertPreferenceFinding(finding: PreferenceDoctorFinding): ConfigDoctorFinding {
  return {
    scope: "preferences",
    severity: finding.severity,
    code: finding.code,
    effectivePath: finding.effectivePath,
    message: `[${finding.scope}] ${finding.message}`,
    remediation: finding.remediation,
    detail: finding.legacyFallback ? "Loaded from a legacy fallback path." : undefined,
  };
}

export function inspectDoctorConfig(basePath: string = process.cwd()): ConfigDoctorFinding[] {
  const findings: ConfigDoctorFinding[] = [];

  for (const preferenceFinding of inspectPreferenceHealth(basePath)) {
    findings.push(convertPreferenceFinding(preferenceFinding));
  }

  findings.push(inspectModelsJson());
  findings.push(inspectAuthJson());
  findings.push(inspectEffectiveSettings(basePath));
  findings.push(inspectKeyModelAvailability(basePath));

  return findings;
}
