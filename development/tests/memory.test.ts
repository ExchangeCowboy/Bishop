import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../app/memory-store.ts";
import { Sessions } from "../../app/session.ts";
import { Skills } from "../../app/skills.ts";
import { Tools } from "../../tools/index.ts";
import { Agent } from "../../app/agent.ts";
import { ConsoleUI } from "../../app/console.ts";
import { memoryStartupOffer, acceptMemoryOffer } from "../../app/memory-startup.ts";
import type { Entry, Provider } from "../../app/types.ts";
import { reviewMemories, memoryReviewSummary, parseMemoryExtraction, parseMemoryBatch, retryableMemoryRateLimit } from "../../app/memory-review.ts";
import { meteredProvider, usageSummary, type RunUsage } from "../../app/usage.ts";
import { CodexProvider } from "../../app/providers/codex.ts";
import { searchHistory } from "../../tools/search-history.ts";
import { DatabaseSync } from "node:sqlite";
import { parseConfig } from "../../app/config.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bishop-sqlite-test-"));
  const sessions = new Sessions(join(root, "memory", "history"));
  const store = new MemoryStore(root);
  const save = (name: string, entries: Entry[]) => sessions.save(name, entries);
  return { root, store, save, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const draft = (information = "Casey likes toast.", quote = "I like toast because my grandmother made it.", entry_index = 0) => ({
  information, context: "His grandmother made toast during his childhood.", keywords: "toast breakfast grandmother childhood", event_date: "", entry_index, quote,
});
async function read(store: MemoryStore, session = "old") { return await store.index({ action: "read", session }) as any; }
async function commit(store: MemoryStore, section: any, memories: unknown[] = []) {
  return await store.index({ action: "commit", session: section.session, source_hash: section.source_hash, offset: section.offset, memories }) as any;
}

test("SQLite indexing persists facts, reasons, dates and sources without changing original chats", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: "I like toast because my grandmother made it." }, { role: "tool", content: "secret execution output" }]);
    const original = await readFile(join(f.store.historyDirectory, "old.json"));
    assert.equal((await f.store.pending()).pending_count, 1);
    const section = await read(f.store);
    assert.equal(section.fragments.length, 1);
    const result = await commit(f.store, section, [draft()]);
    assert.equal(result.indexed, true);
    const reopened = new MemoryStore(f.root);
    assert.equal((await reopened.pending()).pending_count, 0);
    const found = await reopened.search({ query: "grandmother" });
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].context, draft().context);
    assert.equal(found.results[0].quote, draft().quote);
    assert.equal(found.results[0].event_date, "");
    assert.equal(found.results[0].entry_index, 0);
    assert.equal(found.results[0].source_role, "user");
    assert.match(found.results[0].recorded_at, /^\d{4}-/);
    assert.equal(found.results[0].source, "memory/history/old.json");
    assert.deepEqual(await readFile(join(f.store.historyDirectory, "old.json")), original);
  } finally { await f.cleanup(); }
});

test("indexing validates evidence before saving progress and detects changed sources", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: draft().quote }]);
    const section = await read(f.store);
    await assert.rejects(commit(f.store, section, [draft(), draft("Invented", "never said")]));
    await assert.rejects(commit(f.store, section, [{ ...draft(), event_date: "2026-02-30" }]));
    assert.equal((await f.store.pending()).pending_count, 1);
    assert.equal((await f.store.search({ query: "toast" })).results.length, 0);
    await f.save("old", [{ role: "user", content: "I now prefer oatmeal." }]);
    await assert.rejects(commit(f.store, section, [draft()]), /changed/);
    const fresh = await read(f.store);
    await commit(f.store, fresh, [draft("Casey prefers oatmeal.", "I now prefer oatmeal.")]);
    assert.equal((await f.store.search({ query: "oatmeal" })).results.length, 1);
    assert.equal((await f.store.pending()).pending_count, 0);
  } finally { await f.cleanup(); }
});

test("large logs resume at saved boundaries and empty commits finish uninteresting sections", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: "x".repeat(15999) + "😀" + "y".repeat(20000) }, { role: "assistant", content: "done" }]);
    const section = await read(f.store);
    assert.equal(section.next_offset, 15999);
    assert.ok(section.fragments.reduce((n: number, fragment: any) => n + fragment.text.length, 0) <= 16000);
    await commit(f.store, section);
    const restarted = new MemoryStore(f.root);
    assert.equal((await restarted.pending()).sessions[0].cursor, 15999);
    const next = await read(restarted);
    assert.equal(next.offset, 15999);
    assert.ok(next.fragments[0].text.startsWith("😀"));
    await assert.rejects(commit(f.store, section), /Read/);
    await commit(restarted, next);
    await commit(restarted, await read(restarted));
    assert.equal((await restarted.pending()).pending_count, 0);
    assert.equal((await restarted.search({ query: "nothing" })).results.length, 0);
  } finally { await f.cleanup(); }
});

