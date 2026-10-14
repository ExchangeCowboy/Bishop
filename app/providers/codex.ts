import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, Provider, ProviderInput } from "../types.ts";
import { runProcess } from "../process.ts";
import { findCodex } from "./codex-path.ts";
import { requireChatGPTLogin } from "./codex-login.ts";
export { requireChatGPTLogin } from "./codex-login.ts";
import { renderHarness } from "../harness.ts";
import { codexUsage } from "../usage.ts";
import type { ProcessResult } from "../process.ts";
import { MEMORY_BATCH_SCHEMA, MEMORY_EXTRACTION_SCHEMA } from "../memory-review.ts";

/** Codex exec reports structured service errors on stdout, sometimes with empty stderr. */
export function codexFailure(result: ProcessResult): string {
  const messages: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (!event || !["error", "turn.failed"].includes(event.type)) continue;
      const message = typeof event.error === "string" ? event.error : event.error?.message ?? event.message;
      if (typeof message === "string" && message.trim()) messages.push(message.trim());
    } catch { /* A truncated final event must not hide an earlier valid error. */ }
  }
  if (result.stderr.trim()) messages.push(result.stderr.trim());
  let detail = [...new Set(messages)].slice(-3).join("\n")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/((?:access_token|refresh_token|id_token|api_key)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  if (detail.length > 2400) detail = detail.slice(0, 2400) + "\n[diagnostic truncated]";
  if (!detail) detail = "Codex returned no error details. The cause is unknown.";
  const rateLimited = /\b429\b|too many requests|rate.?limit/i.test(detail);
  return `Codex model request failed (exit ${result.exitCode}).\n${detail}` +
    (rateLimited ? "\nThe service reported a rate limit. Wait before retrying; /memory resumes committed indexing progress." : "") +
    "\nNo Bishop tool was executed for this failed model request; earlier tool actions may have completed.";
}

export const ACTION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["reply", "tool"] },
    message: { type: "string" }, tool: { type: "string" }, arguments: { type: "string" },
  }, required: ["kind", "message", "tool", "arguments"],
};
export function parseAction(text: string): Action {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider response.");
  const action = value as Record<string, unknown>;
  if (action.kind === "reply" && typeof action.message === "string" && action.message.trim()) {
    return { kind: "reply", message: action.message };
  }
  if (action.kind === "tool" && typeof action.tool === "string" && typeof action.arguments === "string") {
    const args: unknown = JSON.parse(action.arguments);
    if (args && typeof args === "object" && !Array.isArray(args)) return { kind: "tool", tool: action.tool, arguments: args as Record<string, unknown> };
  }
  throw new Error("Provider returned an invalid action; nothing was executed.");
}

/** Subscription adapter: the official Codex runtime handles ChatGPT authentication. */
export class CodexProvider implements Provider {
  executable: string;
  model?: string;
  harness: string;
  compactionHarness?: string;
  memoryHarness?: string;
  authenticated = false;
  constructor(options: { harness: string; compactionHarness?: string; memoryHarness?: string; executable?: string; model?: string }) {
    this.executable = options.executable ?? findCodex();
    this.model = options.model;
    this.harness = options.harness;
    this.compactionHarness = options.compactionHarness;
    this.memoryHarness = options.memoryHarness;
  }
  async ready(): Promise<void> {
    if (this.authenticated) return;
    await requireChatGPTLogin(this.executable);
    this.authenticated = true;
  }
  async next(input: ProviderInput): Promise<Action> {
    const memory = input.mode === "memory" || input.mode === "memory_batch";
    const harness = memory ? this.memoryHarness : input.mode === "compaction" ? this.compactionHarness : this.harness;
    if (!harness) throw new Error(`${memory ? "Memory extraction" : "Compaction"} harness is unavailable; no model request or tool execution occurred.`);
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    await this.ready();
    const directory = await mkdtemp(join(tmpdir(), "bishop-model-"));
    try {
      const schema = join(directory, "action.schema.json"), output = join(directory, "action.json");
      await writeFile(schema, JSON.stringify(input.mode === "memory_batch" ? MEMORY_BATCH_SCHEMA : memory ? MEMORY_EXTRACTION_SCHEMA : ACTION_SCHEMA), "utf8");
      const prompt = renderHarness(harness, input);
      const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config",
        "--sandbox", "read-only", "--disable", "shell_tool", "--disable", "hooks", "--disable", "plugins",
        "-c", 'web_search="disabled"', "--output-schema", schema, "--output-last-message", output,
        ...(this.model ? ["--model", this.model] : []), "-"];
      const result = await runProcess(this.executable, args, {
        cwd: directory, input: prompt, timeoutMs: 120_000, outputLimit: memory ? 192_000 : 64_000, env,
      });
      if (result.timedOut) throw new Error("Codex model request timed out; no Bishop tool was executed for this request.");
      if (result.exitCode !== 0) throw new Error(codexFailure(result));
      const events = result.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
      const completed = events.findLast(event => event.type === "turn.completed");
      if (completed) input.onUsage?.(codexUsage(completed.usage));
      if (!events.some(event => event.type === "turn.completed") || events.some(event => event.type === "turn.failed")) {
        throw new Error(codexFailure(result));
      }
      const response = await readFile(output, "utf8");
      return memory ? { kind: "reply", message: response } : parseAction(response);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
