import type { Action, Arguments, Event, Provider } from "./types.ts";
import type { Tools } from "../tools/index.ts";
import { setTimeout as waitForRetry } from "node:timers/promises";

export function retryableMemoryRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|too many requests/i.test(message) && !/insufficient.quota|usage.limit|quota.exhaust|credits?|billing|spend.limit|weekly.limit/i.test(message);
}

const string = { type: "string" };
export const MEMORY_EXTRACTION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    memories: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false,
      properties: { information: string, context: string, keywords: string, event_date: string, entry_index: { type: "integer", minimum: 0 }, quote: string, historical: { type: "boolean" } },
      required: ["information", "context", "keywords", "event_date", "entry_index", "quote", "historical"] } },
    questions: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, properties: { question: string, conflicting_ids: { type: "array", maxItems: 20, items: { type: "integer", minimum: 1 } } }, required: ["question", "conflicting_ids"] } },
  }, required: ["memories", "questions"],
};
export const MEMORY_BATCH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { results: { type: "array", minItems: 1, maxItems: 5, items: {
    type: "object", additionalProperties: false,
    properties: { session: string, ...MEMORY_EXTRACTION_SCHEMA.properties },
    required: ["session", "memories", "questions"],
  } } }, required: ["results"],
};

export function parseMemoryExtraction(action: Action): { memories: unknown[]; questions: { question: string; conflicting_ids: number[] }[] } {
  if (action.kind !== "reply") throw new Error("Memory extraction requested a tool; nothing was executed.");
  if (action.message.length > 80000) throw new Error("Memory extraction exceeds the response limit.");
  const value = JSON.parse(action.message);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["memories", "questions"].includes(key)) ||
      !Array.isArray(value.memories) || value.memories.length > 20 || !Array.isArray(value.questions) || value.questions.length > 3 ||
      !value.questions.every((item: unknown) => {
        if (typeof item === "string") return item.trim() && item.length <= 500;
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const question = item as Record<string, unknown>;
        return Object.keys(question).every(key => ["question", "conflicting_ids"].includes(key)) && typeof question.question === "string" && question.question.trim() && question.question.length <= 500 &&
          Array.isArray(question.conflicting_ids) && question.conflicting_ids.length <= 20 && question.conflicting_ids.every(id => Number.isSafeInteger(id) && id > 0);
      })) {
    throw new Error("Invalid memory extraction; progress was not advanced.");
  }
  return { memories: value.memories, questions: value.questions.map((item: string | { question: string; conflicting_ids: number[] }) => typeof item === "string" ? { question: item, conflicting_ids: [] } : item) };
}

type Pending = { pending_count: number; sessions: { session: string }[]; skipped_count: number };
type Section = { session: string; source_hash: string; offset: number; already_indexed?: boolean; fragments: { text: string }[] };
export function parseMemoryBatch(action: Action, sessions: string[]) {
  if (action.kind !== "reply" || action.message.length > 160000) throw new Error("Invalid batch extraction; nothing was committed.");
  const value = JSON.parse(action.message);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "results") ||
      !Array.isArray(value.results) || value.results.length !== sessions.length) throw new Error("Batch extraction must cover every requested source exactly once.");
  const results = new Map<string, ReturnType<typeof parseMemoryExtraction>>();
  for (const result of value.results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid batch source result.");
    const { session, ...extraction } = result;
    if (typeof session !== "string" || !sessions.includes(session) || results.has(session)) throw new Error("Batch extraction contains an unknown or duplicate source.");
    results.set(session, parseMemoryExtraction({ kind: "reply", message: JSON.stringify(extraction) }));
  }
  return results;
}
export type MemoryReview = { sections: number; completed: number; memories: number; pending: number; skipped: number; questions: string[]; paused?: "rate_limit" };