test("pending excludes active, empty, demo and sidecar logs and reports invalid coverage", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.store.pending()).pending_count, 0);
    await f.save("old", [{ role: "user", content: "real conversation" }]);
    await f.save("active", [{ role: "user", content: "still running" }]);
    await f.save("empty", []);
    await f.save("maintenance", [{ role: "user", content: "/memory" }, { role: "assistant", content: "Memory review completed." }]);
    await f.save("demo-example", [{ role: "user", content: "offline demo" }]);
    await writeFile(join(f.store.historyDirectory, "bad.json"), "bad JSON");
    await writeFile(join(f.store.historyDirectory, "old.usage.json"), "sidecar");
    f.store.activeSession = "active";
    const pending = await f.store.pending();
    assert.equal(pending.pending_count, 1);
    assert.equal(pending.skipped_count, 1);
    assert.equal(pending.incomplete, true);
    await assert.rejects(read(f.store, "../outside"));
    await assert.rejects(read(f.store, "active"), /active/);
  } finally { await f.cleanup(); }
});

test("changed processed logs restart review and retire old source versions", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: draft().quote }]);
    await commit(f.store, await read(f.store), [draft()]);
    await f.save("old", [{ role: "user", content: "Oatmeal instead." }]);
    assert.equal((await f.store.pending()).pending_count, 1);
    const section = await read(f.store);
    assert.equal(section.offset, 0);
    await commit(f.store, section, [{ ...draft("Oatmeal instead.", "Oatmeal instead."), context: "", keywords: "oatmeal" }]);
    assert.equal((await f.store.search({ query: "toast" })).results.length, 0);
    assert.equal((await f.store.search({ query: "oatmeal" })).results.length, 1);
  } finally { await f.cleanup(); }
});

test("remember is idempotent and corrections and forgetting remain retired after indexing", async () => {
  const f = await fixture();
  try {
    f.store.activeSession = "old";
    f.store.activeHistory = [{ role: "user", content: draft().quote + " Now I prefer oatmeal." }];
    const memories = [draft(), { ...draft("Casey prefers oatmeal.", "Now I prefer oatmeal."), context: "", keywords: "oatmeal" }];
    const result = await f.store.index({ action: "remember", memories }) as any;
    assert.deepEqual((await f.store.index({ action: "remember", memories }) as any).memory_ids, result.memory_ids);
    await f.store.index({ action: "supersede", id: result.memory_ids[0], replacement_id: result.memory_ids[1] });
    assert.equal((await f.store.search({ query: "toast" })).results.length, 0);
    await f.store.index({ action: "forget", id: result.memory_ids[1] });
    await f.save("old", [...f.store.activeHistory]);
    f.store.activeSession = undefined;
    await commit(f.store, await read(f.store), memories);
    assert.equal((await f.store.search({ query: "oatmeal toast" })).results.length, 0);
    await assert.rejects(f.store.search({ query: "toast", limit: null }));
    await assert.rejects(f.store.search({ query: "toast", extra: true }));
    assert.equal((await f.store.search({ query: '" OR toast --' })).results.length, 0);
  } finally { await f.cleanup(); }
});

test("Bishop can save current chat memory through its normal provider loop; switches are enforced", async () => {
  const f = await fixture();
  try {
    const skills = new Skills(join(f.root, "skills"), join(f.root, "skills", ".revisions"));
    await mkdir(skills.root);
    const tools = new Tools({ skills, cwd: tmpdir() });
    tools.memories.activeSession = "active";
    let count = 0;
    const provider: Provider = { async next() {
      if (count++ === 0) return { kind: "tool", tool: "memory_indexer", arguments: { action: "remember", memories: [draft()] } };
      return { kind: "reply", message: "Remembered." };
    } };
    const agent = new Agent({ tools, provider, personality: "test" });
    assert.equal(await agent.run(draft().quote), "Remembered.");
    assert.equal((await tools.memories.search({ query: "grandmother" })).results.length, 1);
    for (const name of ["search_memories", "memory_indexer"] as const) {
      const disabled = new Tools({ skills, cwd: f.root, settings: { [name]: false } });
      assert.equal(disabled.specs().some(spec => spec.name === name), false);
      assert.match((await disabled.execute(name, {})).error!, /disabled/);
    }
  } finally { await f.cleanup(); }
});

test("startup offers defer safely and only explicit yes accepts the review", () => {
  assert.equal(memoryStartupOffer(0, 0), undefined);
  assert.match(memoryStartupOffer(3, 0)!, /3 chat logs.*\[y\/N\]/);
  assert.match(memoryStartupOffer(1, 2)!, /incomplete/);
  assert.match(memoryStartupOffer(0, 1)!, /could not be inspected/);
  for (const answer of ["", "no", "n", "later", "not now"]) assert.equal(acceptMemoryOffer(answer), "decline");
  for (const answer of ["yes", "Y", " YES "]) assert.equal(acceptMemoryOffer(answer), "accept");
  assert.equal(acceptMemoryOffer("help me with something else"), "chat");
});

test("local memory notices show no invented model timing or tool count", () => {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    const ui = new ConsoleUI(true); ui.color = false;
    ui.notice(memoryStartupOffer(2, 0)!);
    assert.match(output, /2 chat logs/);
    assert.doesNotMatch(output, /BISHOP.*\d+s|model call|0 tools/);
  } finally { process.stdout.write = original; }
});

test("original current-chat indices remain available separately from the compacted view", async () => {
  const f = await fixture();
  try {
    f.store.activeHistory = [{ role: "tool", content: "hidden execution evidence" }, { role: "assistant", content: JSON.stringify({ kind: "tool" }) },
      { role: "user", content: "x".repeat(20000) + draft().quote }];
    const current = await f.store.index({ action: "current" }) as any;
    assert.equal(current.fragments.length, 1);
    assert.equal(current.fragments[0].entry_index, 2);
    assert.equal(current.fragments[0].text.length, 16000);
    assert.equal(current.truncated, true);
    assert.ok(current.fragments[0].text.endsWith(draft().quote));
  } finally { await f.cleanup(); }
});

