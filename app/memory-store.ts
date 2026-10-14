import { DatabaseSync } from "node:sqlite";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Arguments, Entry } from "./types.ts";
import { excludedSession, memoryReviewEntry } from "./history-content.ts";
import { DEFAULT_MEMORY_SETTINGS } from "./config.ts";

const MAX_BYTES = 10_000_000;
const CHUNK = 16000;
const namePattern = /^[a-zA-Z0-9_-]{1,128}$/;
type Progress = { hash: string; cursor: number; total: number };
type MemoryRow = { id: number; session: string; source_hash: string; entry_index: number; source_role: string; information: string; context: string; keywords: string;
  event_date: string; quote: string; recorded_at: string; source_saved_at: string; status: string; superseded_by: number | null; relevance: number };
type Fragment = { entry_index: number; role: string; text: string };
type Draft = { information: string; context: string; keywords: string; event_date: string; entry_index: number; quote: string; source_role: string; historical: boolean };
type Receipt = { session: string; hash: string; start: number; end: number; total: number; fragments: Fragment[]; savedAt: string; onboarding: boolean };
export type MemoryQuestion = { id: number; session: string; question: string; conflict_ids: string };
function ids(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Expected at most 20 memory/question IDs.");
  return [...new Set(value.map(id => integer(id, 1, Number.MAX_SAFE_INTEGER)))];
}