/** Bookkeeping stays local; bounded groups of original sections share extraction. */
export async function reviewMemories(options: {
  tools: Tools; provider: Provider; maxSections: number; onEvent?: (event: Event) => void;
  guidance?: string;
  referenceContext?: { soul: string; notebook: string };
  batchSections?: number;
  rateLimitRetries?: number;
  retryDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  onRateLimit?: (delayMs: number, retry: number, maximum: number) => void;
  onProgress?: (session: string, sectionNumber: number) => void;
}): Promise<MemoryReview> {
  const { tools } = options;
  if (!tools.enabled("memory_indexer")) throw new Error("memory_indexer is disabled by configuration.");
  if (!Number.isSafeInteger(options.maxSections) || options.maxSections < 1) throw new Error("Memory section budget must be a positive safe integer.");
  const batchLimit = options.batchSections ?? 1;
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 5) throw new Error("Memory batch_sections must be an integer from 1 to 5.");
  const maxRetries = options.rateLimitRetries ?? 0, retryDelay = options.retryDelayMs ?? 15000;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3 || !Number.isInteger(retryDelay) || retryDelay < 5000 || retryDelay > 60000) throw new Error("Invalid memory rate-limit recovery settings.");
  const execute = async (name: string, args: Arguments): Promise<unknown> => {
    options.onEvent?.({ type: "tool_requested", name });
    const result = await tools.execute(name, args);
    options.onEvent?.({ type: "tool_result", name, result });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  let pending = await execute("memory_indexer", { action: "pending" }) as Pending;
  const report: MemoryReview = { sections: 0, completed: 0, memories: 0, pending: pending.pending_count, skipped: pending.skipped_count, questions: [] };
  const unanswered = await tools.memories.questions();
  if (unanswered.length) { report.questions = unanswered.map(question => `Question #${question.id} (${question.session}): ${question.question}`); return report; }
  let batchNumber = 0;
  let retriesUsed = 0;
  review: while (pending.sessions.length && report.sections < options.maxSections) {
    const batch: Section[] = [];
    let characters = 0;
    for (const { session } of pending.sessions) {
      if (batch.length >= batchLimit || report.sections + batch.length >= options.maxSections) break;
      const section = await execute("memory_indexer", { action: "read", session }) as Section;
      if (section.already_indexed) continue;
      const size = section.fragments.reduce((total, fragment) => total + fragment.text.length, 0);
      if (batch.length && characters + size > 16000) break;
      batch.push(section); characters += size;
    }
    if (!batch.length) throw new Error("Pending memory sources changed; use /memory again to refresh them.");
    const relatedRecords = new Map<number, { id: number }>();
    if (tools.enabled("search_memories")) {
      for (const section of batch) {
        const words = section.fragments.flatMap(fragment => fragment.text.match(/[\p{L}\p{N}_]{4,}/gu) ?? []);
        const query = [...new Set(words.map(word => word.toLowerCase()))].slice(0, 35).join(" ").slice(0, 500);
        if (!query) continue;
        const related = await execute("search_memories", { query, limit: 3, include_historical: true }) as { results: { id: number }[] };
        for (const record of related.results) if (relatedRecords.size < 5) relatedRecords.set(record.id, record);
      }
    }
    options.onProgress?.(batch.map(section => section.session).join(", "), ++batchNumber);
    const payload = { ...(batch.length === 1 ? { section: batch[0] } : { sections: batch }),
      related_memories: { results: [...relatedRecords.values()] }, confirmed_context: options.referenceContext };
    let action: Action;
    for (;;) {
      try {
        action = await options.provider.next({ mode: batch.length === 1 ? "memory" : "memory_batch", instructions: options.guidance ?? "", tools: [],
          history: [{ role: "user", content: JSON.stringify(payload) }] });
        break;
      } catch (error) {
        if (options.rateLimitRetries === undefined || !retryableMemoryRateLimit(error)) throw error;
        if (retriesUsed >= maxRetries) { report.paused = "rate_limit"; break review; }
        const delay = Math.min(60000, retryDelay * 2 ** retriesUsed) + Math.floor(Math.random() * 1000);
        retriesUsed++;
        options.onRateLimit?.(delay, retriesUsed, maxRetries);
        await (options.wait ?? (milliseconds => waitForRetry(milliseconds)))(delay);
        options.onProgress?.(batch.map(section => section.session).join(", "), batchNumber);
      }
    }
    const extractions = batch.length === 1 ? new Map([[batch[0].session, parseMemoryExtraction(action)]]) : parseMemoryBatch(action, batch.map(section => section.session));
    for (const extraction of extractions.values()) {
      if (extraction.questions.some(question => question.conflicting_ids.some(id => !relatedRecords.has(id)))) throw new Error("Clarification references a memory not supplied to extraction.");
    }
    for (const section of batch) {
      const extraction = extractions.get(section.session)!;
      const committed = await execute("memory_indexer", { action: "commit", session: section.session,
        source_hash: section.source_hash, offset: section.offset, memories: extraction.memories, questions: extraction.questions }) as { indexed: boolean; memory_ids: number[]; question_ids: number[] };
      report.sections++;
      report.memories += committed.memory_ids.length;
      if (committed.indexed) report.completed++;
      report.questions.push(...extraction.questions.map((question, index) => `${section.session}: ${question.question} (question #${committed.question_ids[index]})`));
    }
    pending = await execute("memory_indexer", { action: "pending" }) as Pending;
    report.pending = pending.pending_count;
    report.skipped = pending.skipped_count;
    if (report.questions.length) break;
  }
  return report;
}

export function memoryReviewSummary(report: MemoryReview): string {
  return (report.paused ? "Memory review paused because the service is still rate-limiting requests. Committed progress is saved; use /memory later to resume.\n" : "") +
    `Memory review: ${report.completed} chat log(s) completed, ${report.sections} section(s) reviewed, ${report.memories} memory record(s) saved or already retained.\n` +
    `${report.pending} chat log(s) remain; ${report.skipped} could not be inspected.` +
    (report.pending ? " Use /memory to continue." : "") +
    (report.questions.length ? `\nPlease clarify before I retain these uncertain interpretations:\n${report.questions.join("\n")}` : "");
}