test("small entries stay bounded by fragment count and are processed without omissions", async () => {
  const f = await fixture();
  try {
    await f.save("old", Array.from({ length: 85 }, () => ({ role: "user" as const, content: "x" })));
    let fragments = 0;
    while ((await f.store.pending()).pending_count) {
      const section = await read(f.store);
      assert.ok(section.fragments.length <= 40);
      fragments += section.fragments.length;
      await commit(f.store, section);
    }
    assert.equal(fragments, 85);
  } finally { await f.cleanup(); }
});

test("fake-provider review uses normal tool decisions to index a full original chat", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: draft().quote }]);
    const skills = new Skills(join(f.root, "skills"), join(f.root, "skills", ".revisions"));
    await mkdir(skills.root);
    const tools = new Tools({ skills, cwd: f.root });
    tools.memories.activeSession = "active";
    let stage = 0;
    const provider: Provider = { async next(input) {
      const result = input.history.at(-1)?.role === "tool" ? JSON.parse(input.history.at(-1)!.content) : undefined;
      if (stage++ === 0) return { kind: "tool", tool: "memory_indexer", arguments: { action: "pending" } };
      if (stage === 2) return { kind: "tool", tool: "memory_indexer", arguments: { action: "read", session: result.data.sessions[0].session } };
      if (stage === 3) return { kind: "tool", tool: "memory_indexer", arguments: { action: "commit", session: result.data.session, source_hash: result.data.source_hash, offset: result.data.offset, memories: [draft()] } };
      assert.equal(result.ok, true);
      assert.equal(result.data.indexed, true);
      return { kind: "reply", message: "Reviewed one conversation." };
    } };
    const agent = new Agent({ provider, tools, personality: "Test memory review." });
    assert.equal(await agent.run("Review pending logs for memory."), "Reviewed one conversation.");
    assert.equal((await tools.memories.pending()).pending_count, 0);
    assert.equal((await tools.memories.search({ query: "grandmother" })).results.length, 1);
  } finally { await f.cleanup(); }
});

async function reviewFixture() {
  const f = await fixture();
  const skills = new Skills(join(f.root, "skills"), join(f.root, "skills", ".revisions"));
  await mkdir(skills.root);
  const tools = new Tools({ skills, cwd: f.root });
  tools.memories.activeSession = "active";
  return { ...f, tools };
}
const emptyExtraction = () => ({ kind: "reply" as const, message: JSON.stringify({ memories: [], questions: [] }) });

test("local review uses exactly one isolated extraction request per original section", async () => {
  const f = await reviewFixture();
  try {
    await f.save("alpha", [{ role: "user", content: draft().quote }]);
    await f.save("beta", [{ role: "user", content: "I prefer oatmeal." }]);
    const run: RunUsage = { startedAt: "test", elapsedMs: 0, failed: false, calls: [] };
    const sources: string[] = [];
    const provider: Provider = { async next(input) {
      assert.equal(input.mode, "memory");
      assert.deepEqual(input.tools, []);
      assert.equal(input.history.length, 1);
      assert.equal(input.instructions, "Configured extraction priorities.");
      const payload = JSON.parse(input.history[0].content);
      sources.push(payload.section.session);
      input.onUsage?.({ input: 100, cachedInput: 20, output: 10 });
      return { kind: "reply", message: JSON.stringify({ memories: sources.length === 1 ? [draft()] : [], questions: [] }) };
    } };
    const report = await reviewMemories({ tools: f.tools, provider: meteredProvider(provider, run), maxSections: 10, guidance: "Configured extraction priorities." });
    assert.deepEqual(sources, ["alpha", "beta"]);
    assert.equal(report.sections, 2);
    assert.equal(report.completed, 2);
    assert.equal(report.memories, 1);
    assert.equal(report.pending, 0);
    assert.equal(run.calls.length, 2);
    assert.ok(run.calls.every(call => call.mode === "memory" && call.input === 100));
    assert.match(usageSummary([run]), /Memory extraction: 2 calls/);
    assert.equal((await f.tools.memories.search({ query: "grandmother" })).results.length, 1);
    assert.match(memoryReviewSummary(report), /2 chat log\(s\) completed/);
  } finally { await f.cleanup(); }
});

test("provider failure stops without retrying; review resumes only unfinished sections", async () => {
  const f = await reviewFixture();
  try {
    await f.save("alpha", [{ role: "user", content: "First conversation." }]);
    await f.save("beta", [{ role: "user", content: "Second conversation." }]);
    let calls = 0;
    const provider: Provider = { async next() { if (++calls === 2) throw new Error("429 Too Many Requests"); return emptyExtraction(); } };
    await assert.rejects(reviewMemories({ tools: f.tools, provider, maxSections: 10 }), /429/);
    assert.equal(calls, 2);
    assert.equal((await f.tools.memories.pending()).pending_count, 1);
    const report = await reviewMemories({ tools: f.tools, maxSections: 10, provider: { async next(input) {
      assert.equal(JSON.parse(input.history[0].content).section.session, "beta"); return emptyExtraction();
    } } });
    assert.equal(report.sections, 1);
    assert.equal(report.pending, 0);
  } finally { await f.cleanup(); }
});

