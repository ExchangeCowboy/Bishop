import type { Arguments, ToolResult, ToolSpec } from "../app/types.ts";
import { Skills } from "../app/skills.ts";
import { runCommand } from "./run-command.ts";
import { CONFIG_FILENAME, TOOL_NAMES, type ToolName, type ToolSettings, type SearchSettings } from "../app/config.ts";
import { webSearch, type SearchFetch } from "./web-search.ts";
import { dirname, join } from "node:path";
import { updateSoul } from "./update-soul.ts";
import { updateMemory } from "./update-memory.ts";
import { completeOnboarding } from "./complete-onboarding.ts";
import { applyPatch } from "./apply-patch.ts";
import { webRead } from "./web-read.ts";
import { searchHistory } from "./search-history.ts";
import type { WebReadSettings } from "../app/config.ts";
import { MemoryStore } from "../app/memory-store.ts";
import type { MemorySettings } from "../app/config.ts";

export const ONBOARDING_SKILL = "personal-onboarding";

const schema = (properties: Record<string, unknown>) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const string = { type: "string" };
function fields(args: Arguments, names: string[]): void {
  if (Object.keys(args).some(key => !names.includes(key)) || names.some(key => typeof args[key] !== "string" || !(args[key] as string).trim())) {
    throw new Error(`Expected nonempty string arguments: ${names.join(", ")}.`);
  }
}

