import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseToml } from "smol-toml";
import { DEFAULT_COMPACT_AT, MAX_COMPACT_AT } from "./context.ts";

export const CONFIG_FILENAME = "bishop.toml";

export const TOOL_NAMES = ["run_command", "apply_patch", "load_skill", "save_skill", "update_soul", "complete_onboarding", "web_search", "web_read", "update_memory", "search_history", "memory_indexer", "search_memories"] as const;
export type ToolName = typeof TOOL_NAMES[number];
export type ToolSettings = Partial<Record<ToolName, boolean>>;
export type ProviderSettings = { model?: string };
export const DEFAULT_MAX_DECISIONS = 100;
export const DEFAULT_MEMORY_BATCH_SECTIONS = 5;
export type MemorySettings = { batch_sections: number; excluded_session_prefixes: string[]; rate_limit_retries: number; retry_delay_seconds: number };
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { batch_sections: 5,
  excluded_session_prefixes: ["demo", "smoke", "layout-live-smoke", "restructure-smoke", "memory-startup-smoke"],
  rate_limit_retries: 2, retry_delay_seconds: 15 };
export type SearchSettings = { provider: "duckduckgo"; result_limit: number; timeout_ms: number };
export const DEFAULT_SEARCH_SETTINGS: SearchSettings = { provider: "duckduckgo", result_limit: 5, timeout_ms: 15000 };
export type WebReadSettings = { timeout_ms: number; max_bytes: number; max_characters: number; link_limit: number };
export const DEFAULT_WEB_READ_SETTINGS: WebReadSettings = { timeout_ms: 15000, max_bytes: 2_000_000, max_characters: 16000, link_limit: 30 };
export type Config = { tools: ToolSettings; provider: ProviderSettings; memory?: MemorySettings; agent?: { max_decisions: number }; context?: { compact_at_characters: number }; search?: SearchSettings; web_read?: WebReadSettings; onboarding?: { first_run: boolean } };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseConfig(value: unknown): Config {
  if (!object(value)) throw new Error("Bishop config must contain named settings sections.");
  for (const key of Object.keys(value)) {
    if (key !== "tools" && key !== "provider" && key !== "onboarding" && key !== "search" && key !== "web_read" && key !== "agent" && key !== "context" && key !== "memory") throw new Error(`Unknown Bishop config section: ${key}.`);
  }
  const tools = value.tools === undefined ? {} : value.tools;
  if (!object(tools)) throw new Error("Config tools must be an object of tool names and true/false values.");
  for (const [name, enabled] of Object.entries(tools)) {
    if (!TOOL_NAMES.includes(name as ToolName)) throw new Error(`Unknown tool in config: ${name}.`);
    if (typeof enabled !== "boolean") throw new Error(`Config tools.${name} must be true or false.`);
  }
  const provider = value.provider === undefined ? {} : value.provider;
  if (!object(provider)) throw new Error("Config provider must be an object.");
  for (const key of Object.keys(provider)) {
    if (key !== "model") throw new Error(`Unknown provider setting: ${key}.`);
  }
  if (provider.model !== undefined && (typeof provider.model !== "string" || !provider.model.trim())) {
    throw new Error("Config provider.model must be a nonempty model ID string.");
  }
  const onboarding = value.onboarding;
  const memory = value.memory;
  if (memory !== undefined && (!object(memory) || Object.keys(memory).some(key => !Object.hasOwn(DEFAULT_MEMORY_SETTINGS, key)) ||
      (memory.batch_sections !== undefined && (typeof memory.batch_sections !== "number" || !Number.isInteger(memory.batch_sections) || memory.batch_sections < 1 || memory.batch_sections > 5)))) {
    throw new Error("Config memory.batch_sections must be an integer from 1 to 5.");
  }
  if (object(memory)) {
    for (const [key, min, max] of [["rate_limit_retries", 0, 3], ["retry_delay_seconds", 5, 60]] as const) {
      const setting = memory[key];
      if (setting !== undefined && (typeof setting !== "number" || !Number.isInteger(setting) || setting < min || setting > max)) throw new Error(`Config memory.${key} must be an integer from ${min} to ${max}.`);
    }
    if (memory.excluded_session_prefixes !== undefined && (!Array.isArray(memory.excluded_session_prefixes) || memory.excluded_session_prefixes.length > 30 ||
        !memory.excluded_session_prefixes.every(prefix => typeof prefix === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(prefix)))) throw new Error("Config memory.excluded_session_prefixes must contain at most 30 valid session labels.");
  }
  const memorySettings = memory === undefined ? undefined : { ...DEFAULT_MEMORY_SETTINGS, ...memory } as MemorySettings;
  const context = value.context;
  if (context !== undefined && (!object(context) || Object.keys(context).some(key => key !== "compact_at_characters") ||
    (context.compact_at_characters !== undefined && (typeof context.compact_at_characters !== "number" || !Number.isInteger(context.compact_at_characters) || context.compact_at_characters < 16_000 || context.compact_at_characters > MAX_COMPACT_AT)))) {
    throw new Error(`Config context.compact_at_characters must be an integer from 16000 to ${MAX_COMPACT_AT}.`);
  }
  const agent = value.agent;
  if (agent !== undefined && (!object(agent) || Object.keys(agent).some(key => key !== "max_decisions") ||
    (agent.max_decisions !== undefined && (typeof agent.max_decisions !== "number" || !Number.isSafeInteger(agent.max_decisions) || agent.max_decisions < 1)))) {
    throw new Error("Config agent must contain only max_decisions, a positive safe integer.");
  }
  if (onboarding !== undefined && (!object(onboarding) || Object.keys(onboarding).some(key => key !== "first_run") || typeof onboarding.first_run !== "boolean")) {
    throw new Error("Config onboarding must contain first_run = true or false.");
  }
  const webRead = value.web_read;
  let webReadSettings: WebReadSettings | undefined;
  if (webRead !== undefined) {
    if (!object(webRead)) throw new Error("Config web_read must be an object.");
    for (const key of Object.keys(webRead)) {
      if (!Object.hasOwn(DEFAULT_WEB_READ_SETTINGS, key)) throw new Error(`Unknown web_read setting: ${key}.`);
    }
    for (const [key, maximum] of [["timeout_ms", 60000], ["max_bytes", 5_000_000], ["max_characters", 50000], ["link_limit", 100]] as const) {
      const setting = webRead[key];
      if (setting !== undefined && (typeof setting !== "number" || !Number.isInteger(setting) || setting < 1 || setting > maximum)) {
        throw new Error(`Config web_read.${key} must be an integer from 1 to ${maximum}.`);
      }
    }
    webReadSettings = { ...DEFAULT_WEB_READ_SETTINGS, ...webRead } as WebReadSettings;
  }
  const search = value.search;
  let searchSettings: SearchSettings | undefined;
  if (search !== undefined) {
    if (!object(search)) throw new Error("Config search must be an object.");
    for (const key of Object.keys(search)) {
      if (!Object.hasOwn(DEFAULT_SEARCH_SETTINGS, key)) throw new Error(`Unknown search setting: ${key}.`);
    }
    if (search.provider !== undefined && search.provider !== "duckduckgo") throw new Error('Config search.provider must be "duckduckgo".');
    for (const [key, maximum] of [["result_limit", 10], ["timeout_ms", 60000]] as const) {
      const setting = search[key];
      if (setting !== undefined && (typeof setting !== "number" || !Number.isInteger(setting) || setting < 1 || setting > maximum)) {
        throw new Error(`Config search.${key} must be an integer from 1 to ${maximum}.`);
      }
    }
    searchSettings = { ...DEFAULT_SEARCH_SETTINGS, ...search } as SearchSettings;
  }
  return { ...(memorySettings ? { memory: memorySettings } : {}), ...(context === undefined ? {} : { context: { compact_at_characters: (context as { compact_at_characters?: number }).compact_at_characters ?? DEFAULT_COMPACT_AT } }), ...(agent === undefined ? {} : { agent: { max_decisions: (agent as { max_decisions?: number }).max_decisions ?? DEFAULT_MAX_DECISIONS } }), ...(searchSettings ? { search: searchSettings } : {}), ...(onboarding === undefined ? {} : { onboarding: { first_run: (onboarding as Record<string, unknown>).first_run as boolean } }), tools: { ...tools } as ToolSettings, provider: {
    ...(typeof provider.model === "string" ? { model: provider.model.trim() } : {}),
  }, ...(webReadSettings ? { web_read: webReadSettings } : {}) };
}
export async function loadConfig(file: string): Promise<Config> {
  let content: string;
  try { content = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Preserve existing installations' settings if only the older JSON exists.
      if (extname(file) === ".toml") return loadConfig(file.slice(0, -5) + ".json");
      return { tools: {}, provider: {} };
    }
    throw error;
  }
  try {
    const text = content.replace(/^\uFEFF/, "");
    return parseConfig(extname(file) === ".toml" ? parseToml(text) : JSON.parse(text));
  }
  catch (error) {
    throw new Error(`Invalid configuration in ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
