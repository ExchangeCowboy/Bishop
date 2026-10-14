import type { Entry, Event, Provider } from "./types.ts";
import { ONBOARDING_SKILL, Tools } from "../tools/index.ts";
import { DEFAULT_MAX_DECISIONS } from "./config.ts";
import { WorkingContext } from "./context.ts";
import { meteredProvider, type RunUsage } from "./usage.ts";


export class Agent {
  provider: Provider;
  tools: Tools;
  history: Entry[];
  onEvent: (event: Event) => void;
  maxSteps: number;
  personality: string;
  exhaustedGuidance: string;
  refreshPersonality?: () => Promise<string>;
  context: WorkingContext;
  runs: RunUsage[] = [];
  constructor(options: { provider: Provider; tools: Tools; personality: string; refreshPersonality?: () => Promise<string>; history?: Entry[]; onEvent?: (event: Event) => void; maxSteps?: number; compactAt?: number; promptOverhead?: number; runtimeGuidance?: { compacted: string; exhausted: string } }) {
    this.provider = options.provider; this.tools = options.tools;
    this.history = options.history ?? []; this.onEvent = options.onEvent ?? (() => {});
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_DECISIONS;
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1) throw new Error("maxSteps must be a positive safe integer.");
    this.personality = options.personality;
    this.refreshPersonality = options.refreshPersonality;
    this.context = new WorkingContext(options.compactAt, options.promptOverhead, options.runtimeGuidance?.compacted);
    this.exhaustedGuidance = options.runtimeGuidance?.exhausted ?? "";
  }
  resetConversation(history: Entry[] = []): void {
    this.history = history;
    this.runs = [];
    this.context.reset();
    this.tools.beginTurn();
  }
  private pinnedContext(): Entry[] {
    const pinned: Entry[] = [];
    const user = this.history.findLast(entry => entry.role === "user");
    if (user) pinned.push(user);
    const remaining = new Map(this.tools.loaded);
    for (let i = this.history.length - 1; i >= 0 && remaining.size; i--) {
      const entry = this.history[i];
      if (entry.role !== "tool") continue;
      try {
        const result = JSON.parse(entry.content);
        if (result.name === "load_skill" && result.ok && remaining.get(result.data?.name) === result.data?.hash) {
          pinned.push(entry); remaining.delete(result.data.name);
        }
      } catch { /* Non-JSON historical evidence is summarized as text. */ }
    }
    return pinned;
  }
  async run(message: string): Promise<string> {
    return this.measureRun(async provider => {
      this.tools.beginTurn();
      this.history.push({ role: "user", content: message });
      if (this.tools.enabled("memory_indexer")) {
        const questions = await this.tools.memories.questions();
        if (questions.length) this.history.push({ role: "tool", content: JSON.stringify({ name: "memory_indexer", ok: true, data: { questions } }) });
      }
      if (this.tools.onboardingPending) await this.deliverSkill(ONBOARDING_SKILL);
      return this.decide(provider);
    });
  }
  async startOnboarding(): Promise<string | undefined> {
    if (!this.tools.onboardingPending) return undefined;
    return this.measureRun(async provider => {
      this.tools.beginTurn();
      await this.deliverSkill(ONBOARDING_SKILL);
      return this.decide(provider);
    });
  }
  private async measureRun(work: (provider: Provider) => Promise<string>): Promise<string> {
    const started = performance.now();
    const run: RunUsage = { startedAt: new Date().toISOString(), elapsedMs: 0, failed: true, calls: [] };
    this.runs.push(run);
    try {
      const reply = await work(meteredProvider(this.provider, run));
      run.failed = false;
      return reply;
    } finally { run.elapsedMs = performance.now() - started; }
  }
  private async deliverSkill(name: string): Promise<void> {
    this.history.push({ role: "assistant", content: JSON.stringify({ kind: "tool", tool: "load_skill", arguments: { name } }) });
    this.onEvent({ type: "tool_requested", name: "load_skill", skillName: name });
    const result = await this.tools.execute("load_skill", { name });
    this.history.push({ role: "tool", content: JSON.stringify({ name: "load_skill", ...result }) });
    this.onEvent({ type: "tool_result", name: "load_skill", skillName: name, result });
    if (!result.ok) throw new Error(result.error);
  }
  private async decide(provider: Provider): Promise<string> {
    for (let step = 0; step <= this.maxSteps; step++) {
      const exhausted = step === this.maxSteps;
      if (this.refreshPersonality) this.personality = await this.refreshPersonality();
      const catalog = await this.tools.skills.catalog();
      const shell = process.platform === "win32" ? "Windows PowerShell" : "/bin/sh";
      const instructions = `${this.personality}\nHost OS: ${process.platform}\nCommand shell: ${shell}\nNode executable: ${process.execPath}\nNode version: ${process.version}\nWorking directory: ${this.tools.cwd}\nTurn decision budget: ${this.maxSteps}\nTurn decision budget exhausted: ${exhausted}\nAvailable skills (names and descriptions only):\n${JSON.stringify(catalog)}` + (exhausted && this.exhaustedGuidance ? `\n\n${this.exhaustedGuidance}` : "");
      const specs = exhausted ? [] : this.tools.specs();
      const history = await this.context.prepare(provider, { instructions, history: this.history, tools: specs }, this.pinnedContext(),
        (phase, before, after, detail) => this.onEvent({ type: "context_compaction", phase, before, after, detail }));
      const action = await provider.next({ instructions, history, tools: specs });
      if (action.kind === "reply") {
        if (this.tools.enabled("memory_indexer")) {
          const unanswered = (await this.tools.memories.questions()).filter(question => !this.tools.deferredMemoryQuestions.has(question.id));
          if (unanswered.length) {
            this.history.push({ role: "tool", content: JSON.stringify({ name: "memory_clarification_guard", ok: false,
              error: "Resolve pending memory clarifications through memory_indexer correct, or explicitly defer their question_ids. No reply was delivered and no correction was saved.", questions: unanswered }) });
            if (exhausted) throw new Error("Memory clarification remains unresolved; no unverified acknowledgment was delivered. Existing memories are unchanged.");
            continue;
          }
        }
        this.history.push({ role: "assistant", content: action.message });
        return action.message;
      }
      if (exhausted) break;
      this.history.push({ role: "assistant", content: JSON.stringify(action) });
      this.tools.memories.activeHistory = this.history;
      const skillName = action.tool === "load_skill" && typeof action.arguments.name === "string"
        ? action.arguments.name : undefined;
      const goal = action.tool === "run_command" && typeof action.arguments.goal === "string"
        ? action.arguments.goal : undefined;
      this.onEvent({ type: "tool_requested", name: action.tool, skillName, goal });
      const result = await this.tools.execute(action.tool, action.arguments);
      this.history.push({ role: "tool", content: JSON.stringify({ name: action.tool, ...result }) });
      this.onEvent({ type: "tool_result", name: action.tool, skillName, goal, result });
    }
    const stopped = "Stopped at the turn decision limit: the final response requested a tool instead of a reply. No further tool was executed. Some actions may have completed; inspect tool results before retrying.";
    this.history.push({ role: "assistant", content: stopped });
    throw new Error(stopped);
  }
}