function only(args: Arguments, keys: string[]): void {
  if (Object.keys(args).some(key => !keys.includes(key))) throw new Error("Unexpected memory tool argument.");
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Expected integer from ${min} to ${max}.`);
  return value;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new Error(`Expected ${empty ? "" : "nonempty "}text of at most ${max} characters.`);
  return value.trim();
}
function conversation(entries: Entry[]): { entry_index: number; role: string; content: string }[] {
  return entries.flatMap((entry, entry_index) => {
    if (memoryReviewEntry(entries, entry_index)) return [];
    if (entry.role === "tool") return [];
    if (entry.role === "assistant") {
      try { if (JSON.parse(entry.content)?.kind === "tool") return []; } catch { /* Plain reply. */ }
    }
    return [{ entry_index, role: entry.role, content: entry.content }];
  });
}
function drafts(value: unknown, fragments: Fragment[]): Draft[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("memories must be an array of at most 20 records (empty is allowed).");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid memory record.");
    only(item, ["information", "context", "keywords", "event_date", "entry_index", "quote", "historical"]);
    if (item.historical !== undefined && typeof item.historical !== "boolean") throw new Error("historical must be true or false.");
    const draft = { information: text(item.information, 1000), context: text(item.context, 2000, true), keywords: text(item.keywords, 500, true),
      event_date: text(item.event_date, 10, true), entry_index: integer(item.entry_index, 0, Number.MAX_SAFE_INTEGER), quote: text(item.quote, 1000) };
    if (draft.event_date && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.event_date) || !Number.isFinite(Date.parse(draft.event_date)) || new Date(draft.event_date).toISOString().slice(0, 10) !== draft.event_date)) throw new Error("event_date must be an established YYYY-MM-DD date or empty when unknown.");
    const source = fragments.find(fragment => fragment.entry_index === draft.entry_index && fragment.text.includes(draft.quote));
    if (!source) throw new Error("Each memory needs an exact quote from its delivered source entry.");
    return { ...draft, source_role: source.role, historical: item.historical ?? false };
  });
}

/** Local persistence and source validation; the normal Bishop model performs extraction. */
export class MemoryStore {
  file: string;
  historyDirectory: string;
  activeSession?: string;
  activeHistory: readonly Entry[] = [];
  excludedSessionPrefixes: readonly string[];
  private receipts = new Map<string, Receipt>();
  constructor(root: string, excludedSessionPrefixes: readonly string[] = DEFAULT_MEMORY_SETTINGS.excluded_session_prefixes) {
    this.file = join(root, "memory", "memories.sqlite");
    this.historyDirectory = join(root, "memory", "history");
    this.excludedSessionPrefixes = [...excludedSessionPrefixes];
  }
  private async database(): Promise<DatabaseSync> {
    await mkdir(dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file, { timeout: 5000 });
    try {
      db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS progress(session TEXT PRIMARY KEY, hash TEXT NOT NULL, cursor INTEGER NOT NULL, total INTEGER NOT NULL, saved_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_questions(id INTEGER PRIMARY KEY, session TEXT NOT NULL, source_hash TEXT NOT NULL, question TEXT NOT NULL,
          conflict_ids TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_by INTEGER REFERENCES memories(id), UNIQUE(session,source_hash,question));
        CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, session TEXT NOT NULL, source_hash TEXT NOT NULL, entry_index INTEGER NOT NULL,
          information TEXT NOT NULL, context TEXT NOT NULL, keywords TEXT NOT NULL, event_date TEXT NOT NULL, quote TEXT NOT NULL,
          recorded_at TEXT NOT NULL, source_saved_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'current', superseded_by INTEGER REFERENCES memories(id),
          UNIQUE(session, entry_index, information, quote));
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(information, context, keywords, content='memories', content_rowid='id', tokenize='unicode61');
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memory_search(rowid,information,context,keywords) VALUES(new.id,new.information,new.context,new.keywords); END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memory_search(memory_search,rowid,information,context,keywords) VALUES('delete',old.id,old.information,old.context,old.keywords); END;`);
      if (!db.prepare("PRAGMA table_info(memories)").all().some(column => column.name === "source_role")) db.exec("ALTER TABLE memories ADD COLUMN source_role TEXT NOT NULL DEFAULT 'unknown'");
      return db;
    } catch (error) { db.close(); throw error; }
  }
  private async source(session: string) {
    if (!namePattern.test(session)) throw new Error("Invalid transcript name.");
    const path = join(this.historyDirectory, `${session}.json`);
    if (!(await lstat(path)).isFile() || relative(await realpath(this.historyDirectory), await realpath(path)) !== `${session}.json`) throw new Error("Transcript must be a regular local file.");
    const handle = await open(path, "r");
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error("Transcript exceeds 10 MB read limit or is not a file.");
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null);
        if (!chunk.bytesRead) break;
        bytes += chunk.bytesRead;
      }
      if (bytes > MAX_BYTES) throw new Error("Transcript exceeds 10 MB read limit.");
      const raw = buffer.subarray(0, bytes);
      const entries: unknown = JSON.parse(raw.toString("utf8"));
      if (!Array.isArray(entries) || !entries.every(entry => entry && ["user", "assistant", "tool"].includes(entry.role) && typeof entry.content === "string")) throw new Error("Invalid transcript format.");
      const onboarding = entries.some(entry => {
        if (entry.role !== "tool") return false;
        try { const result = JSON.parse(entry.content); return result.name === "complete_onboarding" || (result.name === "load_skill" && result.data?.name === "personal-onboarding"); }
        catch { return false; }
      });
      return { hash: createHash("sha256").update(raw).digest("hex"), savedAt: metadata.mtime.toISOString(), entries: conversation(entries), onboarding };
    } finally { await handle.close(); }
  }
  async pending(limit = 20) {
    const db = await this.database();
    try {
      let files: Dirent[];
      try { files = await readdir(this.historyDirectory, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; files = []; }
      const sessions: { session: string; cursor: number; source_saved_at: string }[] = [];
      const skipped: { session: string; reason: string }[] = [];
      let count = 0, skippedCount = 0;
      let excludedDevelopment = 0;
      for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!file.isFile() || !/^[a-zA-Z0-9_-]{1,128}\.json$/.test(file.name)) continue;
        const session = file.name.slice(0, -5);
        if (session === this.activeSession) continue;
        if (excludedSession(session, this.excludedSessionPrefixes)) { excludedDevelopment++; continue; }
        try {
          const source = await this.source(session);
          if (!source.entries.some(entry => entry.role === "user" && entry.content.trim() && entry.content.trim() !== "/memory")) continue;
          const progress = db.prepare("SELECT * FROM progress WHERE session=?").get(session) as Progress | undefined;
          if (progress?.hash === source.hash && progress.cursor === progress.total) continue;
          count++;
          if (sessions.length < limit) sessions.push({ session, cursor: progress?.hash === source.hash ? progress.cursor : 0, source_saved_at: source.savedAt });
        } catch (error) {
          skippedCount++;
          if (skipped.length < 10) skipped.push({ session, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      return { pending_count: count, sessions, skipped_count: skippedCount, skipped, incomplete: skippedCount > 0, excluded_development_count: excludedDevelopment };
    } finally { db.close(); }
  }
  async index(args: Arguments) {
    const action = args.action;
    if (action === "pending") { only(args, ["action"]); return this.pending(); }
    if (action === "questions") { only(args, ["action"]); return { questions: await this.questions() }; }
    if (action === "defer") {
      only(args, ["action", "question_ids"]);
      const questionIds = ids(args.question_ids), open = await this.questions();
      if (!questionIds.length || questionIds.some(id => !open.some(question => question.id === id))) throw new Error("Defer only open clarification questions.");
      return { deferred_ids: questionIds, saved: false, questions_remain_open: true };
    }
    if (action === "current") {
      only(args, ["action"]);
      const entries = conversation([...this.activeHistory]);
      const fragments: Fragment[] = [];
      let remaining = CHUNK;
      let truncated = false;
      for (const entry of entries.reverse()) {
        if (!remaining || fragments.length === 40) break;
        let start = Math.max(0, entry.content.length - remaining);
        if (start && /[\uDC00-\uDFFF]/.test(entry.content[start])) start++;
        const value = entry.content.slice(start);
        if (start > 0) truncated = true;
        fragments.unshift({ entry_index: entry.entry_index, role: entry.role, text: value });
        remaining -= value.length;
      }
      return { session: this.activeSession, fragments, truncated: truncated || fragments.length < entries.length };
    }
    if (action === "read") {
      only(args, ["action", "session"]);
      const session = text(args.session, 128);
      if (session === this.activeSession) throw new Error("Use remember for the active conversation; index it after it closes.");
      const source = await this.source(session);
      const total = source.entries.reduce((sum, entry) => sum + entry.content.length, 0);
      const db = await this.database();
      let start: number;
      try {
        const progress = db.prepare("SELECT * FROM progress WHERE session=?").get(session) as Progress | undefined;
        start = progress?.hash === source.hash && progress.total === total ? progress.cursor : 0;
      } finally { db.close(); }
      if (start >= total && total > 0) return { session, already_indexed: true };
      let end = Math.min(total, start + CHUNK);
      let position = 0;
      const fragments: Fragment[] = [];
      for (const entry of source.entries) {
        const from = Math.max(0, start - position);
        let to = Math.min(entry.content.length, end - position);
        if (to < entry.content.length && /[\uDC00-\uDFFF]/.test(entry.content[to])) { to--; end--; }
        if (to > from) fragments.push({ entry_index: entry.entry_index, role: entry.role, text: entry.content.slice(from, to) });
        if (fragments.length === 40) { end = position + to; break; }
        position += entry.content.length;
      }
      const receipt = { session, hash: source.hash, start, end, total, fragments, savedAt: source.savedAt, onboarding: source.onboarding };
      this.receipts.set(session, receipt);
      return { session, source: `memory/history/${session}.json`, source_hash: source.hash, source_saved_at: source.savedAt,
        offset: start, next_offset: end, total_characters: total, complete_after_commit: end === total, onboarding: source.onboarding, fragments };
    }
    if (action === "commit") {
      only(args, ["action", "session", "source_hash", "offset", "memories", "questions"]);
      const session = text(args.session, 128), receipt = this.receipts.get(session);
      if (!receipt || receipt.hash !== args.source_hash || receipt.start !== args.offset) throw new Error("Read the current source section before committing it.");
      const records = drafts(args.memories, receipt.fragments);
      if (receipt.onboarding) for (const record of records) record.historical = true;
      const questions = args.questions ?? [];
      if (!Array.isArray(questions) || questions.length > 3) throw new Error("Expected at most three clarification questions.");
      const checkedQuestions = questions.map(question => {
        if (!question || typeof question !== "object" || Array.isArray(question)) throw new Error("Invalid clarification question.");
        only(question, ["question", "conflicting_ids"]);
        return { question: text(question.question, 500), conflicting_ids: ids(question.conflicting_ids) };
      });
      const source = await this.source(session);
      if (source.hash !== receipt.hash) throw new Error("Transcript changed; read it again before committing.");
      const db = await this.database();
      try {
        db.exec("BEGIN IMMEDIATE");
        const progress = db.prepare("SELECT * FROM progress WHERE session=?").get(session) as Progress | undefined;
        const cursor = progress?.hash === receipt.hash && progress.total === receipt.total ? progress.cursor : 0;
        if (cursor !== receipt.start) throw new Error("Index progress changed; read the next section again.");
        // Keep old evidence, but do not present records from a changed transcript as current.
        db.prepare("UPDATE memories SET status='stale' WHERE session=? AND source_hash<>? AND status='current'").run(session, receipt.hash);
        const ids = this.insert(db, records, session, receipt.hash, receipt.savedAt);
        const questionIds: number[] = [];
        for (const question of checkedQuestions) {
          if (question.conflicting_ids.some(id => !db.prepare("SELECT id FROM memories WHERE id=? AND status IN ('current','historical','superseded')").get(id))) throw new Error("Question references an unavailable memory.");
          db.prepare("INSERT INTO memory_questions(session,source_hash,question,conflict_ids) VALUES(?,?,?,?) ON CONFLICT DO NOTHING")
            .run(session, receipt.hash, question.question, JSON.stringify(question.conflicting_ids));
          questionIds.push(Number(db.prepare("SELECT id FROM memory_questions WHERE session=? AND source_hash=? AND question=?").get(session, receipt.hash, question.question)!.id));
        }
        db.prepare("INSERT INTO progress VALUES(?,?,?,?,?) ON CONFLICT(session) DO UPDATE SET hash=excluded.hash,cursor=excluded.cursor,total=excluded.total,saved_at=excluded.saved_at")
          .run(session, receipt.hash, receipt.end, receipt.total, new Date().toISOString());
        db.exec("COMMIT");
        this.receipts.delete(session);
        return { session, memory_ids: ids, question_ids: questionIds, indexed: receipt.end === receipt.total, next_offset: receipt.end };
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
      finally { db.close(); }
    }
    if (action === "remember") {
      only(args, ["action", "memories"]);
      if (!this.activeSession) throw new Error("No active saved-conversation identity is available.");
      const entries = conversation([...this.activeHistory]);
      const records = drafts(args.memories, entries.map(entry => ({ entry_index: entry.entry_index, role: entry.role, text: entry.content })));
      const db = await this.database();
      try {
        db.exec("BEGIN IMMEDIATE");
        const ids = this.insert(db, records, this.activeSession, "active", "");
        db.exec("COMMIT");
        return { session: this.activeSession, memory_ids: ids, indexed: false };
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
      finally { db.close(); }
    }
    if (action === "correct") {
      only(args, ["action", "memories", "supersede_ids", "question_ids"]);
      if (!this.activeSession) throw new Error("No active conversation identity is available.");
      const entries = conversation([...this.activeHistory]);
      const records = drafts(args.memories, entries.map(entry => ({ entry_index: entry.entry_index, role: entry.role, text: entry.content })));
      const latestUser = entries.findLast(entry => entry.role === "user");
      if (records.length !== 1 || records[0].historical || records[0].entry_index !== latestUser?.entry_index || records[0].source_role !== "user") throw new Error("A correction requires one current memory quoted from the latest user answer.");
      const supersedeIds = ids(args.supersede_ids ?? []), questionIds = ids(args.question_ids ?? []);
      if (!supersedeIds.length && !questionIds.length) throw new Error("Identify conflicting memories or clarification questions for correction.");
      const db = await this.database();
      try {
        db.exec("BEGIN IMMEDIATE");
        for (const id of supersedeIds) if (!db.prepare("SELECT id FROM memories WHERE id=? AND status IN ('current','historical')").get(id)) throw new Error("Conflicting memory is no longer current or historical.");
        for (const id of questionIds) {
          const question = db.prepare("SELECT * FROM memory_questions WHERE id=? AND status='open'").get(id) as MemoryQuestion | undefined;
          if (!question) throw new Error("Clarification question is not open.");
          for (const conflictId of JSON.parse(question.conflict_ids) as number[]) {
            if (db.prepare("SELECT id FROM memories WHERE id=? AND status IN ('current','historical')").get(conflictId) && !supersedeIds.includes(conflictId)) throw new Error("Retire every active conflict linked to the clarification in this correction.");
          }
        }
        const [replacement] = this.insert(db, records, this.activeSession, "active", "");
        if (supersedeIds.includes(replacement) || !db.prepare("SELECT id FROM memories WHERE id=? AND status='current'").get(replacement)) throw new Error("Replacement must be a different current memory.");
        for (const id of supersedeIds) db.prepare("UPDATE memories SET status='superseded',superseded_by=? WHERE id=?").run(replacement, id);
        for (const id of questionIds) db.prepare("UPDATE memory_questions SET status='resolved',resolved_by=? WHERE id=?").run(replacement, id);
        db.exec("COMMIT");
        return { memory_id: replacement, superseded_ids: supersedeIds, resolved_question_ids: questionIds, saved: true };
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
      finally { db.close(); }
    }
    if (action === "historical") {
      only(args, ["action", "id"]);
      const id = integer(args.id, 1, Number.MAX_SAFE_INTEGER), db = await this.database();
      try { const result = db.prepare("UPDATE memories SET status='historical' WHERE id=? AND status='current'").run(id);
        if (!result.changes) throw new Error("Current memory not found.");
        return { id, status: "historical" };
      } finally { db.close(); }
    }
    if (action === "supersede" || action === "forget") {
      only(args, action === "supersede" ? ["action", "id", "replacement_id"] : ["action", "id"]);
      const id = integer(args.id, 1, Number.MAX_SAFE_INTEGER);
      const db = await this.database();
      try {
        const replacement = action === "supersede" ? integer(args.replacement_id, 1, Number.MAX_SAFE_INTEGER) : null;
        if (replacement === id || (replacement !== null && !db.prepare("SELECT id FROM memories WHERE id=? AND status='current'").get(replacement))) throw new Error("Replacement must be a different current memory.");
        const result = db.prepare("UPDATE memories SET status=?,superseded_by=? WHERE id=? AND status='current'").run(action === "forget" ? "forgotten" : "superseded", replacement, id);
        if (!result.changes) throw new Error("Current memory not found.");
        return { id, status: action === "forget" ? "forgotten" : "superseded", replacement_id: replacement };
      } finally { db.close(); }
    }
    throw new Error("Unknown memory_indexer action.");
  }
  async questions(): Promise<MemoryQuestion[]> {
    const db = await this.database();
    try { return db.prepare("SELECT id,session,question,conflict_ids FROM memory_questions WHERE status='open' ORDER BY id").all() as MemoryQuestion[]; }
    finally { db.close(); }
  }
  private insert(db: DatabaseSync, records: Draft[], session: string, hash: string, savedAt: string): number[] {
    const ids: number[] = [];
    for (const record of records) {
      const existing = db.prepare("SELECT id,status FROM memories WHERE session=? AND entry_index=? AND information=? AND quote=?")
        .get(session, record.entry_index, record.information, record.quote) as { id: number; status: string } | undefined;
      // Never revive explicitly forgotten/superseded memories on another indexing pass.
      if (existing) {
        if (existing.status === "stale") db.prepare("UPDATE memories SET status=?,source_hash=?,source_saved_at=? WHERE id=?").run(record.historical ? "historical" : "current", hash, savedAt, existing.id);
        else if (existing.status === "current") db.prepare("UPDATE memories SET source_hash=?,source_saved_at=? WHERE id=?").run(hash, savedAt, existing.id);
        if (existing.status === "current" && record.historical) db.prepare("UPDATE memories SET status='historical' WHERE id=?").run(existing.id);
        ids.push(existing.id); continue;
      }
      const result = db.prepare("INSERT INTO memories(session,source_hash,entry_index,information,context,keywords,event_date,quote,recorded_at,source_saved_at,source_role,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(session, hash, record.entry_index, record.information, record.context, record.keywords, record.event_date, record.quote, new Date().toISOString(), savedAt, record.source_role, record.historical ? "historical" : "current");
      ids.push(Number(result.lastInsertRowid));
    }
    return ids;
  }
  async search(args: Arguments) {
    only(args, ["query", "offset", "limit", "include_historical"]);
    if (args.include_historical !== undefined && typeof args.include_historical !== "boolean") throw new Error("include_historical must be true or false.");
    const query = text(args.query, 500), offset = integer(args.offset === undefined ? 0 : args.offset, 0, Number.MAX_SAFE_INTEGER), limit = integer(args.limit === undefined ? 5 : args.limit, 1, 10);
    const words = query.match(/[\p{L}\p{N}_]+/gu);
    if (!words?.length) throw new Error("Search needs at least one word or number.");
    const expression = [...new Set(words)].map(word => `"${word}"`).join(" OR ");
    const db = await this.database();
    try {
      const matches = db.prepare(`SELECT m.*, bm25(memory_search) AS relevance FROM memory_search JOIN memories m ON m.id=memory_search.rowid
        WHERE memory_search MATCH ? AND (m.status='current' OR (? AND m.status IN ('historical','superseded')))
        AND NOT EXISTS(SELECT 1 FROM json_each(?) excluded WHERE m.session=excluded.value OR substr(m.session,1,length(excluded.value)+1)=excluded.value||'-')
        ORDER BY relevance,m.id LIMIT ? OFFSET ?`).all(expression, args.include_historical ? 1 : 0, JSON.stringify(this.excludedSessionPrefixes), limit + 1, offset) as MemoryRow[];
      return { query, results: matches.slice(0, limit).map(row => ({ ...row, source: `memory/history/${row.session}.json` })),
        next_offset: matches.length > limit ? offset + limit : null };
    } finally { db.close(); }
  }
}
