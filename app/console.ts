import { clearLine, cursorTo, moveCursor } from "node:readline";
import { stdin, stdout, stderr } from "node:process";
import type { Event } from "./types.ts";
import { usageSummary, type RunUsage } from "./usage.ts";
import { activityBlock, displayWidth, wrapLines } from "./terminal-layout.ts";
import { ConsoleDock, sessionStatus } from "./console-dock.ts";

const codes = { cyan: "1;96", border: "1;96", green: "1;32", amber: "33", red: "1;31", dim: "90", bold: "1", plain: "0" };
// Keep external output from injecting terminal commands; preserve ordinary text.
function clean(text: string): string {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export class ConsoleUI {
  interactive: boolean;
  color: boolean;
  timer?: ReturnType<typeof setInterval>;
  started = 0;
  frame = 0;
  toolsRun = 0;
  toolStarted = 0;
  liveRows = 0;
  columns: () => number;
  dock?: ConsoleDock;
  resizeHandler?: () => void;
  exitHandler?: () => void;
  constructor(interactive: boolean, columns: () => number = () => stdout.columns ?? 80) {
    this.interactive = interactive;
    this.columns = () => Math.max(1, Math.floor(columns()));
    this.color = !!stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
  }
  paint(text: string, style: keyof typeof codes): string {
    return this.color && style !== "plain" ? `\x1b[${codes[style]}m${text}\x1b[0m` : text;
  }
  private animated(): boolean { return this.interactive && !!stdout.isTTY && process.env.TERM !== "dumb"; }
  get docked(): boolean { return this.dock?.active ?? false; }
  enableDock(model: string, runs: () => RunUsage[]): void {
    if (!this.animated() || (stdout.rows ?? 24) < 8 || this.columns() < 30) return;
    this.dock = new ConsoleDock(text => stdout.write(text), () => ({ columns: this.columns(), rows: stdout.rows ?? 24 }),
      width => sessionStatus(clean(model), runs(), width), () => this.color);
    this.resizeHandler = () => this.dock?.resize();
    this.exitHandler = () => this.dock?.close();
    stdout.on("resize", this.resizeHandler); process.once("exit", this.exitHandler);
  }
  updateInput(text: string, cursor: number): void { this.dock?.setInput(text, cursor); }
  readyForInput(): void { this.stop(); this.dock?.setBusy(false); }
  acceptInput(text: string): void {
    if (!this.docked) return;
    this.dock!.setInput("", 0); this.dock!.setBusy(true);
    this.lines(`YOU › ${text}`, "cyan");
  }
  pageHistory(direction: -1 | 1): void { this.dock?.page(direction); }
  scrollHistory(direction: -1 | 1): void { this.dock?.scroll(direction * 3); }
  private output(text: string, error = false): void {
    if (this.docked) this.dock!.print(text);
    else (error ? stderr : stdout).write(text);
  }
  private clearActivity(): void {
    if (this.docked) { this.dock!.showActivity([]); this.liveRows = 0; return; }
    if (!this.liveRows) return;
    cursorTo(stdout, 0);
    if (this.liveRows > 1) moveCursor(stdout, 0, -(this.liveRows - 1));
    for (let i = 0; i < this.liveRows; i++) {
      clearLine(stdout, 0);
      if (i < this.liveRows - 1) moveCursor(stdout, 0, 1);
    }
    if (this.liveRows > 1) moveCursor(stdout, 0, -(this.liveRows - 1));
    this.liveRows = 0;
  }
  private lines(text: string, style: keyof typeof codes = "dim", indent = "  "): void {
    for (const line of wrapLines(clean(text), this.columns() - displayWidth(indent) - 1)) this.output(indent + this.paint(line, style) + "\n");
  }
  private panel(title: string, rows: string[]): void {
    this.stop();
    this.output("\n");
    if (this.columns() < 24) {
      this.lines(title, "cyan", "");
      for (const row of rows) this.lines(row, "dim", "");
    } else {
      const width = Math.min(94, this.columns() - 8);
      this.output(`  ${this.paint("╭" + "─".repeat(width + 2) + "╮", "border")}\n`);
      for (const [index, row] of [title, "", ...rows].entries()) {
        for (const line of wrapLines(clean(row), width)) {
          const padded = line + " ".repeat(Math.max(0, width - displayWidth(line)));
          const field = /^([A-Za-z][A-Za-z ()]*?)(: | {2,})(.*)$/.exec(padded);
          const rendered = index === 0 ? this.paint(padded, "cyan") : field
            ? this.paint(field[1] + field[2], "dim") + this.paint(field[3], "plain")
            : this.paint(padded, "dim");
          this.output(`  ${this.paint("│", "border")} ${rendered} ${this.paint("│", "border")}\n`);
        }
      }
      this.output(`  ${this.paint("╰" + "─".repeat(width + 2) + "╯", "border")}\n`);
    }
    this.output("\n");
  }
  banner(model: string, tools: string[], runtime?: { cwd: string; contextLimit: number; compactAt: number; sessionLabel: string }): void {
    this.panel("♗ B I S H O P   A G E N T   P L A T F O R M", [
      "ChatGPT subscription · Codex connection", "",
      `Model      ${model}`,
      ...(runtime ? [`Workspace  ${runtime.cwd}`, `Session    ${runtime.sessionLabel} · fresh conversation`,
        `Context    ${runtime.contextLimit.toLocaleString("en-US")} characters · compact at ${runtime.compactAt.toLocaleString("en-US")}`] : ["Chat       fresh conversation"]),
      "", `Tools (${tools.length})  ${tools.length ? tools.join(", ") : "none enabled"}`,
    ]);
    this.lines("/help for commands", "cyan");
    this.output("\n");
  }
  help(): void {
    this.lines("/memory  review pending chat logs for memory", "cyan");
    if (!this.interactive) { stdout.write("  /help  commands     /status  runtime settings     /usage  latest run     /new  new chat     /exit  quit\n\n"); return; }
    this.lines("/help  commands   /status  runtime settings   /usage  latest run", "dim");
    this.lines("/new   fresh chat   /exit    quit", "dim");
    if (this.docked) this.lines("Mouse wheel / PgUp / PgDn  browse conversation · Shift + drag selects text", "dim");
    this.output("\n");
  }
  usage(runs: RunUsage[]): void {
    this.stop();
    if (this.interactive) { this.panel("USAGE · LATEST RUN", usageSummary(runs).split("\n")); return; }
    stdout.write(`\n${usageSummary(runs).split("\n").map(line => "  " + line).join("\n")}\n\n`);
  }
  status(model: string, tools: string[], cwd: string, contextLimit: number, compactAt: number): void {
    this.stop();
    if (this.interactive) { this.panel("RUNTIME STATUS", [
      `Model: ${model}`, `Working directory: ${cwd}`, "",
      `Context guard: ${contextLimit.toLocaleString("en-US")} characters (UTF-16 units)`,
      `Compaction threshold: ${compactAt.toLocaleString("en-US")} characters (UTF-16 units)`, "",
      `Enabled tools (${tools.length}): ${tools.length ? tools.join(", ") : "none enabled"}`,
    ]); return; }
    stdout.write(clean(`\n  Model: ${model}\n  Enabled tools: ${tools.length ? tools.join(", ") : "none enabled"}\n  Working directory: ${cwd}\n  Context guard: ${contextLimit} characters (UTF-16 units)\n  Compaction threshold: ${compactAt} characters (UTF-16 units)\n\n`));
  }
  newChat(): void {
    this.stop();
    this.output(this.paint("\n  New chat started.\n\n", "dim"));
  }
  prompt(): string { return `  ${this.paint("YOU", "cyan")} ${this.paint("›", "cyan")} `; }
  begin(): void { this.started = Date.now(); this.toolsRun = 0; this.toolStarted = 0; this.dock?.setBusy(true); this.waiting("Thinking"); }
  waiting(label: string): void {
    this.stop();
    if (!this.animated()) return;
    const draw = () => {
      const elapsed = ((Date.now() - this.started) / 1000).toFixed(1);
      this.clearActivity();
      const lines = activityBlock(clean(label).replace(/\s+/g, " "), elapsed, this.frame++, this.toolsRun, this.columns());
      const painted = lines.map((line, i) => this.paint(line, i === 0 ? "cyan" : "dim"));
      if (this.docked) this.dock!.showActivity(painted);
      else stdout.write(painted.join("\n"));
      this.liveRows = lines.length;
    };
    draw();
    this.timer = setInterval(draw, 120);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer); this.timer = undefined;
    }
    this.clearActivity();
  }
  event(event: Event): void {
    this.stop();
    if (event.type === "context_compaction") {
      const detail = event.phase === "started" ? "Compacting context" : event.phase === "retrying"
        ? `Retrying context summary: ${clean(event.detail ?? "invalid summary")}`
        : `Context compacted: ${event.before} → ${event.after} characters`;
      if (!this.interactive) stderr.write(`[context] ${detail}\n`);
      else this.lines(detail, "amber");
      this.waiting(event.phase === "completed" ? "Thinking" : "Compacting context");
      return;
    }
    const goal = event.name === "run_command" && event.goal
      ? clean(event.goal).replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const label = clean(event.name) + (event.skillName ? ` (${clean(event.skillName)})` : "")
      + (goal ? ` : ${goal}` : "");
    if (!this.interactive) {
      stderr.write(event.type === "tool_requested"
        ? `[tool] ${label}\n`
        : `[result] ${label}: ${event.result?.ok ? "ok" : "failed"}\n`);
      return;
    }
    if (event.type === "tool_requested") {
      this.toolsRun++; this.toolStarted = Date.now();
      if (!this.animated()) this.lines(`↳ ${String(this.toolsRun).padStart(2, "0")}  ${label}`, "cyan");
      this.waiting(`Running #${String(this.toolsRun).padStart(2, "0")} ${label}`);
    } else {
      const result = event.result;
      const data = result?.data as { exitCode?: number | null; stderr?: string; files?: { path: string; operation: string }[] } | undefined;
      const detail = data?.exitCode !== undefined ? ` · exit ${data.exitCode ?? "unknown"}` : "";
      const duration = this.toolStarted ? ` · ${((Date.now() - this.toolStarted) / 1000).toFixed(1)}s` : "";
      this.lines(`${result?.ok ? "✓" : "×"} ${String(this.toolsRun).padStart(2, "0")}  ${label}${detail}${duration}`, result?.ok ? "green" : "red");
      this.toolStarted = 0;
      if (result?.error) this.lines(result.error, "amber", "      ");
      else if (!result?.ok && data?.stderr) this.lines(data.stderr.trim().split(/\r?\n/).slice(0, 3).join("\n").slice(0, 600), "amber", "      ");
      if (event.name === "apply_patch" && Array.isArray(data?.files)) {
        for (const file of data.files.slice(0, 4)) this.lines(`${file.operation}  ${file.path}`, "dim", "      ");
        if (data.files.length > 4) this.lines(`+ ${data.files.length - 4} more files`, "dim", "      ");
      }
      this.waiting("Thinking");
    }
  }
  notice(text: string): void {
    this.stop();
    this.lines(text, "cyan");
    this.output("\n");
  }
  reply(text: string, run?: RunUsage): void {
    this.stop();
    if (!this.interactive) { stdout.write(clean(text) + "\n"); return; }
    const elapsed = ((Date.now() - this.started) / 1000).toFixed(1);
    this.output("\n");
    this.lines("─".repeat(Math.max(1, Math.min(94, this.columns() - 5))), "border");
    this.lines(`♗ BISHOP  /  ${elapsed}s  /  ${this.toolsRun} tool${this.toolsRun === 1 ? "" : "s"}`, "cyan");
    this.output("\n");
    this.lines(text, "plain");
    if (run) {
      const total = (key: "input" | "cachedInput" | "output") => {
        if (!run.calls.length || run.calls.some(call => call[key] === null)) return "unknown";
        const count = run.calls.reduce((sum, call) => sum + call[key]!, 0);
        return Number.isSafeInteger(count) ? count.toLocaleString("en-US") : "unknown";
      };
      this.output("\n");
      this.lines(`${run.calls.length} model call${run.calls.length === 1 ? "" : "s"} · input ${total("input")} · cached ${total("cachedInput")} · output ${total("output")}`, "dim");
    }
    this.output("\n");
  }
  error(error: unknown): void {
    this.stop();
    const message = clean(error instanceof Error ? error.message : String(error));
    if (!this.interactive) { stderr.write(message + "\n"); return; }
    this.output("\n", true);
    for (const line of wrapLines(`ERROR  ${message}`, this.columns() - 3)) this.output("  " + this.paint(line, "red") + "\n", true);
    this.output("\n", true);
  }
  goodbye(): void {
    this.stop(); this.dock?.close();
    if (this.resizeHandler) stdout.off("resize", this.resizeHandler);
    if (this.exitHandler) process.off("exit", this.exitHandler);
    this.output(this.paint("\n  Session closed.\n", "dim"));
  }
}

export function interactiveTerminal(): boolean { return !!stdin.isTTY && !!stdout.isTTY; }