test("section budget stops after commits and no pending work makes no model request", async () => {
  const f = await reviewFixture();
  try {
    const noCall: Provider = { async next() { throw new Error("Unexpected model call"); } };
    assert.equal((await reviewMemories({ tools: f.tools, provider: noCall, maxSections: 1 })).sections, 0);
    await f.save("alpha", [{ role: "user", content: "a".repeat(20000) }]);
    const report = await reviewMemories({ tools: f.tools, provider: { async next() { return emptyExtraction(); } }, maxSections: 1 });
    assert.equal(report.sections, 1);
    assert.equal(report.completed, 0);
    assert.equal(report.pending, 1);
    assert.equal((await f.tools.memories.pending()).sessions[0].cursor, 16000);
    f.tools.settings.memory_indexer = false;
    await assert.rejects(reviewMemories({ tools: f.tools, provider: noCall, maxSections: 10 }), /disabled/);
  } finally { await f.cleanup(); }
});

test("invalid extraction and hallucinated source quotes never advance processing", async () => {
  const f = await reviewFixture();
  try {
    await f.save("old", [{ role: "user", content: draft().quote }]);
    for (const action of [{ kind: "tool" as const, tool: "run_command", arguments: {} }, { kind: "reply" as const, message: "not JSON" },
      { kind: "reply" as const, message: JSON.stringify({ memories: [draft("Invented", "not in source")], questions: [] }) }]) {
      await assert.rejects(reviewMemories({ tools: f.tools, maxSections: 10, provider: { async next() { return action; } } }));
      assert.equal((await f.tools.memories.pending()).sessions[0].cursor, 0);
      assert.equal((await f.tools.memories.search({ query: "Invented" })).results.length, 0);
    }
    assert.throws(() => parseMemoryExtraction({ kind: "reply", message: JSON.stringify({ memories: [], questions: ["x".repeat(501)] }) }));
  } finally { await f.cleanup(); }
});

test("questions pause review after saving grounded records and surface in its local summary", async () => {
  const f = await reviewFixture();
  try {
    await f.save("alpha", [{ role: "user", content: draft().quote }]);
    await f.save("beta", [{ role: "user", content: "Another conversation." }]);
    const report = await reviewMemories({ tools: f.tools, maxSections: 10, provider: { async next() {
      return { kind: "reply", message: JSON.stringify({ memories: [draft()], questions: ["Should I treat this as a lasting breakfast preference?"] }) };
    } } });
    assert.equal(report.sections, 1);
    assert.equal(report.pending, 1);
    assert.match(memoryReviewSummary(report), /alpha: Should I treat/);
    assert.equal((await f.tools.memories.search({ query: "grandmother" })).results.length, 1);
  } finally { await f.cleanup(); }
});

test("memory provider requests require the dedicated harness and never fall back to chat", async () => {
  const provider = new CodexProvider({ harness: "chat", executable: "unused-executable" });
  await assert.rejects(provider.next({ mode: "memory", instructions: "", history: [], tools: [] }), /Memory extraction harness is unavailable/);
});

async function seedClarification(f: Awaited<ReturnType<typeof reviewFixture>>) {
  await f.save("old", [{ role: "user", content: draft().quote }]);
  const section = await read(f.tools.memories);
  const saved = await f.tools.memories.index({ action: "commit", session: "old", source_hash: section.source_hash, offset: section.offset,
    memories: [draft()], questions: [{ question: "What should I remember instead?", conflicting_ids: [] }] }) as any;
  // A second source links its clarification to the first memory.
  await f.save("conflict", [{ role: "user", content: "A possibly outdated preference." }]);
  const conflict = await read(f.tools.memories, "conflict");
  const question = await f.tools.memories.index({ action: "commit", session: "conflict", source_hash: conflict.source_hash, offset: conflict.offset,
    memories: [], questions: [{ question: "Do you still prefer toast?", conflicting_ids: saved.memory_ids }] }) as any;
  return { memoryId: saved.memory_ids[0] as number, questionIds: [...saved.question_ids, ...question.question_ids] as number[] };
}

test("correction atomically saves the latest answer, retires conflicts and resolves persistent questions", async () => {
  const f = await reviewFixture();
  try {
    const seeded = await seedClarification(f);
    f.tools.memories.activeHistory = [{ role: "user", content: "I prefer oatmeal now." }];
    const replacement = { ...draft("Casey prefers oatmeal.", "I prefer oatmeal now."), context: "Current correction.", keywords: "oatmeal" };
    await assert.rejects(f.tools.memories.index({ action: "correct", memories: [replacement], supersede_ids: [], question_ids: seeded.questionIds }), /every active conflict/);
    assert.equal((await f.tools.memories.search({ query: "oatmeal" })).results.length, 0);
    assert.equal((await f.tools.memories.questions()).length, 2);
    const result = await f.tools.memories.index({ action: "correct", memories: [replacement], supersede_ids: [seeded.memoryId], question_ids: seeded.questionIds }) as any;
    assert.equal(result.saved, true);
    const reopened = new MemoryStore(f.root);
    assert.equal((await reopened.questions()).length, 0);
    assert.equal((await reopened.search({ query: "toast" })).results.length, 0);
    assert.equal((await reopened.search({ query: "oatmeal" })).results.length, 1);
  } finally { await f.cleanup(); }
});

