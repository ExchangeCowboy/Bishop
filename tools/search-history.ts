import { open, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { Arguments, Entry } from "../app/types.ts";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { excludedSession, memoryReviewEntry } from "../app/history-content.ts";
import { DEFAULT_MEMORY_SETTINGS } from "../app/config.ts";

const MAX_BYTES = 10_000_000;

export async function searchHistory(directory: string, args: Arguments, excludedPrefixes: readonly string[] = DEFAULT_MEMORY_SETTINGS.excluded_session_prefixes) {
  const { query, session, offset = 0, limit = 10 } = args;
  if (Object.keys(args).some(key => !["query", "session", "offset", "limit"].includes(key)) ||
      typeof query !== "string" || !query.trim() || query.length > 500) throw new Error("search_history requires a nonempty literal query of at most 500 characters.");
  if (session !== undefined && (typeof session !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(session))) throw new Error("session must be a transcript name without extension or path.");
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a nonnegative safe integer.");
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 to 20.");
  const indexed = new Map<string, string>();
  if (session === undefined) {
    const database = join(directory, "..", "memories.sqlite");
    let exists = true;
    try { await stat(database); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; exists = false; }
    if (exists) {
      const db = new DatabaseSync(database, { readOnly: true, timeout: 5000 });
      try {
        for (const row of db.prepare("SELECT session,hash FROM progress WHERE cursor=total").all()) indexed.set(String(row.session), String(row.hash));
      } finally { db.close(); }
    }
  }
  let files: Dirent[];
  try { files = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files = []; }
  const candidates = files.filter(file => file.isFile() && /^[a-zA-Z0-9_-]{1,128}\.json$/.test(file.name) && (session === undefined || file.name === `${session}.json`)).sort((a, b) => a.name.localeCompare(b.name));
  const results: { session: string; source: string; entry_index: number; role: string; excerpt: string; excerpt_offset: number; truncated: boolean }[] = [];
  const skipped: { session: string; reason: string }[] = [];
  let scanned = 0, matched = 0, skippedCount = 0;
  let excludedIndexed = 0, excludedGenerated = 0;
  let excludedDevelopment = 0;
  const needle = query.trim().toLowerCase();
  for (const file of candidates) {
    const name = file.name.slice(0, -5);
    if (session === undefined && excludedSession(name, excludedPrefixes)) { excludedDevelopment++; continue; }
    try {
      const handle = await open(join(directory, file.name), "r");
      let text: string;
      let hash: string;
      try {
        if ((await handle.stat()).size > MAX_BYTES) throw new Error("Transcript exceeds 10 MB read limit.");
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
          const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null);
          if (!chunk.bytesRead) break;
          bytes += chunk.bytesRead;
        }
        if (bytes > MAX_BYTES) throw new Error("Transcript exceeds 10 MB read limit.");
        hash = createHash("sha256").update(buffer.subarray(0, bytes)).digest("hex");
        text = buffer.toString("utf8", 0, bytes);
      } finally { await handle.close(); }
      if (indexed.get(name) === hash!) { excludedIndexed++; continue; }
      const entries: unknown = JSON.parse(text);
      if (!Array.isArray(entries) || !entries.every(entry => entry && ["user", "assistant", "tool"].includes(entry.role) && typeof entry.content === "string")) throw new Error("Invalid transcript format.");
      scanned++;
      for (const [index, entry] of entries.entries()) {
        if (memoryReviewEntry(entries as Entry[], index)) { excludedGenerated++; continue; }
        if (entry.role === "tool") continue;
        // Assistant tool requests are execution records, not conversational replies.
        if (entry.role === "assistant") {
          try { if (JSON.parse(entry.content)?.kind === "tool") continue; } catch { /* Plain reply. */ }
        }
        if (!entry.content.toLowerCase().includes(needle)) continue;
        const match = matched++;
        if (match < offset || results.length >= limit) continue;
        // Locate on the original string so Unicode case expansion cannot shift excerpts.
        const position = entry.content.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"))?.index ?? 0;
        let start = Math.max(0, position - 150), end = Math.min(entry.content.length, start + 600);
        if (start > 0 && /[\uDC00-\uDFFF]/.test(entry.content[start])) start--;
        if (end < entry.content.length && /[\uDC00-\uDFFF]/.test(entry.content[end])) end--;
        results.push({ session: name, source: `memory/history/${file.name}`, entry_index: index, role: entry.role, excerpt: entry.content.slice(start, end), excerpt_offset: start, truncated: start > 0 || end < entry.content.length });
      }
    } catch (error) {
      skippedCount++;
      if (skipped.length < 10) skipped.push({ session: name, reason: error instanceof SyntaxError ? "Invalid transcript JSON." : error instanceof Error ? error.message : String(error) });
    }
  }
  return { query: query.trim(), results, total_matches: matched, scanned_sessions: scanned, excluded_indexed_sessions: excludedIndexed,
    excluded_generated_entries: excludedGenerated, excluded_development_sessions: excludedDevelopment, scope: session === undefined ? "unindexed_or_changed_conversations" : "explicit_source_session",
    skipped_sessions: skippedCount, skipped, incomplete: skippedCount > 0, next_offset: offset + results.length < matched ? offset + results.length : null };
}
