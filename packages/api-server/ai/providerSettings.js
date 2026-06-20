import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getProviderMeta, listProviderMeta, normalizeProviderName } from "./providerMeta.js";

const SETTINGS_FILE = "provider-settings.json";
const ENTERPRISE_PROVIDER_IDS = Object.freeze(["openai", "anthropic", "ollama"]);

function nowIso() {
  return new Date().toISOString();
}

function envValue(name) {
  return name ? String(process.env[name] || "").trim() : "";
}

function previewSecret(secret) {
  const text = String(secret || "");
  if (!text) return "";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function settingsPath(project) {
  return join(project.path, ".datalex", "agent", SETTINGS_FILE);
}

function readStore(project) {
  const path = settingsPath(project);
  if (!existsSync(path)) return { version: 1, selectedProvider: "", providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    const selected = String(parsed?.selectedProvider || "").trim();
    return {
      version: 1,
      selectedProvider: selected ? normalizeProviderName(selected) : "",
      providers: parsed?.providers && typeof parsed.providers === "object" ? parsed.providers : {},
    };
  } catch {
    return { version: 1, selectedProvider: "", providers: {} };
  }
}

function writeStore(project, store) {
  const path = settingsPath(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort for filesystems that support chmod.
  }
}

function envConfigForProvider(id) {
  const meta = getProviderMeta(id);
  return {
    apiKey: envValue(meta?.envVar),
    baseUrl: envValue(meta?.baseUrlEnvVar),
    model: envValue(meta?.modelEnvVar),
  };
}

function providerSource(local, envConfig) {
  const hasLocal = Boolean(local?.apiKey || local?.baseUrl || local?.model);
  const hasEnv = Boolean(envConfig.apiKey || envConfig.baseUrl || envConfig.model);
  if (hasLocal && hasEnv) return "env+local";
  if (hasEnv) return "env";
  if (hasLocal) return "local";
  return "none";
}

function redactedProvider(project, id, store = readStore(project)) {
  const provider = normalizeProviderName(id);
  const meta = getProviderMeta(provider);
  const local = store.providers?.[provider] || {};
  const envConfig = envConfigForProvider(provider);
  const apiKey = envConfig.apiKey || local.apiKey;
  const baseUrl = envConfig.baseUrl || local.baseUrl || "";
  const model = envConfig.model || local.model || meta?.defaultModel || "";
  const noKeyNeeded = meta?.apiKey === "none";
  return {
    id: provider,
    label: provider === "anthropic" ? "Claude" : meta?.label || provider,
    enabled: local.enabled ?? Boolean(apiKey || noKeyNeeded || baseUrl || model),
    hasApiKey: noKeyNeeded || Boolean(apiKey),
    apiKeyPreview: envConfig.apiKey ? `${meta.envVar}=set` : local.apiKey ? previewSecret(local.apiKey) : "",
    baseUrl,
    model,
    source: providerSource(local, envConfig),
    envVars: [meta?.envVar, meta?.modelEnvVar, meta?.baseUrlEnvVar].filter(Boolean),
    requiresApiKey: meta?.apiKey === "required",
    testStatus: local.testStatus || "untested",
    testedAt: local.testedAt || "",
    testMessage: local.testMessage || "",
    selected: store.selectedProvider ? store.selectedProvider === provider : false,
  };
}

export function providerSettingsFile(project) {
  return settingsPath(project);
}

export function listEnterpriseProviderSettings(project) {
  const store = readStore(project);
  const providers = ENTERPRISE_PROVIDER_IDS.map((id) => redactedProvider(project, id, store));
  const selectedProvider = store.selectedProvider || providers.find((item) => item.testStatus === "passed")?.id || "";
  return {
    version: 1,
    selectedProvider,
    settingsPath: settingsPath(project),
    providers: providers.map((provider) => ({
      ...provider,
      selected: selectedProvider ? provider.id === selectedProvider : provider.selected,
    })),
    supportedProviders: listProviderMeta().filter((provider) => ENTERPRISE_PROVIDER_IDS.includes(provider.id)),
  };
}

export function saveEnterpriseProviderSettings(project, input = {}) {
  const provider = normalizeProviderName(input.provider || input.id || "");
  if (!ENTERPRISE_PROVIDER_IDS.includes(provider)) {
    throw new Error(`Unsupported enterprise AI provider: ${provider || "missing"}`);
  }
  const store = readStore(project);
  const existing = store.providers?.[provider] || {};
  const next = {
    id: provider,
    enabled: input.enabled ?? existing.enabled ?? true,
    apiKey: input.apiKey === undefined ? existing.apiKey : String(input.apiKey || "").trim() || undefined,
    baseUrl: input.baseUrl === undefined ? existing.baseUrl : String(input.baseUrl || "").trim() || undefined,
    model: input.model === undefined ? existing.model : String(input.model || "").trim() || undefined,
    testStatus: input.testStatus || existing.testStatus || "untested",
    testedAt: input.testedAt === undefined ? existing.testedAt : input.testedAt,
    testMessage: input.testMessage === undefined ? existing.testMessage : input.testMessage,
    updatedAt: nowIso(),
  };
  if (input.apiKey !== undefined && !next.apiKey) delete next.apiKey;
  if (input.baseUrl !== undefined && !next.baseUrl) delete next.baseUrl;
  if (input.model !== undefined && !next.model) delete next.model;
  store.version = 1;
  store.selectedProvider = provider;
  store.providers = { ...(store.providers || {}), [provider]: next };
  writeStore(project, store);
  return listEnterpriseProviderSettings(project);
}

export function getEffectiveEnterpriseProviderConfig(project, providerId = "") {
  const settings = listEnterpriseProviderSettings(project);
  const provider = normalizeProviderName(providerId || settings.selectedProvider || "");
  const row = settings.providers.find((item) => item.id === provider) || settings.providers.find((item) => item.testStatus === "passed") || null;
  if (!row) return null;
  const store = readStore(project);
  const local = store.providers?.[row.id] || {};
  const envConfig = envConfigForProvider(row.id);
  const meta = getProviderMeta(row.id);
  return {
    provider: row.id,
    label: row.label,
    model: envConfig.model || local.model || meta?.defaultModel || "",
    baseUrl: envConfig.baseUrl || local.baseUrl || "",
    apiKey: envConfig.apiKey || local.apiKey || "",
    envKey: meta?.envVar || "",
    baseUrlEnvKey: meta?.baseUrlEnvVar || "",
    requiresApiKey: meta?.apiKey === "required",
    testStatus: local.testStatus || "untested",
    testedAt: local.testedAt || "",
  };
}

export function markEnterpriseProviderTest(project, providerId, { status, message = "" } = {}) {
  const provider = normalizeProviderName(providerId);
  const store = readStore(project);
  const existing = store.providers?.[provider] || {};
  store.version = 1;
  store.selectedProvider = provider;
  store.providers = {
    ...(store.providers || {}),
    [provider]: {
      ...existing,
      id: provider,
      enabled: existing.enabled ?? true,
      testStatus: status,
      testedAt: nowIso(),
      testMessage: message,
      updatedAt: nowIso(),
    },
  };
  writeStore(project, store);
  return listEnterpriseProviderSettings(project);
}

export function enterpriseAiGenerationStatus(project, providerId = "") {
  const settings = listEnterpriseProviderSettings(project);
  const config = getEffectiveEnterpriseProviderConfig(project, providerId);
  if (!config?.provider) {
    return {
      ready: false,
      reason: "no_provider_selected",
      message: "Choose and test OpenAI, Claude, or Ollama before AI generation.",
      settings,
    };
  }
  if (config.requiresApiKey && !config.apiKey) {
    return {
      ready: false,
      reason: "missing_api_key",
      provider: config.provider,
      message: `Missing ${config.envKey || "API key"} for ${config.label || config.provider}.`,
      settings,
    };
  }
  if (config.testStatus !== "passed") {
    return {
      ready: false,
      reason: "provider_not_tested",
      provider: config.provider,
      model: config.model,
      message: "Test the AI provider before generating enterprise proposals.",
      settings,
    };
  }
  return {
    ready: true,
    provider: config.provider,
    label: config.label,
    model: config.model,
    testedAt: config.testedAt,
    message: `${config.label || config.provider} is ready for AI proposal generation.`,
    settings,
  };
}