test("agent blocks bare clarification acknowledgments until the updater commits", async () => {
  const f = await reviewFixture();
  try {
    const seeded = await seedClarification(f);
    let calls = 0;
    const agent = new Agent({ tools: f.tools, personality: "test", provider: { async next(input) {
      calls++;
      if (calls === 1) return { kind: "reply", message: "Oatmeal it is." };
      if (calls === 2) {
        assert.match(input.history.at(-1)!.content, /memory_clarification_guard/);
        return { kind: "tool", tool: "memory_indexer", arguments: { action: "correct", question_ids: seeded.questionIds, supersede_ids: [seeded.memoryId],
          memories: [{ ...draft("Casey prefers oatmeal.", "Oatmeal"), entry_index: 0, keywords: "oatmeal", context: "Confirmed answer to the stored preference question." }] } };
      }
      return { kind: "reply", message: "Saved your oatmeal preference." };
    } } });
    assert.equal(await agent.run("Oatmeal"), "Saved your oatmeal preference.");
    assert.equal(agent.history.some(entry => entry.content === "Oatmeal it is."), false);
    assert.equal((await f.tools.memories.questions()).length, 0);
    assert.equal((await f.tools.memories.search({ query: "toast" })).results.length, 0);
  } finally { await f.cleanup(); }
});

test("deferral is explicit, saves no correction and resets next turn; exhaustion cannot bypass the guard", async () => {
  const f = await reviewFixture();
  try {
    const seeded = await seedClarification(f);
    const agent = new Agent({ tools: f.tools, personality: "test", maxSteps: 1, provider: { async next() { return { kind: "reply", message: "Pretend this was saved." }; } } });
    await assert.rejects(agent.run("Something unrelated."), /no unverified acknowledgment/);
    assert.equal((await f.tools.memories.questions()).length, 2);
    assert.equal((await f.tools.execute("memory_indexer", { action: "defer", question_ids: seeded.questionIds })).ok, true);
    assert.equal(f.tools.deferredMemoryQuestions.size, 2);
    assert.equal((await f.tools.memories.questions()).length, 2);
    f.tools.beginTurn();
    assert.equal(f.tools.deferredMemoryQuestions.size, 0);
    const report = await reviewMemories({ tools: f.tools, provider: { async next() { throw new Error("Must not extract with open questions"); } }, maxSections: 10 });
    assert.equal(report.sections, 0);
    assert.equal(report.questions.length, 2);
  } finally { await f.cleanup(); }
});

test("onboarding memories and historical experiments stay out of current recall", async () => {
  const f = await reviewFixture();
  try {
    await f.save("old", [{ role: "user", content: draft().quote }, { role: "tool", content: JSON.stringify({ name: "complete_onboarding", ok: true }) }]);
    const section = await read(f.tools.memories);
    assert.equal(section.onboarding, true);
    await commit(f.tools.memories, section, [draft()]);
    assert.equal((await f.tools.memories.search({ query: "toast" })).results.length, 0);
    assert.equal((await f.tools.memories.search({ query: "toast", include_historical: true })).results[0].status, "historical");
    f.tools.memories.activeHistory = [{ role: "user", content: "Toast is my current preference." }];
    await f.tools.memories.index({ action: "correct", supersede_ids: [1], question_ids: [], memories: [{ ...draft("Casey currently likes toast.", "Toast is my current preference."), context: "Reconfirmed now." }] });
    assert.equal((await f.tools.memories.search({ query: "toast" })).results[0].information, "Casey currently likes toast.");
  } finally { await f.cleanup(); }
});

test("corrections cannot cite an earlier user message or an assistant assertion", async () => {
  const f = await reviewFixture();
  try {
    const seeded = await seedClarification(f);
    f.tools.memories.activeHistory = [{ role: "user", content: draft().quote }, { role: "assistant", content: "Use oatmeal." }, { role: "user", content: "Unrelated message." }];
    for (const record of [draft(), draft("Oatmeal", "Use oatmeal.", 1)]) {
      await assert.rejects(f.tools.memories.index({ action: "correct", supersede_ids: [seeded.memoryId], question_ids: seeded.questionIds, memories: [record] }), /latest user answer/);
    }
    assert.equal((await f.tools.memories.search({ query: "toast" })).results.length, 1);
  } finally { await f.cleanup(); }
});

test("broad history skips only fully indexed unchanged sources; scoped source checks still work", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: draft().quote }]);
    await f.save("fresh", [{ role: "user", content: "A toast discussion not yet indexed." }]);
    await commit(f.store, await read(f.store), [draft()]);
    let result = await searchHistory(f.store.historyDirectory, { query: "toast" });
    assert.equal(result.total_matches, 1);
    assert.equal(result.results[0].session, "fresh");
    assert.equal(result.excluded_indexed_sessions, 1);
    assert.equal(result.incomplete, false);
    result = await searchHistory(f.store.historyDirectory, { query: "toast", session: "old" });
    assert.equal(result.total_matches, 1);
    assert.equal(result.scope, "explicit_source_session");
    await f.save("old", [{ role: "user", content: "Changed toast preference." }]);
    result = await searchHistory(f.store.historyDirectory, { query: "toast" });
    assert.equal(result.total_matches, 2);
    assert.equal(result.excluded_indexed_sessions, 0);
  } finally { await f.cleanup(); }
});

