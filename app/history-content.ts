import type { Entry } from "./types.ts";

export function excludedSession(session: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => session === prefix || session.startsWith(`${prefix}-`));
}

function reviewRequest(entry: Entry): boolean {
  return entry.role === "user" && (entry.content.trim() === "/memory" || entry.content.startsWith("Review pending saved Bishop conversations for durable memory now."));
}

/** Generated indexing exchanges are not independent conversational evidence. */
export function memoryReviewEntry(entries: readonly Entry[], index: number): boolean {
  const entry = entries[index];
  if (entry.origin === "memory_review" || reviewRequest(entry)) return true;
  if (entry.role !== "assistant") return false;
  // Compatibility with old transcripts saved before explicit provenance existed.
  for (let i = index - 1; i >= 0; i--) {
    if (entries[i].role === "user") return reviewRequest(entries[i]);
  }
  return false;
}
