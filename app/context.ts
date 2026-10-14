import type { Entry, Provider, ProviderInput } from "./types.ts";

export const CONTEXT_LIMIT = 500_000;
export const DEFAULT_COMPACT_AT = 400_000;
export const MAX_COMPACT_AT = 450_000;
const RECENT_CHARACTERS = 24_000;
const BATCH_CHARACTERS = 48_000;
const SUMMARY_CHARACTERS = 8_000;

export function contextSize(input: ProviderInput, overhead = 0): number {
  return input.instructions.length + JSON.stringify(input.history).length + JSON.stringify(input.tools).length + overhead;
}

/** A disposable model view; the original transcript remains untouched. */
export class WorkingContext {
  through = 0;
  summary = "";
  compactAt: number;
  overhead: number;
  summaryGuidance: string;
  constructor(compactAt = DEFAULT_COMPACT_AT, overhead = 0, summaryGuidance = "") {
    if (!Number.isSafeInteger(compactAt) || compactAt < 16_000 || compactAt > MAX_COMPACT_AT) {
      throw new Error(`Compaction threshold must be an integer from 16000 to ${MAX_COMPACT_AT}.`);
    }
    this.compactAt = compactAt;
    this.overhead = overhead;
    this.summaryGuidance = summaryGuidance;
  }
  reset(): void { this.through = 0; this.summary = ""; }
  private view(history: Entry[], pinned: Entry[], through = this.through, summary = this.summary): Entry[] {
    const recent = history.slice(through);
    return [
      ...(summary ? [{ role: "assistant" as const, content: JSON.stringify({ context_summary: summary, summarized_entries: through,
        ...(this.summaryGuidance ? { guidance: this.summaryGuidance } : {}) }) }] : []),
      ...pinned.filter(entry => !recent.includes(entry)),
      ...recent,
    ];
  }
  async prepare(provider: Provider, input: ProviderInput, pinned: Entry[], onCompact: (phase: "started" | "retrying" | "completed", before: number, after?: number, detail?: string) => void): Promise<Entry[]> {
    const history = input.history as Entry[];
    const view = this.view(history, pinned);
    const before = contextSize({ ...input, history: view }, this.overhead);
    if (before <= this.compactAt) return view;

    // Retain recent exchanges intact, including an action/result pair at the boundary.
    let end = history.length, recentSize = 0;
    while (end > this.through) {
      const size = JSON.stringify(history[end - 1]).length;
      if (recentSize > 0 && recentSize + size > RECENT_CHARACTERS) break;
      recentSize += size; end--;
    }
    if (history[end]?.role === "tool" && end > this.through) end--;
    if (end === this.through) {
      if (before > CONTEXT_LIMIT) throw new Error("Current request or retained context exceeds the context limit; shorten the input. Transcript preserved.");
      return view;
    }

    onCompact("started", before);
    let summary = this.summary, through = this.through;
    // Commit only after every bounded summary request succeeds.
    while (through < end) {
      let next = through, size = 0;
      while (next < end) {
        const entrySize = JSON.stringify(history[next]).length;
        if (next > through && size + entrySize > BATCH_CHARACTERS) break;
        size += entrySize; next++;
      }
      const request: ProviderInput = {
        mode: "compaction",
        instructions: `Summary maximum characters: ${SUMMARY_CHARACTERS}\nSummary target characters: 4000\nSource entries: ${through}-${next - 1}`,
        history: [
          ...(summary ? [{ role: "assistant" as const, content: JSON.stringify({ context_summary: summary }) }] : []),
          ...history.slice(through, next),
        ], tools: [],
      };
      if (contextSize(request, this.overhead) > CONTEXT_LIMIT) {
        throw new Error("A transcript entry is too large to compact safely. Transcript and previous context preserved.");
      }
      let candidate = "", invalid = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const attemptInput = attempt === 0 ? request : {
          ...request, instructions: request.instructions + `\nSummary validation feedback: ${JSON.stringify({ reason: invalid, target_characters: 2000, attempt: 2 })}`,
        };
        if (contextSize(attemptInput, this.overhead) > CONTEXT_LIMIT) throw new Error("Summary retry exceeds the context limit; transcript and previous context preserved.");
        const action = await provider.next(attemptInput);
        invalid = action.kind !== "reply" ? `received a tool request (${action.tool})` :
          !action.message.trim() ? "received an empty reply" :
          action.message.length > SUMMARY_CHARACTERS ? `reply contained ${action.message.length} characters; maximum is ${SUMMARY_CHARACTERS}` : "";
        if (!invalid && action.kind === "reply") { candidate = action.message; break; }
        if (attempt === 0) onCompact("retrying", before, undefined, invalid);
      }
      if (!candidate) throw new Error(`Context compaction failed after two summary attempts: ${invalid}. No tool was executed; transcript and previous context preserved.`);
      summary = candidate; through = next;
    }
    const compacted = this.view(history, pinned, through, summary);
    const after = contextSize({ ...input, history: compacted }, this.overhead);
    if (after >= before || after > CONTEXT_LIMIT) {
      throw new Error("Context compaction could not create enough room. Transcript and previous context preserved; shorten the current input or start a new chat.");
    }
    this.summary = summary; this.through = through;
    onCompact("completed", before, after);
    return compacted;
  }
}
