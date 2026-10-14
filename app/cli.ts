import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { Agent } from "./agent.ts";
import { Skills } from "./skills.ts";
import { Tools } from "../tools/index.ts";
import { Sessions } from "./session.ts";
import { CodexProvider } from "./providers/codex.ts";
import { DemoProvider } from "./providers/demo.ts";
import { CONFIG_FILENAME, DEFAULT_MEMORY_SETTINGS, loadConfig } from "./config.ts";
import { loadPersonality } from "./personality.ts";
import { ConsoleUI, interactiveTerminal } from "./console.ts";
import { loadGuidance, loadHarness } from "./harness.ts";
import { CONTEXT_LIMIT } from "./context.ts";
import { ConsoleInput } from "./console-input.ts";
import { acceptMemoryOffer, memoryStartupOffer } from "./memory-startup.ts";
import { reviewMemories, memoryReviewSummary } from "./memory-review.ts";
import { meteredProvider, type RunUsage } from "./usage.ts";
import { readFile } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  demo: { type: "boolean", default: false },
  "require-command-skill": { type: "boolean", default: false }, help: { type: "boolean", default: false },
  prompt: { type: "string" }, model: { type: "string" }, session: { type: "string" }, cwd: { type: "string" },
} });
if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== "chat")) {
  console.error(`Unknown command: ${positionals.join(" ")}. Use bishop chat or bishop --help.`);
  process.exitCode = 1;
} else if (values.help) {
  console.log(`Bishop Agent 0.1.0\n
bishop chat [--prompt "message"] [--session name] [--model model-id]
            [--cwd directory] [--require-command-skill]
bishop chat --demo

Available command: chat. Running bishop without a command also starts chat.

Prerequisite: installed Codex app or CLI, signed in with ChatGPT.
Bishop reuses that local login; no separate Bishop account is required.
Model: provider.model in config/bishop.toml; --model overrides it for one launch.
Tools are enabled by default. Disable individual tools in config/bishop.toml.
--require-command-skill enables the optional, version-checked prerequisite.
Every launch starts an empty conversation. --session labels a new transcript; it does not resume one.
Set BISHOP_CODEX_BIN to the Codex executable if it is not on PATH.`);
} else {
  try {
    const config = await loadConfig(join(root, "config", CONFIG_FILENAME));
    const personality = await loadPersonality(join(root, "config", "personality"));
    const harness = await loadHarness(join(root, "config", "harness.md"));
    const compactionHarness = await loadHarness(join(root, "config", "compaction.md"));
    const memoryHarness = await loadHarness(join(root, "config", "memory-extraction.md"));
    const runtimeGuidance = {
      compacted: await loadGuidance(join(root, "config", "runtime", "compacted.md")),
      exhausted: await loadGuidance(join(root, "config", "runtime", "decision-limit.md")),
    };
    const memoryIndexingGuidance = await loadGuidance(join(root, "config", "runtime", "memory-indexing.md"));
    const model = values.model ?? config.provider.model;
    const provider = values.demo ? new DemoProvider() : new CodexProvider({ model, harness, compactionHarness, memoryHarness });
    if (provider instanceof CodexProvider) await provider.ready();
    const interactive = !values.demo && !values.prompt && interactiveTerminal();
    const ui = new ConsoleUI(interactive);
    const skills = new Skills(join(root, "skills"), join(root, "skills", ".revisions"));
    const tools = new Tools({ skills, cwd: resolve(values.cwd ?? root), settings: config.tools,
      memory: config.memory,
      search: config.search,
      webRead: config.web_read,
      firstRun: !values.demo && config.onboarding?.first_run,
      requiredCommandSkill: values["require-command-skill"] ? "command-runner-use" : undefined });
    const sessions = new Sessions(join(root, "memory", "history"));
    const sessionLabel = values.session ?? (values.demo ? "demo" : "default");
    let { name: session, history } = await sessions.start(sessionLabel);
    tools.memories.activeSession = session;
    const agent = new Agent({
      provider,
      tools, history, personality, maxSteps: config.agent?.max_decisions,
      compactAt: config.context?.compact_at_characters,
      promptOverhead: Math.max(harness.length, compactionHarness.length),
      runtimeGuidance,
      refreshPersonality: () => loadPersonality(join(root, "config", "personality")),
      onEvent: event => ui.event(event),
    });
    if (!values.demo && !values.prompt) ui.enableDock(model ?? "Codex default", () => agent.runs);
    if (!values.demo && !values.prompt) ui.banner(model ?? "Codex default", tools.specs().map(tool => tool.name),
      { cwd: tools.cwd, contextLimit: CONTEXT_LIMIT, compactAt: agent.context.compactAt, sessionLabel });
    if (tools.onboardingPending) {
      ui.begin();
      try { ui.reply((await agent.startOnboarding())!, agent.runs.at(-1)); }
      catch (error) { ui.error(error); process.exitCode = 1; }
      finally { ui.stop(); await sessions.save(session, agent.history, agent.runs); }
    }
    async function turn(message: string): Promise<void> {
      ui.begin();
      try { ui.reply(await agent.run(message), agent.runs.at(-1)); }
      catch (error) { ui.error(error); process.exitCode = 1; }
      finally { ui.stop(); await sessions.save(session, agent.history, agent.runs); }
    }
    async function memoryReview(): Promise<void> {
      ui.begin();
      const started = performance.now();
      const run: RunUsage = { startedAt: new Date().toISOString(), elapsedMs: 0, failed: true, calls: [] };
      agent.runs.push(run);
      agent.history.push({ role: "user", content: "/memory", origin: "memory_review" });
      try {
        const referenceContext = { soul: await readFile(tools.soulFile, "utf8"), notebook: await readFile(tools.memoryFile, "utf8") };
        const memorySettings = config.memory ?? DEFAULT_MEMORY_SETTINGS;
        const report = await reviewMemories({ tools, provider: meteredProvider(agent.provider, run), maxSections: agent.maxSteps, guidance: memoryIndexingGuidance, referenceContext, batchSections: memorySettings.batch_sections,
          rateLimitRetries: memorySettings.rate_limit_retries, retryDelayMs: memorySettings.retry_delay_seconds * 1000,
          onRateLimit: (delay, retry, maximum) => {
            ui.notice(`Service rate limit: waiting ${(delay / 1000).toFixed(1)}s before retry ${retry}/${maximum}. Committed progress is saved.`);
            ui.waiting("Waiting for service rate limit");
          },
          onEvent: event => ui.event(event), onProgress: (source, number) => {
            ui.notice(`Extracting memory batch ${number}: ${source}`);
            ui.waiting("Extracting memories");
          } });
        const summary = memoryReviewSummary(report);
        agent.history.push({ role: "assistant", content: summary, origin: "memory_review" });
        run.failed = report.paused !== undefined;
        run.elapsedMs = performance.now() - started;
        ui.reply(summary, run);
      } catch (error) {
        ui.error(error); process.exitCode = 1;
        agent.history.push({ role: "assistant", content: "Memory review stopped on an error. Earlier committed progress is retained; /memory resumes the next uncommitted section.", origin: "memory_review" });
      } finally {
        run.elapsedMs = performance.now() - started;
        ui.stop(); await sessions.save(session, agent.history, agent.runs);
      }
    }
    if (process.exitCode) {
      // A failed startup must not silently bypass required onboarding.
    } else if (values.demo || values.prompt) {
      await turn(values.prompt ?? "Run the offline plumbing demo.");
    } else {
      let memoryOfferPending = false;
      if (tools.enabled("memory_indexer")) {
        try {
          const pending = await tools.memories.pending();
          const offer = memoryStartupOffer(pending.pending_count, pending.skipped_count);
          if (offer) ui.notice(offer);
          memoryOfferPending = pending.pending_count > 0;
        } catch (error) { ui.error(error); }
      }
      let terminal: ReturnType<typeof createInterface>;
      let redrawQueued = false;
      const editorOutput = new Writable({ write(chunk, _encoding, callback) {
        if (!ui.docked) stdout.write(chunk);
        else if (!redrawQueued) {
          redrawQueued = true;
          queueMicrotask(() => { redrawQueued = false; ui.updateInput(terminal.line, terminal.cursor); });
        }
        callback();
      } });
      Object.assign(editorOutput, { isTTY: true, columns: 10000 });
      const dockInput = ui.docked ? new ConsoleInput(direction => ui.scrollHistory(direction)) : undefined;
      if (dockInput) {
        Object.assign(dockInput, { isTTY: stdin.isTTY, setRawMode: (mode: boolean) => stdin.setRawMode(mode) });
        stdin.pipe(dockInput);
      }
      const editorInput = dockInput ?? stdin;
      terminal = createInterface({ input: editorInput, output: ui.docked ? editorOutput : stdout, terminal: ui.docked ? true : undefined });
      const onKey = (_text: string, key: { name?: string }) => {
        if (key?.name === "pageup") ui.pageHistory(1);
        if (key?.name === "pagedown") ui.pageHistory(-1);
      };
      if (ui.docked) editorInput.on("keypress", onKey);
      try {
        while (true) {
          let message: string;
          ui.readyForInput();
          try { message = (await terminal.question(ui.prompt())).trim(); } catch { break; }
          ui.acceptInput(message);
          if (message === "/exit") break;
          if (memoryOfferPending && !message.startsWith("/")) {
            memoryOfferPending = false;
            const answer = acceptMemoryOffer(message);
            if (answer === "decline") { ui.notice("Memory review deferred. Use /memory when ready."); continue; }
            if (answer === "accept") message = "/memory";
          }
          if (message === "/memory") {
            if (!tools.enabled("memory_indexer")) { ui.notice("memory_indexer is disabled in config/bishop.toml."); continue; }
            memoryOfferPending = false;
            terminal.pause();
            try { await memoryReview(); }
            catch (error) { ui.error(error); }
            finally { terminal.resume(); }
            continue;
          }
          if (message === "/help") { ui.help(); continue; }
          if (message === "/usage") { ui.usage(agent.runs); continue; }
          if (message === "/status") {
            ui.status(model ?? "Codex default", tools.specs().map(tool => tool.name), tools.cwd, CONTEXT_LIMIT, agent.context.compactAt);
            continue;
          }
          if (message === "/new") {
            try {
              await sessions.save(session, agent.history, agent.runs);
              const fresh = await sessions.start(sessionLabel);
              session = fresh.name;
              tools.memories.activeSession = session;
              agent.resetConversation(fresh.history);
              ui.newChat();
            } catch (error) { ui.error(error); }
            continue;
          }
          if (message) {
            terminal.pause();
            try { await turn(message); } finally { terminal.resume(); }
          }
        }
      } finally {
        editorInput.off("keypress", onKey); ui.goodbye(); terminal.close(); editorOutput.destroy();
        if (dockInput) { stdin.unpipe(dockInput); dockInput.destroy(); stdin.pause(); }
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