test("partly indexed originals remain searchable and pagination excludes indexed matches", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: "toast " + "x".repeat(20000) }]);
    await commit(f.store, await read(f.store));
    await f.save("fresh", [{ role: "user", content: "toast one" }, { role: "assistant", content: "toast two" }]);
    const first = await searchHistory(f.store.historyDirectory, { query: "toast", limit: 1 });
    assert.equal(first.excluded_indexed_sessions, 0);
    assert.equal(first.total_matches, 3);
    assert.equal(first.next_offset, 1);
    await commit(f.store, await read(f.store));
    const filtered = await searchHistory(f.store.historyDirectory, { query: "toast", limit: 1 });
    assert.equal(filtered.total_matches, 2);
    assert.equal(filtered.excluded_indexed_sessions, 1);
    const next = await searchHistory(f.store.historyDirectory, { query: "toast", limit: 1, offset: filtered.next_offset });
    assert.equal(next.results[0].entry_index, 1);
    assert.equal(next.next_offset, null);
  } finally { await f.cleanup(); }
});

test("tagged and legacy indexing summaries are neither searched nor re-extracted; real followups survive", async () => {
  const f = await fixture();
  try {
    await f.save("old", [
      { role: "user", content: "/memory" },
      { role: "assistant", content: "Memory review: Rowan and Bob were names mentioned." },
      { role: "assistant", content: "More generated Rowan context.", origin: "memory_review" },
      { role: "user", content: "Bishop is the name I want now." },
      { role: "assistant", content: "Bishop confirmed." },
    ]);
    const result = await searchHistory(f.store.historyDirectory, { query: "Rowan", session: "old" });
    assert.equal(result.total_matches, 0);
    assert.equal(result.excluded_generated_entries, 3);
    assert.equal((await searchHistory(f.store.historyDirectory, { query: "Bishop" })).total_matches, 2);
    const section = await read(f.store);
    assert.deepEqual(section.fragments.map((entry: any) => entry.entry_index), [3, 4]);
    await f.save("legacy", [{ role: "user", content: "Review pending saved Bishop conversations for durable memory now. Use memory_indexer" }, { role: "assistant", content: "Rowan indexed." }]);
    assert.equal((await searchHistory(f.store.historyDirectory, { query: "Rowan", session: "legacy" })).total_matches, 0);
  } finally { await f.cleanup(); }
});

test("historical memory searches include superseded evidence without reviving it as current", async () => {
  const f = await fixture();
  try {
    f.store.activeSession = "active";
    f.store.activeHistory = [{ role: "user", content: "Call yourself Rowan." }];
    const old = await f.store.index({ action: "remember", memories: [{ ...draft("Casey once named the assistant Rowan.", "Call yourself Rowan."), context: "Earlier naming preference.", keywords: "assistant name Rowan" }] }) as any;
    f.store.activeHistory = [{ role: "user", content: "Bishop" }];
    await f.store.index({ action: "correct", supersede_ids: old.memory_ids, question_ids: [], memories: [{ ...draft("Casey calls the assistant Bishop.", "Bishop"), context: "Current confirmed name.", keywords: "assistant name Bishop" }] });
    assert.equal((await f.store.search({ query: "Rowan" })).results.length, 0);
    assert.equal((await f.store.search({ query: "Rowan", include_historical: true })).results[0].status, "superseded");
  } finally { await f.cleanup(); }
});

test("partial indexing restarts safely when filtering changes the delivered source length", async () => {
  const f = await fixture();
  try {
    await f.save("old", [{ role: "user", content: "Original conversation." }]);
    const section = await read(f.store);
    const db = new DatabaseSync(f.store.file);
    try { db.prepare("INSERT INTO progress VALUES(?,?,?,?,?)").run("old", section.source_hash, 100, 1000, "previous-view"); }
    finally { db.close(); }
    const refreshed = await read(f.store);
    assert.equal(refreshed.offset, 0);
    await commit(f.store, refreshed);
    assert.equal((await f.store.pending()).pending_count, 0);
  } finally { await f.cleanup(); }
});

test("five short logs share one extraction call while preserving each source and its memories", async () => {
  const f = await reviewFixture();
  try {
    for (const name of ["alpha", "beta", "gamma", "delta", "epsilon"]) await f.save(name, [{ role: "user", content: `Remember source ${name}.` }]);
    let calls = 0;
    const report = await reviewMemories({ tools: f.tools, maxSections: 10, batchSections: 5, provider: { async next(input) {
      calls++;
      assert.equal(input.mode, "memory_batch");
      assert.equal(input.history.length, 1);
      assert.deepEqual(input.tools, []);
      const payload = JSON.parse(input.history[0].content);
      assert.equal(payload.sections.length, 5);
      assert.ok(payload.related_memories.results.length <= 5);
      return { kind: "reply", message: JSON.stringify({ results: payload.sections.map((section: any) => ({ session: section.session,
        memories: [{ ...draft(`Retain ${section.session}.`, `Remember source ${section.session}.`), context: "Source-specific evidence.", keywords: section.session }], questions: [] })) }) };
    } } });
    assert.equal(calls, 1);
    assert.equal(report.completed, 5);
    assert.equal(report.sections, 5);
    assert.equal(report.pending, 0);
    const memories = await f.tools.memories.search({ query: "Retain" });
    assert.equal(memories.results.length, 5);
    for (const record of memories.results) assert.equal(record.quote, `Remember source ${record.session}.`);
  } finally { await f.cleanup(); }
});

