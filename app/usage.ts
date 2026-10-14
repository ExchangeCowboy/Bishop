import type { Provider, TokenUsage } from "./types.ts";

export type CallUsage = TokenUsage & { mode: "decision" | "compaction" | "memory"; elapsedMs: number; failed: boolean };
export type RunUsage = { startedAt: string; elapsedMs: number; failed: boolean; calls: CallUsage[] };

export function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Codex input_tokens includes cached_input_tokens; never add them together. */
export function codexUsage(value: unknown): TokenUsage {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { input: tokenCount(usage.input_tokens), cachedInput: tokenCount(usage.cached_input_tokens), output: tokenCount(usage.output_tokens) };
}

export function meteredProvider(provider: Provider, run: RunUsage): Provider {
  return { async next(input) {
    const started = performance.now();
    const call: CallUsage = { mode: input.mode === "memory_batch" ? "memory" : input.mode ?? "decision", input: null, cachedInput: null, output: null, elapsedMs: 0, failed: true };
    run.calls.push(call);
    try {
      const action = await provider.next({ ...input, onUsage: usage => {
        call.input = tokenCount(usage.input);
        call.cachedInput = tokenCount(usage.cachedInput);
        call.output = tokenCount(usage.output);
        input.onUsage?.(usage);
      } });
      call.failed = false;
      return action;
    } finally { call.elapsedMs = performance.now() - started; }
  } };
}

export function usageSummary(runs: RunUsage[]): string {
  if (!runs.length) return "No runs yet.";
  const run = runs.at(-1)!;
  const lines = [`Latest run: ${(run.elapsedMs / 1000).toFixed(1)}s${run.failed ? " (failed)" : ""}`];
  for (const mode of ["decision", "compaction", "memory"] as const) {
    const calls = run.calls.filter(call => call.mode === mode);
    const total = (key: keyof TokenUsage): string => {
      if (!calls.length) return "n/a";
      if (calls.some(call => call[key] === null)) return "unknown";
      const sum = calls.reduce((sum, call) => sum + call[key]!, 0);
      return Number.isSafeInteger(sum) ? String(sum) : "unknown";
    };
    lines.push(`${mode === "decision" ? "Decisions" : mode === "memory" ? "Memory extraction" : "Compaction"}: ${calls.length} calls, ${(calls.reduce((sum, call) => sum + call.elapsedMs, 0) / 1000).toFixed(1)}s; input ${total("input")}, cached ${total("cachedInput")}, output ${total("output")}`);
  }
  lines.push("Codex cached tokens are included in input totals.");
  return lines.join("\n");
}