export class Tools {
  skills: Skills;
  cwd: string;
  settings: ToolSettings;
  requiredCommandSkill?: string;
  loaded = new Map<string, string>();
  deferredMemoryQuestions = new Set<number>();
  soulFile: string;
  memoryFile: string;
  onboardingPending: boolean;
  search?: SearchSettings;
  searchFetch?: SearchFetch;
  webReadSettings?: WebReadSettings;
  webReadFetch?: typeof fetch;
  memories: MemoryStore;
  constructor(options: { skills: Skills; cwd: string; settings?: ToolSettings; requiredCommandSkill?: string; firstRun?: boolean; memory?: MemorySettings; search?: SearchSettings; searchFetch?: SearchFetch; webRead?: WebReadSettings; webReadFetch?: typeof fetch }) {
    this.skills = options.skills; this.cwd = options.cwd;
    this.settings = { ...options.settings };
    this.requiredCommandSkill = options.requiredCommandSkill;
    this.soulFile = join(dirname(this.skills.root), "config", "personality", "soul.md");
    this.memoryFile = join(dirname(this.skills.root), "config", "personality", "memory.md");
    this.onboardingPending = options.firstRun ?? false;
    this.search = options.search;
    this.searchFetch = options.searchFetch;
    this.webReadSettings = options.webRead;
    this.webReadFetch = options.webReadFetch;
    this.memories = new MemoryStore(dirname(this.skills.root), options.memory?.excluded_session_prefixes);
  }
  beginTurn(): void { this.loaded.clear(); this.deferredMemoryQuestions.clear(); }
  enabled(name: ToolName): boolean { return this.settings[name] !== false; }
  specs(): ToolSpec[] {
    const tools: ToolSpec[] = [
      { name: "search_memories", description: "Search current SQLite memories first. For past names/preferences use include_historical=true: includes historical and superseded records with status, never as current preferences.", parameters: { ...schema({ query: string, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 10 }, include_historical: { type: "boolean" } }), required: ["query"] } },
      { name: "memory_indexer", description: "SQLite memory: pending/read/commit index originals; current gives active-chat indices; remember saves facts. questions lists clarifications. correct atomically saves one latest-user-quoted memory, retires supersede_ids and resolves question_ids. defer(question_ids) keeps questions open and saves nothing; historical(id) archives an experimental record. supersede/forget retire records.", parameters: { type: "object", properties: { action: { type: "string", enum: ["pending", "current", "read", "commit", "remember", "correct", "questions", "defer", "historical", "supersede", "forget"] }, session: string, source_hash: string, offset: { type: "integer", minimum: 0 }, id: { type: "integer", minimum: 1 }, replacement_id: { type: "integer", minimum: 1 }, supersede_ids: { type: "array", maxItems: 20, items: { type: "integer", minimum: 1 } }, question_ids: { type: "array", maxItems: 20, items: { type: "integer", minimum: 1 } }, memories: { type: "array", maxItems: 20, items: schema({ information: string, context: string, keywords: string, event_date: string, entry_index: { type: "integer", minimum: 0 }, quote: string, historical: { type: "boolean" } }) }, questions: { type: "array", maxItems: 3, items: schema({ question: string, conflicting_ids: { type: "array", maxItems: 20, items: { type: "integer", minimum: 1 } } }) } }, required: ["action"], additionalProperties: false } },
      { name: "apply_patch", description: "Patch text within cwd using unique exact context. Returns changed paths; on write failure check data.files before retrying. Dedicated soul/memory/skill tools own their targets. Optional full guide: load_skill(apply-patch-use).", parameters: schema({ patch: { type: "string", minLength: 1, maxLength: 100000, description: "Begin/End with *** Begin Patch / *** End Patch. Operations: *** Add File: path (+ lines), *** Delete File: path, *** Update File: path (bare @@ hunks; space context, - remove, + add). Each marker is on its own line." } }) },
      { name: "web_search", description: "Search DuckDuckGo for titles, URLs, and snippets; snippets are not full pages. Optional guide: web-research.", parameters: schema({ query: { type: "string", minLength: 1, maxLength: 500 } }) },
      { name: "web_read", description: "Fetch public HTML/plain text, title, final URL, and bounded links. No scripts/login; next_offset continues via a fresh fetch. Optional guide: web-research.", parameters: { ...schema({ url: { type: "string", minLength: 1, maxLength: 4096 }, offset: { type: "integer", minimum: 0, description: "Optional UTF-16 text offset; starts at 0." } }), required: ["url"] } },
      { name: "load_skill", description: "Read the full instructions for a named skill from the catalog.", parameters: schema({ name: string }) },
      { name: "save_skill", description: "Create or revise a reusable procedure after a demonstrated successful workflow or explicit user instruction. Does not train the model or change tool permissions.", parameters: schema({ name: string, description: string, body: string }) },
      { name: "update_soul", description: "Replace soul.md with a concise personality refinement, under 2,000 characters. First load bishop-core-profiler in this turn.", parameters: schema({ content: string }) },
      { name: "update_memory", description: "Remember/correct/forget grounded durable facts in memory.md. Replace complete Markdown under 4,000 characters; preserve unrelated facts, exclude secrets/transcripts, # Memory clears it. Optional guide: memory-use.", parameters: schema({ content: string }) },
      { name: "search_history", description: "Search unindexed/changed original chats by literal text. Excludes fully indexed unchanged logs and generated memory-review entries. For a source check supply session to inspect that original even if indexed. excluded_indexed_sessions reports intentional exclusions; next_offset pages matches. Search SQLite historical records first for past facts.", parameters: { ...schema({ query: { type: "string", minLength: 1, maxLength: 500 }, session: { type: "string", description: "Optional transcript name without extension; limits search to this session." }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 } }), required: ["query"] } },
      { name: "complete_onboarding", description: "Persist first_run = false after personal onboarding is complete. Requires the current personal-onboarding skill in this turn.", parameters: schema({}) },
      {
        name: "run_command", description: "Execute a host-shell command; return output and exit status. Optional guides: command-runner-use, reading-output (truncation)." +
          (this.requiredCommandSkill ? ` First load ${this.requiredCommandSkill} during this user turn; the current skill version is enforced.` : ""),
        parameters: { ...schema({ command: string, goal: { type: "string", description: "Include a brief plain-language purpose for display, e.g. get files in directory; omit syntax and sensitive data." } }), required: ["command"] },
      },
    ];
    return tools.filter(tool => this.enabled(tool.name as ToolName));
  }
  async execute(name: string, args: Arguments): Promise<ToolResult> {
    try {
      if (!TOOL_NAMES.includes(name as ToolName)) throw new Error(`Unknown tool: ${name}.`);
      if (!this.enabled(name as ToolName)) throw new Error(`Tool ${name} is disabled by configuration. Enable it in config/${CONFIG_FILENAME} and restart Bishop to use it.`);
      switch (name) {
        case "search_memories": return { ok: true, data: await this.memories.search(args) };
        case "memory_indexer": {
          const data = await this.memories.index(args);
          if (args.action === "defer" && data && "deferred_ids" in data && Array.isArray(data.deferred_ids)) for (const id of data.deferred_ids) this.deferredMemoryQuestions.add(id);
          return { ok: true, data };
        }
        case "search_history":
          return { ok: true, data: await searchHistory(join(dirname(this.skills.root), "memory", "history"), args, this.memories.excludedSessionPrefixes) };
        case "apply_patch": {
          fields(args, ["patch"]);
          return applyPatch(args.patch as string, this.cwd, [this.soulFile, this.memoryFile, this.skills.root, this.memories.file]);
        }
        case "update_memory": {
          fields(args, ["content"]);
          return { ok: true, data: await updateMemory(this.memoryFile, args.content as string) };
        }
        case "web_search": {
          fields(args, ["query"]);
          return webSearch(args.query as string, this.search, this.searchFetch);
        }
        case "web_read": {
          const { offset, ...rest } = args;
          fields(rest, ["url"]);
          if (Object.hasOwn(args, "offset") && (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)) throw new Error("web_read offset must be a nonnegative safe integer.");
          return webRead(args.url as string, this.webReadSettings, this.webReadFetch, offset as number | undefined);
        }
        case "complete_onboarding": {
          fields(args, []);
          if (!this.onboardingPending) throw new Error("Onboarding is not pending in this session.");
          const skill = await this.skills.load(ONBOARDING_SKILL);
          if (this.loaded.get(skill.name) !== skill.hash) throw new Error("Load the current personal-onboarding skill before completing onboarding in this turn.");
          const configRoot = join(dirname(this.skills.root), "config");
          const data = await completeOnboarding(join(configRoot, CONFIG_FILENAME));
          this.onboardingPending = false;
          return { ok: true, data };
        }
        case "update_soul": {
          fields(args, ["content"]);
          const profiler = await this.skills.load("bishop-core-profiler");
          if (this.loaded.get(profiler.name) !== profiler.hash) {
            throw new Error("Load the current bishop-core-profiler skill before editing soul.md in this turn.");
          }
          return { ok: true, data: await updateSoul(this.soulFile, args.content as string) };
        }
        case "load_skill": {
          fields(args, ["name"]);
          const skill = await this.skills.load(args.name as string);
          this.loaded.set(skill.name, skill.hash);
          return { ok: true, data: skill };
        }
        case "save_skill": {
          fields(args, ["name", "description", "body"]);
          const skill = await this.skills.save(args.name as string, args.description as string, args.body as string);
          this.loaded.delete(skill.name);
          return { ok: true, data: { name: skill.name, hash: skill.hash, saved: true } };
        }
        case "run_command": {
          fields(args, Object.hasOwn(args, "goal") ? ["command", "goal"] : ["command"]);
          if (this.requiredCommandSkill) {
            const current = await this.skills.load(this.requiredCommandSkill);
            if (this.loaded.get(current.name) !== current.hash) {
              throw new Error(`Load the current ${current.name} skill with load_skill before running commands in this turn.`);
            }
          }
          const command = args.command as string;
          return await runCommand(command, this.cwd);
        }
        default: throw new Error(`Unknown tool: ${name}.`);
      }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