test("batch packing respects source-character and section budgets; large logs remain resumable", async () => {
  const f = await reviewFixture();
  try {
    for (const name of ["alpha", "beta", "gamma"]) await f.save(name, [{ role: "user", content: name.repeat(2200) }]);
    const lengths: number[] = [];
    const provider: Provider = { async next(input) {
      const payload = JSON.parse(input.history[0].content), sections = payload.sections ?? [payload.section];
      lengths.push(sections.reduce((total: number, section: any) => total + section.fragments.reduce((sum: number, fragment: any) => sum + fragment.text.length, 0), 0));
      return sections.length === 1 ? emptyExtraction() : { kind: "reply", message: JSON.stringify({ results: sections.map((section: any) => ({ session: section.session, memories: [], questions: [] })) }) };
    } };
    const report = await reviewMemories({ tools: f.tools, maxSections: 2, batchSections: 5, provider });
    assert.equal(report.sections, 2);
    assert.equal(report.pending, 1);
    assert.ok(lengths.every(size => size <= 16000));
    assert.equal(lengths.length, 2);
    const final = await reviewMemories({ tools: f.tools, maxSections: 10, batchSections: 5, provider });
    assert.equal(final.pending, 0);
  } finally { await f.cleanup(); }
});

test("incomplete, duplicate or unknown batch sources fail before any source is committed", async () => {
  const f = await reviewFixture();
  try {
    await f.save("alpha", [{ role: "user", content: "A first source." }]);
    await f.save("beta", [{ role: "user", content: "A second source." }]);
    for (const names of [["alpha"], ["alpha", "alpha"], ["alpha", "unknown"]]) {
      const action = { kind: "reply" as const, message: JSON.stringify({ results: names.map(session => ({ session, memories: [], questions: [] })) }) };
      assert.throws(() => parseMemoryBatch(action, ["alpha", "beta"]));
      await assert.rejects(reviewMemories({ tools: f.tools, maxSections: 10, batchSections: 5, provider: { async next() { return action; } } }));
      assert.equal((await f.tools.memories.pending()).pending_count, 2);
    }
  } finally { await f.cleanup(); }
});

test("a failed later batch preserves earlier source commits and resumes only pending originals", async () => {
  const f = await reviewFixture();
  try {
    for (let number = 0; number < 7; number++) await f.save(`source${number}`, [{ role: "user", content: `Original source ${number}.` }]);
    let calls = 0;
    const provider: Provider = { async next(input) {
      if (++calls === 2) throw new Error("429 Too Many Requests");
      const sections = JSON.parse(input.history[0].content).sections;
      return { kind: "reply", message: JSON.stringify({ results: sections.map((section: any) => ({ session: section.session, memories: [], questions: [] })) }) };
    } };
    await assert.rejects(reviewMemories({ tools: f.tools, maxSections: 10, batchSections: 5, provider }), /429/);
    assert.equal(calls, 2);
    assert.equal((await f.tools.memories.pending()).pending_count, 2);
    const report = await reviewMemories({ tools: f.tools, maxSections: 10, batchSections: 5, provider: { async next(input) {
      const sections = JSON.parse(input.history[0].content).sections;
      assert.deepEqual(sections.map((section: any) => section.session), ["source5", "source6"]);
      return { kind: "reply", message: JSON.stringify({ results: sections.map((section: any) => ({ session: section.session, memories: [], questions: [] })) }) };
    } } });
    assert.equal(report.completed, 2);
    assert.equal(report.pending, 0);
  } finally { await f.cleanup(); }
});

test("batch extraction cannot attach a quote from another source to its memory", async () => {
  const f = await reviewFixture();
  try {
    await f.save("alpha", [{ role: "user", content: "The alpha source." }]);
    await f.save("beta", [{ role: "user", content: "The beta source." }]);
    await assert.rejects(reviewMemories({ tools: f.tools, maxSections: 10, batchSections: 5, provider: { async next() {
      return { kind: "reply", message: JSON.stringify({ results: [
        { session: "alpha", memories: [draft("Wrong attribution", "The beta source.")], questions: [] },
        { session: "beta", memories: [], questions: [] },
      ] }) };
    } } }), /exact quote/);
    assert.equal((await f.tools.memories.pending()).pending_count, 2);
  } finally { await f.cleanup(); }
});

test("memory grouping config validates limits and batch calls retain memory usage accounting", async () => {
  assert.equal(parseConfig({ memory: {} }).memory?.batch_sections, 5);
  assert.equal(parseConfig({ memory: { batch_sections: 1 } }).memory?.batch_sections, 1);
  for (const memory of [{ batch_sections: 0 }, { batch_sections: 6 }, { batch_sections: "5" }, { batch_sections: 1.5 }, { unknown: true }]) assert.throws(() => parseConfig({ memory }));
  const run: RunUsage = { startedAt: "test", elapsedMs: 0, failed: false, calls: [] };
  await meteredProvider({ async next() { return emptyExtraction(); } }, run).next({ mode: "memory_batch", history: [], instructions: "", tools: [] });
  assert.equal(run.calls[0].mode, "memory");
});

test("development fixtures are excluded from pending, broad history and stored-memory recall without deleting originals", async () => {
  const f = await fixture();
  try {
    for (const name of ["demo", "smoke-command", "layout-live-smoke-123", "restructure-smoke-123", "default", "smokey"]) await f.save(name, [{ role: "user", content: "A fixture marker." }]);
    const pending = await f.store.pending();
    assert.equal(pending.pending_count, 2);
    assert.equal(pending.excluded_development_count, 4);
    const history = await searchHistory(f.store.historyDirectory, { query: "marker" });
    assert.equal(history.total_matches, 2);
    assert.equal(history.excluded_development_sessions, 4);
    assert.equal((await searchHistory(f.store.historyDirectory, { query: "marker", session: "smoke-command" })).total_matches, 1);
    f.store.activeSession = "smoke-command";
    f.store.activeHistory = [{ role: "user", content: "A fixture marker." }];
    await f.store.index({ action: "remember", memories: [{ ...draft("Fixture marker", "A fixture marker."), context: "", keywords: "marker" }] });
    assert.equal((await f.store.search({ query: "marker" })).results.length, 0);
    const unrestricted = new MemoryStore(f.root, []);
    assert.equal((await unrestricted.pending()).pending_count, 6);
    assert.equal((await unrestricted.search({ query: "marker" })).results.length, 1);
    assert.ok((await readFile(join(f.store.historyDirectory, "smoke-command.json"), "utf8")).includes("fixture marker"));
  } finally { await f.cleanup(); }
});

test("retryable rate limits wait only after rejection, then commit the original source once", async () => {
  const f = await reviewFixture();
  try {
    await f.save("old", [{ role: "user", content: "A useful original." }]);
    let calls = 0;
    const waits: number[] = [], payloads: string[] = [];
    const report = await reviewMemories({ tools: f.tools, maxSections: 10, rateLimitRetries: 2, retryDelayMs: 15000,
      wait: async delay => { waits.push(delay); }, provider: { async next(input) {
        payloads.push(input.history[0].content);
        if (++calls < 3) throw new Error("429 Too Many Requests");
        return emptyExtraction();
      } } });
    assert.equal(calls, 3);
    assert.equal(waits.length, 2);
    assert.ok(waits[0] >= 15000 && waits[0] < 16000);
    assert.ok(waits[1] >= 30000 && waits[1] < 31000);
    assert.equal(new Set(payloads).size, 1);
    assert.equal(report.completed, 1);
    assert.equal(report.paused, undefined);
    assert.equal(report.pending, 0);
  } finally { await f.cleanup(); }
});

test("exhausted recovery pauses cleanly with pending progress and healthy requests never wait", async () => {
  const f = await reviewFixture();
  try {
    await f.save("old", [{ role: "user", content: "A useful original." }]);
    let calls = 0, waits = 0;
    const report = await reviewMemories({ tools: f.tools, maxSections: 10, rateLimitRetries: 2,
      wait: async () => { waits++; }, provider: { async next() { calls++; throw new Error("429 Too Many Requests"); } } });
    assert.equal(calls, 3);
    assert.equal(waits, 2);
    assert.equal(report.paused, "rate_limit");
    assert.equal(report.pending, 1);
    assert.equal(report.sections, 0);
    assert.match(memoryReviewSummary(report), /paused.*rate-limiting/);
    waits = 0;
    const resumed = await reviewMemories({ tools: f.tools, maxSections: 10, rateLimitRetries: 2,
      wait: async () => { waits++; }, provider: { async next() { return emptyExtraction(); } } });
    assert.equal(waits, 0);
    assert.equal(resumed.completed, 1);
  } finally { await f.cleanup(); }
});

test("quota/auth failures and invalid output are never retried by memory recovery", async () => {
  const f = await reviewFixture();
  try {
    await f.save("old", [{ role: "user", content: "A useful original." }]);
    assert.equal(retryableMemoryRateLimit(new Error("429 Too Many Requests")), true);
    for (const message of ["429 insufficient_quota", "429 usage limit reached", "401 unauthorized", "connection failed"]) {
      let calls = 0;
      await assert.rejects(reviewMemories({ tools: f.tools, maxSections: 10, rateLimitRetries: 2,
        wait: async () => { throw new Error("Unexpected wait"); }, provider: { async next() { calls++; throw new Error(message); } } }));
      assert.equal(calls, 1);
    }
    await assert.rejects(reviewMemories({ tools: f.tools, maxSections: 10, rateLimitRetries: 2,
      wait: async () => { throw new Error("Unexpected wait"); }, provider: { async next() { return { kind: "reply", message: "bad JSON" }; } } }));
    assert.equal((await f.tools.memories.pending()).pending_count, 1);
  } finally { await f.cleanup(); }
});

test("fixture and recovery configuration validates explicit controls", () => {
  assert.equal(parseConfig({ memory: {} }).memory?.rate_limit_retries, 2);
  assert.equal(parseConfig({ memory: {} }).memory?.retry_delay_seconds, 15);
  assert.deepEqual(parseConfig({ memory: { excluded_session_prefixes: [], rate_limit_retries: 0 } }).memory?.excluded_session_prefixes, []);
  for (const memory of [{ rate_limit_retries: 4 }, { retry_delay_seconds: 0 }, { retry_delay_seconds: 61 }, { excluded_session_prefixes: "smoke" }, { excluded_session_prefixes: ["../bad"] }]) assert.throws(() => parseConfig({ memory }));
});
