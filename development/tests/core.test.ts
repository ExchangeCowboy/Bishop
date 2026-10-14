import assert from "node:assert/strict";
import "./memory.test.ts";
import "./installer.test.ts";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, utimes, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent } from "../../app/agent.ts";
import { ConsoleUI } from "../../app/console.ts";
import { activityLine, activityBlock, displayWidth, fitLine } from "../../app/terminal-layout.ts";
import { ConsoleDock, inputViewport, sessionStatus } from "../../app/console-dock.ts";
import { ConsoleInput } from "../../app/console-input.ts";
import { Skills } from "../../app/skills.ts";
import { Tools } from "../../tools/index.ts";
import { runProcess } from "../../app/process.ts";
import { parseAction, codexFailure, requireChatGPTLogin } from "../../app/providers/codex.ts";
import { Sessions } from "../../app/session.ts";
import { findCodex } from "../../app/providers/codex-path.ts";
import type { Action, Entry, Event, Provider } from "../../app/types.ts";
import { CONTEXT_LIMIT, WorkingContext, contextSize } from "../../app/context.ts";
import { loadConfig, parseConfig, TOOL_NAMES } from "../../app/config.ts";
import { loadPersonality } from "../../app/personality.ts";
import { loadGuidance, loadHarness, renderHarness } from "../../app/harness.ts";
import { updateSoul } from "../../tools/update-soul.ts";
import { parseSearchResults, webSearch, type SearchFetch } from "../../tools/web-search.ts";
import { DEFAULT_SEARCH_SETTINGS } from "../../app/config.ts";
import { updateMemory } from "../../tools/update-memory.ts";
import { applyPatch } from "../../tools/apply-patch.ts";
import { codexUsage, usageSummary } from "../../app/usage.ts";
import { extractPage, webRead } from "../../tools/web-read.ts";
import { DEFAULT_WEB_READ_SETTINGS } from "../../app/config.ts";
import { searchHistory } from "../../tools/search-history.ts";

test("Codex prerequisite checks ChatGPT login without inference or credential diagnostics", async () => {
  const result = { stdout: "", stderr: "Logged in using ChatGPT", exitCode: 0, signal: null, timedOut: false, truncated: false };
  let calls = 0;
  await requireChatGPTLogin("fake-codex", async (executable, args, options) => {
    calls++;
    assert.equal(executable, "fake-codex");
    assert.deepEqual(args, ["login", "status"]);
    assert.equal(options.env?.OPENAI_API_KEY, undefined);
    assert.equal(options.env?.CODEX_API_KEY, undefined);
    return result;
  });
  assert.equal(calls, 1);
  for (const failure of [
    { ...result, stderr: "Logged in using API key: private-value" },
    { ...result, exitCode: 1 },
    { ...result, timedOut: true },
  ]) {
    await assert.rejects(requireChatGPTLogin("fake-codex", async () => failure), error => {
      assert.match(String(error), /Open Codex and sign in/);
      assert.doesNotMatch(String(error), /private-value/);
      return true;
    });
  }
});

test("CLI connection failures exit before session writes or onboarding changes", async () => {
  const configBefore = await readFile("config/bishop.toml", "utf8");
  const sessions = async () => readdir("memory/history").catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const sessionsBefore = await sessions();
  // Node is an executable that rejects Codex's login command, without network access.
  const result = await runProcess(process.execPath, ["app/cli.ts"], {
    cwd: process.cwd(), env: { ...process.env, BISHOP_CODEX_BIN: process.execPath },
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Bishop requires Codex signed in with ChatGPT/);
  assert.equal(await readFile("config/bishop.toml", "utf8"), configBefore);
  assert.deepEqual(await sessions(), sessionsBefore);
});

test("Codex diagnostics expose stdout rate limits with empty stderr and tolerate truncated events", () => {
  const result = { stdout: '{"type":"error","message":"exceeded retry limit, last status: 429 Too Many Requests"}\n{"type":"turn.failed","error":{"message":"429 Too Many Requests"}}\n{"type":',
    stderr: "", exitCode: 1, signal: null, timedOut: false, truncated: true };
  const message = codexFailure(result);
  assert.match(message, /429 Too Many Requests/);
  assert.match(message, /rate limit/);
  assert.match(message, /earlier tool actions may have completed/);
  assert.doesNotMatch(message, /login status|CLI compatibility/);
});

test("Codex diagnostics preserve other causes, bound output and redact credential patterns", () => {
  const base = { stdout: "", stderr: "", exitCode: 1, signal: null, timedOut: false, truncated: false };
  assert.match(codexFailure(base), /cause is unknown/);
  const stderr = codexFailure({ ...base, stderr: 'Connection failed Bearer secret-token access_token="secret-value" sk-secretkey' });
  assert.match(stderr, /Connection failed/);
  assert.doesNotMatch(stderr, /secret-token|secret-value|sk-secretkey/);
  assert.doesNotMatch(stderr, /service reported a rate limit/);
  const stdout = codexFailure({ ...base, stdout: '{"type":"turn.failed","error":{"message":"Unsupported model"}}' });
  assert.match(stdout, /Unsupported model/);
  assert.ok(codexFailure({ ...base, stderr: "x".repeat(20000) }).length < 3000);
});

test("history search retrieves saved replies with bounded excerpts and stable pagination", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "memory", "history");
    const sessions = new Sessions(directory);
    await sessions.save("alpha", [
      { role: "user", content: "Discuss Bishop [plans]." },
      { role: "assistant", content: "x".repeat(900) + "BISHOP [plans] agreed." },
      { role: "assistant", content: JSON.stringify({ kind: "tool", tool: "run_command", arguments: { command: "Bishop [plans]" } }) },
      { role: "tool", content: "Bishop [plans] execution record" },
    ]);
    await sessions.save("beta", [{ role: "user", content: "Bishop [plans] again." }]);
    await writeFile(join(directory, "alpha.usage.json"), "not a transcript");
    const first = await searchHistory(directory, { query: "bishop [plans]", limit: 1 });
    assert.equal(first.total_matches, 3);
    assert.equal(first.scanned_sessions, 2);
    assert.equal(first.next_offset, 1);
    assert.equal(first.results[0]?.source, "memory/history/alpha.json");
    const second = await searchHistory(directory, { query: first.query, offset: first.next_offset, limit: 1 });
    assert.equal(second.results[0]?.entry_index, 1);
    assert.match(second.results[0]!.excerpt, /BISHOP \[plans\]/);
    assert.ok(second.results[0]!.excerpt.length <= 601);
    assert.equal(second.results[0]?.truncated, true);
    assert.equal((await searchHistory(directory, { query: "Bishop", session: "beta" })).total_matches, 1);
    assert.equal((await searchHistory(directory, { query: "absent" })).total_matches, 0);
    assert.deepEqual((await sessions.start("fresh")).history, []);
  } finally { await f.cleanup(); }
});

test("history search reports corrupt and oversized files and validates inputs", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "history");
    assert.equal((await searchHistory(directory, { query: "test" })).scanned_sessions, 0);
    await mkdir(directory);
    await writeFile(join(directory, "broken.json"), "{invalid");
    await writeFile(join(directory, "invalid.json"), '[{"role":"user","content":3}]');
    await writeFile(join(directory, "large.json"), "x".repeat(10_000_001));
    await new Sessions(directory).save("good", [{ role: "user", content: "test" }]);
    const result = await searchHistory(directory, { query: "test" });
    assert.equal(result.total_matches, 1);
    assert.equal(result.skipped_sessions, 3);
    assert.equal(result.incomplete, true);
    assert.equal(result.skipped.length, 3);
    for (const args of [{ query: "" }, { query: "x".repeat(501) }, { query: "test", session: "../good" }, { query: "test", offset: -1 }, { query: "test", offset: null }, { query: "test", limit: 21 }, { query: "test", extra: true }]) await assert.rejects(searchHistory(directory, args));
  } finally { await f.cleanup(); }
});

test("agent can retrieve prior conversations independent of command cwd and respect disable switch", async () => {
  const f = await fixture();
  try {
    await new Sessions(join(f.root, "memory", "history")).save("old", [{ role: "assistant", content: "We chose local transcripts." }]);
    const tools = new Tools({ skills: f.skills, cwd: tmpdir() });
    let calls = 0;
    const provider: Provider = { async next(input) {
      if (calls++ === 0) {
        assert.ok(input.tools.some(tool => tool.name === "search_history"));
        assert.equal(input.history.length, 1);
        return { kind: "tool", tool: "search_history", arguments: { query: "transcripts" } };
      }
      const evidence = JSON.parse(input.history.at(-1)!.content);
      assert.equal(evidence.data.results[0].session, "old");
      return { kind: "reply", message: "We chose local transcripts (old, entry 0)." };
    } };
    const agent = new Agent({ provider, tools, personality: "Test." });
    assert.match(await agent.run("What did we choose?"), /local transcripts/);
    const disabled = new Tools({ skills: f.skills, cwd: f.root, settings: { search_history: false } });
    assert.ok(!disabled.specs().some(tool => tool.name === "search_history"));
    assert.equal((await disabled.execute("search_history", { query: "transcripts" })).ok, false);
    assert.equal((await tools.execute("search_history", { query: "transcripts", session: "../../other" })).ok, false);
    assert.equal(parseConfig({ tools: { search_history: false } }).tools.search_history, false);
  } finally { await f.cleanup(); }
});

test("page reading settings validate limits and preserve defaults", () => {
  assert.deepEqual(parseConfig({ web_read: {} }).web_read, DEFAULT_WEB_READ_SETTINGS);
  assert.equal(parseConfig({ web_read: { max_characters: 500 } }).web_read?.max_characters, 500);
  for (const web_read of [null, [], { other: true }, { toString: 1 }, { timeout_ms: 60001 }, { max_bytes: 0 }, { max_bytes: 5000001 }, { max_characters: 50001 }, { link_limit: 101 }, { timeout_ms: 0.5 }, { link_limit: "30" }]) assert.throws(() => parseConfig({ web_read }));
});

const articleHtml = `<html><head><title>Fixture guide</title></head><body><nav>MENU NOISE</nav><article><h1>Fixture guide</h1>
${Array.from({ length: 6 }, (_, i) => `<p>Section ${i}. This guide explains the concrete steps for installing and using a useful application, with examples and detailed explanations. <a href="/docs/${i}">Documentation ${i}</a></p>`).join('')}
<pre>first line\n  second line</pre><script>globalThis.bishopPageScriptRan = true</script><aside>AD NOISE</aside><footer>FOOTER NOISE</footer></article></body></html>`;

test("page extraction removes noise, preserves blocks, resolves and bounds content links", () => {
  const page = extractPage(articleHtml, "https://example.com/guide", 2);
  assert.equal(page.extraction, "readability");
  assert.equal(page.title, "Fixture guide");
  assert.match(page.text, /Section 0/);
  assert.match(page.text, /first line\n  second line/);
  assert.doesNotMatch(page.text, /MENU NOISE|AD NOISE|FOOTER NOISE|bishopPageScriptRan/);
  assert.equal(page.links.length, 2);
  assert.equal(page.links[0]?.url, "https://example.com/docs/0");
  assert.equal(page.links_truncated, true);
  const fallback = extractPage('<title>Short page</title><main><p>Hello &amp; welcome.</p><a href="javascript:alert(1)">Bad link</a></main>', "https://example.com/", 30);
  assert.match(fallback.text, /Hello & welcome/);
  assert.equal(fallback.links.length, 0);
});

test("page reading follows bounded redirects, rejects unsafe URLs, and continues bounded text", async () => {
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(options?.redirect, "manual");
    if (String(url) === "https://example.com/start") return new Response(null, { status: 302, headers: { location: "/final" } });
    return htmlResponse(articleHtml);
  };
  const settings = { ...DEFAULT_WEB_READ_SETTINGS, max_characters: 100 };
  const first = await webRead("https://example.com/start", settings, request);
  assert.equal(first.ok, true);
  const data = first.data as { text: string; url: string; truncated: boolean; next_offset: number };
  assert.equal(data.url, "https://example.com/final");
  assert.equal(data.text.length, 100);
  assert.equal(data.truncated, true);
  const second = await webRead(data.url, settings, request, data.next_offset);
  assert.equal(second.ok, true);
  assert.equal((second.data as { offset: number }).offset, 100);
  assert.equal(calls, 3);
  for (const url of ["file:///secret", "ftp://example.com/", "https://user:password@example.com/", "not a url", "https://example.com/" + "a".repeat(4096)]) assert.equal((await webRead(url, settings, request)).ok, false);
  assert.equal(calls, 3);
  assert.match((await webRead("https://example.com/", settings, async () => new Response(null, { status: 302, headers: { location: "file:///secret" } }))).error!, /HTTP or HTTPS/);
  assert.match((await webRead("https://example.com/", settings, async () => new Response(null, { status: 302, headers: { location: "/loop" } }))).error!, /redirect limit/);
  assert.equal((await webRead(data.url, settings, request, 99999)).ok, false);
});

test("page reading handles plain text, HTTP errors, unsupported content, challenges and byte caps", async () => {
  const plain = await webRead("https://example.com/", undefined, async () => new Response("Useful text", { headers: { "content-type": "text/plain" } }));
  assert.equal(plain.ok, true);
  assert.equal((plain.data as { text: string }).text, "Useful text");
  for (const status of [202, 401, 403, 429, 500]) assert.match((await webRead("https://example.com/", undefined, async () => htmlResponse("blocked", status))).error!, new RegExp(String(status)));
  for (const response of [new Response("pdf", { headers: { "content-type": "application/pdf" } }), htmlResponse('<title>Just a moment...</title><p>Checking your browser</p>'), htmlResponse('<main>Enable JavaScript to continue</main>'), htmlResponse('<script>document.write("Content")</script>'), htmlResponse("")]) assert.equal((await webRead("https://example.com/", undefined, async () => response)).ok, false);
  assert.match((await webRead("https://example.com/", { ...DEFAULT_WEB_READ_SETTINGS, max_bytes: 10 }, async () => htmlResponse(articleHtml))).error!, /byte limit/);
  assert.match((await webRead("https://example.com/", undefined, async () => { throw new Error("Network unavailable"); })).error!, /Network unavailable/);
  const unicode = await webRead("https://example.com/", { ...DEFAULT_WEB_READ_SETTINGS, max_characters: 3 }, async () => new Response("ab😀cd", { headers: { "content-type": "text/plain" } }));
  assert.equal((unicode.data as { text: string }).text, "ab");
});

test("page timeout covers connection and streamed body", async () => {
  const settings = { ...DEFAULT_WEB_READ_SETTINGS, timeout_ms: 10 };
  const waiting: typeof fetch = async (_, options) => new Promise((_, reject) => { options!.signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }); });
  assert.match((await webRead("https://example.com/", settings, waiting)).error!, /timed out/);
  const streaming: typeof fetch = async (_, options) => new Response(new ReadableStream({ start(controller) { options!.signal!.addEventListener("abort", () => controller.error(new Error("Aborted")), { once: true }); } }), { headers: { "content-type": "text/html" } });
  assert.match((await webRead("https://example.com/", settings, streaming)).error!, /timed out/);
});

test("page dispatch returns evidence to the model and enforces arguments and disable switch", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const request: typeof fetch = async () => { calls++; return htmlResponse(articleHtml); };
    const tools = new Tools({ skills: f.skills, cwd: f.root, webReadFetch: request });
    assert.ok(tools.specs().some(tool => tool.name === "web_read"));
    let decisions = 0;
    const provider: Provider = { async next(input) {
      if (decisions++ === 0) return { kind: "tool", tool: "web_read", arguments: { url: "https://example.com/" } };
      assert.match(JSON.stringify(input.history), /Section 0/);
      return { kind: "reply", message: "Read the source." };
    } };
    assert.equal(await new Agent({ provider, tools, personality: "Test." }).run("Read"), "Read the source.");
    for (const args of [{ url: "https://example.com/", offset: -1 }, { url: "https://example.com/", offset: "0" }, { url: "https://example.com/", offset: null }, { url: "https://example.com/", extra: true }, { url: "" }]) assert.equal((await tools.execute("web_read", args)).ok, false);
    const disabled = new Tools({ skills: f.skills, cwd: f.root, settings: { web_read: false }, webReadFetch: request });
    assert.ok(!disabled.specs().some(tool => tool.name === "web_read"));
    assert.equal((await disabled.execute("web_read", { url: "https://example.com/" })).ok, false);
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("usage reads provider counts without estimating missing or invalid tokens", () => {
  assert.deepEqual(codexUsage({ input_tokens: 100, cached_input_tokens: 60, output_tokens: 0 }), { input: 100, cachedInput: 60, output: 0 });
  assert.deepEqual(codexUsage(undefined), { input: null, cachedInput: null, output: null });
  assert.deepEqual(codexUsage({ input_tokens: -1, cached_input_tokens: "12", output_tokens: 1.5 }), { input: null, cachedInput: null, output: null });
  assert.deepEqual(codexUsage({ input_tokens: Number.MAX_SAFE_INTEGER + 1 }), { input: null, cachedInput: null, output: null });
});

test("per-run usage separates compaction retries, saves beside transcripts, and resets", async () => {
  const f = await fixture();
  try {
    let summaries = 0;
    const provider: Provider = { async next(input) {
      if (input.mode === "compaction") {
        summaries++;
        input.onUsage?.({ input: 200, cachedInput: 100, output: 10 });
        return { kind: "reply", message: summaries === 1 ? "" : "Earlier exchanges summarized." };
      }
      input.onUsage?.({ input: 100, cachedInput: 60, output: 20 });
      return { kind: "reply", message: "Done." };
    } };
    const history: Entry[] = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(9000) }));
    const agent = new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root }), personality: "Test.", history, compactAt: 16000 });
    assert.equal(await agent.run("Continue."), "Done.");
    const run = agent.runs[0];
    assert.equal(run.failed, false);
    assert.ok(run.elapsedMs >= 0);
    assert.ok(!Number.isNaN(Date.parse(run.startedAt)));
    assert.ok(summaries >= 2);
    assert.equal(run.calls.filter(call => call.mode === "compaction").length, summaries);
    assert.equal(run.calls.filter(call => call.mode === "decision").length, 1);
    assert.ok(run.calls.every(call => call.elapsedMs >= 0 && !call.failed));
    const summary = usageSummary(agent.runs);
    assert.ok(summary.includes("input 100, cached 60, output 20"));
    assert.ok(summary.includes(`Compaction: ${summaries} calls`));
    assert.ok(summary.includes("included in input totals"));
    const sessions = new Sessions(join(f.root, "history"));
    await sessions.save("usage-test", agent.history, agent.runs);
    assert.deepEqual(await sessions.load("usage-test"), agent.history);
    const saved = JSON.parse(await readFile(join(f.root, "history", "usage-test.usage.json"), "utf8"));
    assert.equal(saved.cachedInputIncludedInInput, true);
    assert.deepEqual(saved.runs, agent.runs);
    agent.resetConversation();
    assert.deepEqual(agent.runs, []);
    assert.equal(usageSummary(agent.runs), "No runs yet.");
  } finally { await f.cleanup(); }
});

test("usage retains failed calls and keeps incomplete totals unknown", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const provider: Provider = { async next(input) {
      calls++;
      if (calls === 1) {
        input.onUsage?.({ input: 100, cachedInput: null, output: 0 });
        return { kind: "tool", tool: "load_skill", arguments: { name: "command-runner-use" } };
      }
      throw new Error("Fake provider failed.");
    } };
    const agent = new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root }), personality: "Test." });
    await assert.rejects(agent.run("Go."), /Fake provider failed/);
    assert.equal(agent.runs[0].failed, true);
    assert.equal(agent.runs[0].calls.length, 2);
    assert.equal(agent.runs[0].calls[0].output, 0);
    assert.equal(agent.runs[0].calls[1].input, null);
    assert.equal(agent.runs[0].calls[1].failed, true);
    assert.ok(usageSummary(agent.runs).includes("input unknown, cached unknown, output unknown"));
    agent.provider = { async next() { return { kind: "reply", message: "Recovered." }; } };
    await agent.run("Retry.");
    assert.equal(agent.runs.length, 2);
    assert.equal(agent.runs[1].calls.length, 1);
    assert.equal(agent.runs[1].failed, false);
    assert.ok(usageSummary(agent.runs).includes("Compaction: 0 calls"));
    const original = process.stdout.write;
    let output = "";
    const ui = new ConsoleUI(false);
    process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
    try { ui.usage(agent.runs); ui.help(); } finally { process.stdout.write = original; ui.stop(); }
    assert.ok(output.includes("Latest run:"));
    assert.ok(output.includes("/usage"));
    assert.equal(calls, 2);
  } finally { await f.cleanup(); }
});

const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

test("patches add, update multiple exact hunks, and delete files with compact results", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    assert.ok(tools.specs().some(tool => tool.name === "apply_patch"));
    assert.equal((await tools.execute("apply_patch", { patch: patch("*** Add File: nested/example.txt\n+first\n+middle\n+last") })).ok, true);
    assert.equal((await tools.execute("apply_patch", { patch: patch("*** Update File: nested/example.txt\n@@\n-first\n+FIRST\n middle\n@@\n-last\n+LAST\n*** End of File") })).ok, true);
    assert.equal(await readFile(join(f.root, "nested/example.txt"), "utf8"), "FIRST\nmiddle\nLAST\n");
    const deleted = await tools.execute("apply_patch", { patch: patch("*** Delete File: nested/example.txt") });
    assert.deepEqual(deleted, { ok: true, data: { files: [{ path: join("nested", "example.txt"), operation: "delete" }] } });
    assert.deepEqual(await readdir(join(f.root, "nested")), []);
  } finally { await f.cleanup(); }
});

test("invalid or ambiguous patches reject the entire batch before changing any file", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "old.txt"), "same\nsame\n");
    for (const body of [
      "*** Add File: new.txt\n+new\n*** Update File: old.txt\n@@\n-absent\n+new",
      "*** Update File: old.txt\n@@\n-same\n+changed",
      "*** Add File: old.txt\n+overwrite",
      "*** Update File: missing.txt\n@@\n-old\n+new",
      "*** Add File: new.txt\n+new\n*** Delete File: new.txt",
      "*** Update File: old.txt\n@@\n+unanchored",
      "*** Add File: new.txt\nmalformed",
      "*** Update File: old.txt\n@@ symbol\n-same\n+changed",
    ]) {
      const result = await applyPatch(patch(body), f.root);
      assert.equal(result.ok, false);
      assert.deepEqual(result.data, { files: [] });
      assert.equal(await readFile(join(f.root, "old.txt"), "utf8"), "same\nsame\n");
      await assert.rejects(readFile(join(f.root, "new.txt")), /ENOENT/);
    }
    assert.equal((await applyPatch("invalid", f.root)).ok, false);
    assert.equal((await applyPatch("x".repeat(100001), f.root)).ok, false);
  } finally { await f.cleanup(); }
});

test("patch updates preserve Unicode, BOM, CRLF, and absent final newlines", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "unicode.txt"), "\uFEFFfirst\r\n世界 😀\r\nlast");
    assert.equal((await applyPatch(patch("*** Update File: unicode.txt\n@@\n first\n-世界 😀\n+世界 🌟\n last"), f.root)).ok, true);
    assert.equal(await readFile(join(f.root, "unicode.txt"), "utf8"), "\uFEFFfirst\r\n世界 🌟\r\nlast");
    assert.deepEqual((await readdir(f.root)).filter(name => name.includes("bishop-patch")), []);
    for (const text of ["a\r\nb\n", "a\0b", Buffer.from([0xff, 0xfe])]) {
      await writeFile(join(f.root, "unsupported.txt"), text);
      const before = await readFile(join(f.root, "unsupported.txt"));
      assert.equal((await applyPatch(patch("*** Update File: unsupported.txt\n@@\n-a\n+new"), f.root)).ok, false);
      assert.deepEqual(await readFile(join(f.root, "unsupported.txt")), before);
    }
  } finally { await f.cleanup(); }
});

test("patch dispatch validates arguments, disabled tools, and dedicated skill and personality targets", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    for (const args of [{}, { patch: "" }, { patch: 1 }, { patch: "test", other: true }]) assert.equal((await tools.execute("apply_patch", args)).ok, false);
    for (const path of ["config/personality/soul.md", "config/personality/memory.md", "skills/new/SKILL.md", "../escape.txt"]) {
      assert.equal((await tools.execute("apply_patch", { patch: patch(`*** Add File: ${path}\n+new`) })).ok, false, path);
    }
    const disabled = new Tools({ skills: f.skills, cwd: f.root, settings: { apply_patch: false } });
    assert.ok(!disabled.specs().some(tool => tool.name === "apply_patch"));
    assert.equal((await disabled.execute("apply_patch", { patch: patch("*** Add File: new.txt\n+new") })).ok, false);
    await assert.rejects(readFile(join(f.root, "new.txt")), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("patches reject directory links and report completed files on a later write failure", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "real"));
    await symlink(join(f.root, "real"), join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    assert.equal((await applyPatch(patch("*** Add File: linked/file.txt\n+new"), f.root)).ok, false);
    assert.deepEqual(await readdir(join(f.root, "real")), []);
    const result = await applyPatch(patch("*** Add File: parent\n+file\n*** Add File: parent/child.txt\n+new"), f.root);
    assert.equal(result.ok, false);
    assert.deepEqual(result.data, { files: [{ path: "parent", operation: "add" }] });
    assert.match(result.error!, /partial changes/);
  } finally { await f.cleanup(); }
});

test("the agent edits through apply_patch and receives compact evidence without a shell call", async () => {
  const f = await fixture();
  try {
    let decisions = 0;
    const events: Event[] = [];
    const provider: Provider = { async next(input) {
      assert.ok(input.instructions.includes(`Node executable: ${process.execPath}`));
      if (decisions++ === 0) return { kind: "tool", tool: "apply_patch", arguments: { patch: patch("*** Add File: example.txt\n+done") } };
      assert.deepEqual(JSON.parse(input.history.at(-1)!.content), { name: "apply_patch", ok: true, data: { files: [{ path: "example.txt", operation: "add" }] } });
      return { kind: "reply", message: "Edited." };
    } };
    assert.equal(await new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root }), personality: "Test.", onEvent: event => events.push(event) }).run("Edit"), "Edited.");
    assert.equal(await readFile(join(f.root, "example.txt"), "utf8"), "done\n");
    assert.equal(events.filter(event => event.type === "tool_requested").length, 1);
    assert.ok(!events.some(event => event.type !== "context_compaction" && event.name === "run_command"));
  } finally { await f.cleanup(); }
});

test("full patch guide is delivered on demand while normal requests carry only compact tool syntax", async () => {
  const f = await fixture();
  try {
    const guide = await new Skills("skills", "skills/.revisions").load("apply-patch-use");
    await f.skills.save(guide.name, guide.description, guide.content.replace(/^---[\s\S]*?---\s*/, ""));
    const harness = await loadHarness("config/harness.md");
    let decisions = 0;
    const provider: Provider = { async next(input) {
      const rendered = renderHarness(harness, input);
      if (decisions++ === 0) {
        assert.doesNotMatch(rendered, /Example patch value|const count = 1/);
        assert.match(rendered, /apply-patch-use/);
        assert.match(rendered, /bare @@ hunks/);
        return { kind: "tool", tool: "load_skill", arguments: { name: "apply-patch-use" } };
      }
      assert.match(rendered, /Example patch value/);
      if (decisions === 2) return { kind: "tool", tool: "apply_patch", arguments: { patch: patch("*** Add File: reference.txt\n+done") } };
      return { kind: "reply", message: "Edited with the reference." };
    } };
    assert.equal(await new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root }), personality: "Test." }).run("Edit a file"), "Edited with the reference.");
    assert.equal(await readFile(join(f.root, "reference.txt"), "utf8"), "done\n");
  } finally { await f.cleanup(); }
});

const searchHtml = `<html><div class="result result--ad"><a class="result__a" href="https://ads.example/">Ad</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2&amp;rut=x">Example &amp; <b>docs</b></a><a class="result__snippet">Useful <b>reference</b> &quot;here&quot;.</a></div>
<div class="result"><a class="result__a" href="https://example.com/?a=1&amp;b=2">Duplicate</a></div>
<div class="result"><a class="result__a" href="javascript:alert(1)">Bad URL</a></div>
<div class="result"><a class="result__a" href="https://other.example/">Other result</a><div class="result__snippet">Second source.</div></div></html>`;
const htmlResponse = (html = searchHtml, status = 200) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });

test("search settings validate and preserve enabled defaults", () => {
  assert.deepEqual(parseConfig({ search: {} }).search, DEFAULT_SEARCH_SETTINGS);
  assert.deepEqual(parseConfig({ search: { result_limit: 2, timeout_ms: 1000 } }).search, { ...DEFAULT_SEARCH_SETTINGS, result_limit: 2, timeout_ms: 1000 });
  for (const search of [null, [], { provider: "brave" }, { result_limit: 0 }, { result_limit: 11 }, { result_limit: 1.5 }, { timeout_ms: 0 }, { timeout_ms: 60001 }, { timeout_ms: "15000" }, { other: true }, { toString: true }]) {
    assert.throws(() => parseConfig({ search }));
  }
});

test("DDG parsing decodes markup and destination links, excludes ads, and deduplicates", () => {
  assert.deepEqual(parseSearchResults(searchHtml, 5), [
    { title: "Example & docs", url: "https://example.com/?a=1&b=2", snippet: 'Useful reference "here".' },
    { title: "Other result", url: "https://other.example/", snippet: "Second source." },
  ]);
  assert.equal(parseSearchResults(searchHtml, 1).length, 1);
  assert.deepEqual(parseSearchResults('<div class="no-results">No results found.</div>', 5), []);
  assert.throws(() => parseSearchResults('<form id="challenge-form"></form>', 5), /challenge/);
  assert.throws(() => parseSearchResults('<form id="anomaly-form"></form>', 5), /challenge/);
  assert.throws(() => parseSearchResults('<html>Unexpected page</html>', 5), /unrecognized/);
});

test("search dispatch passes evidence back to the model and enforces permissions and arguments", async () => {
  const f = await fixture();
  try {
    let requests = 0;
    const request: SearchFetch = async (url, options) => {
      requests++;
      assert.equal(new URL(String(url)).searchParams.get("q"), "test & query");
      assert.ok(options?.signal);
      return htmlResponse();
    };
    const tools = new Tools({ skills: f.skills, cwd: f.root, searchFetch: request });
    assert.ok(tools.specs().some(tool => tool.name === "web_search"));
    let decisions = 0;
    const provider: Provider = { async next(input) {
      if (decisions++ === 0) return { kind: "tool", tool: "web_search", arguments: { query: "test & query" } };
      const evidence = JSON.parse(input.history.at(-1)!.content);
      assert.equal(evidence.ok, true);
      assert.equal(evidence.data.results[0].url, "https://example.com/?a=1&b=2");
      return { kind: "reply", message: "Found a source." };
    } };
    assert.equal(await new Agent({ provider, tools, personality: "Test." }).run("Search"), "Found a source.");
    for (const args of [{}, { query: "" }, { query: 1 }, { query: "x", other: true }, { query: "x".repeat(501) }]) {
      assert.equal((await tools.execute("web_search", args)).ok, false);
    }
    const disabled = new Tools({ skills: f.skills, cwd: f.root, settings: { web_search: false }, searchFetch: request });
    assert.ok(!disabled.specs().some(tool => tool.name === "web_search"));
    assert.equal((await disabled.execute("web_search", { query: "test" })).ok, false);
    assert.equal(requests, 1);
  } finally { await f.cleanup(); }
});

test("search distinguishes HTTP failures, challenges, no results, malformed content, and size limits", async () => {
  for (const status of [202, 403, 429, 500]) {
    const result = await webSearch("test", undefined, async () => htmlResponse("blocked", status));
    assert.equal(result.ok, false);
    assert.match(result.error!, new RegExp(String(status)));
  }
  for (const response of [htmlResponse('<div class="anomaly-modal">Challenge</div>'), htmlResponse("bad page"), htmlResponse("x".repeat(1_000_001)), new Response("{}", { headers: { "content-type": "application/json" } })]) {
    assert.equal((await webSearch("test", undefined, async () => response)).ok, false);
  }
  assert.equal((await webSearch("test", undefined, async () => htmlResponse('<div class="no-results">No results.</div>'))).ok, true);
  assert.match((await webSearch("test", undefined, async () => { throw new Error("Network unavailable"); })).error!, /Network unavailable/);
});

test("search timeout covers connection and streamed response body", async () => {
  const settings = { ...DEFAULT_SEARCH_SETTINGS, timeout_ms: 10 };
  const waiting: SearchFetch = async (_, options) => new Promise((_, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  });
  assert.match((await webSearch("test", settings, waiting)).error!, /timed out/);
  const streaming: SearchFetch = async (_, options) => new Response(new ReadableStream({
    start(controller) { options!.signal!.addEventListener("abort", () => controller.error(new Error("Aborted")), { once: true }); },
  }), { headers: { "content-type": "text/html" } });
  assert.match((await webSearch("test", settings, streaming)).error!, /timed out/);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bishop-test-"));
  const skills = new Skills(join(root, "skills"), join(root, "revisions"));
  await skills.save("command-runner-use", "Shell result interpretation.", "Read exit status before reporting success.");
  return { root, skills, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const print = process.platform === "win32" ? "Write-Output 'bishop-test-ok'" : "printf '%s\\n' 'bishop-test-ok'";

test("memory writes enforce Unicode budget, preserve rejected drafts, and allow clearing", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    const file = join(directory, "memory.md");
    const draft = "😀".repeat(3998);
    assert.deepEqual(await updateMemory(file, draft), { saved: true, characters: 3999 });
    const before = await readFile(file, "utf8");
    assert.equal((await updateMemory(file, draft)).saved, false);
    await assert.rejects(updateMemory(file, "😀".repeat(3999)), /under 4,000/);
    await assert.rejects(updateMemory(file, "   "), /nonempty/);
    assert.equal(await readFile(file, "utf8"), before);
    assert.deepEqual(await readdir(directory), ["memory.md"]);
    await updateMemory(file, "# Memory\r\n\r\n- Prefer metric units.\r\n");
    assert.equal(await readFile(file, "utf8"), "# Memory\n\n- Prefer metric units.\n");
    await updateMemory(file, "# Memory");
    assert.equal(await readFile(file, "utf8"), "# Memory\n");
    await writeFile(file, "x".repeat(4000));
    await assert.rejects(loadPersonality(directory), /under 4,000/);
    await assert.rejects(updateMemory(join(f.root, "missing", "memory.md"), "# Memory"));
  } finally { await f.cleanup(); }
});

test("memory dispatch reloads immediately and persists across fresh chats without old history", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "bishop.md"), "Identity.");
    await writeFile(join(directory, "soul.md"), "# Soul\nCharacter.\n");
    await writeFile(join(directory, "memory.md"), "# Memory\n- Keep unrelated fact.\n");
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    let decisions = 0;
    const provider: Provider = { async next(input) {
      assert.match(input.instructions, /Keep unrelated fact/);
      if (decisions++ === 0) return { kind: "tool", tool: "update_memory", arguments: { content: "# Memory\n- Keep unrelated fact.\n- Prefer metric units." } };
      assert.match(input.instructions, /Prefer metric units/);
      assert.equal(JSON.parse(input.history.at(-1)!.content).ok, true);
      return { kind: "reply", message: "Remembered metric units." };
    } };
    const agent = new Agent({ provider, tools, personality: await loadPersonality(directory), refreshPersonality: () => loadPersonality(directory) });
    assert.equal(await agent.run("Remember my preference for metric units."), "Remembered metric units.");
    const recall: Provider = { async next(input) {
      assert.match(input.instructions, /Prefer metric units/);
      assert.deepEqual(input.history, [{ role: "user", content: "Hello" }]);
      return { kind: "reply", message: "Metric preference available." };
    } };
    const fresh = new Agent({ provider: recall, tools: new Tools({ skills: f.skills, cwd: f.root }), personality: await loadPersonality(directory) });
    assert.deepEqual(fresh.history, []);
    assert.equal(await fresh.run("Hello"), "Metric preference available.");
    const disabled = new Tools({ skills: f.skills, cwd: f.root, settings: { update_memory: false } });
    assert.ok(!disabled.specs().some(tool => tool.name === "update_memory"));
    assert.equal((await disabled.execute("update_memory", { content: "# Memory" })).ok, false);
    for (const args of [{}, { content: "" }, { content: 1 }, { content: "# Memory", path: "other.md" }]) {
      assert.equal((await tools.execute("update_memory", args)).ok, false);
    }
    assert.match(await readFile(join(directory, "memory.md"), "utf8"), /Prefer metric units/);
    assert.equal(await readFile(join(directory, "soul.md"), "utf8"), "# Soul\nCharacter.\n");
    await tools.execute("update_memory", { content: "# Memory\n- Keep unrelated fact.\n- Prefer imperial units." });
    const corrected = await loadPersonality(directory);
    assert.match(corrected, /Prefer imperial units/);
    assert.doesNotMatch(corrected, /Prefer metric units/);
    await tools.execute("update_memory", { content: "# Memory\n- Keep unrelated fact." });
    assert.doesNotMatch(await loadPersonality(directory), /Prefer imperial units/);
  } finally { await f.cleanup(); }
});

test("first-run settings accept booleans and reject ambiguous values", () => {
  for (const first_run of [true, false]) assert.equal(parseConfig({ onboarding: { first_run } }).onboarding?.first_run, first_run);
  for (const onboarding of [null, {}, { first_run: 1 }, { first_run: "false" }, { firstrun: true }, { first_run: true, other: false }]) {
    assert.throws(() => parseConfig({ onboarding }));
  }
});

test("first run delivers onboarding before inference, saves confirmed context, and stops repeating", async () => {
  const f = await fixture();
  try {
    await f.skills.save("personal-onboarding", "Personal setup.", "Ask for a name; save agreed preferences.");
    await f.skills.save("bishop-core-profiler", "Refine the soul.", "Consolidate enduring character and personal context.");
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "bishop.md"), "Base identity.");
    await writeFile(join(directory, "soul.md"), "# Soul\nOriginal character.\n");
    const configFile = join(f.root, "config", "bishop.toml");
    const settings = '# retain me\n[tools]\nrun_command = false\n[onboarding]\nfirst_run = true # pending\n[provider]\nmodel = "test"\n';
    await writeFile(configFile, settings);
    const tools = new Tools({ skills: f.skills, cwd: f.root, firstRun: true });
    let step = 0;
    const provider: Provider = { async next(input) {
      step++;
      if (step <= 2) {
        assert.match(input.history.at(-1)!.content, /Ask for a name; save agreed preferences/);
        if (step === 1) return { kind: "reply", message: "What should I call you?" };
        return { kind: "tool", tool: "load_skill", arguments: { name: "bishop-core-profiler" } };
      }
      if (step === 3) return { kind: "tool", tool: "update_soul", arguments: { content: "# Soul\nI am Rowan. I work with Casey, who prefers concise replies." } };
      assert.match(input.instructions, /I work with Casey/);
      if (step === 4) {
        assert.equal(JSON.parse(input.history.at(-1)!.content).ok, true);
        assert.equal((await loadConfig(configFile)).onboarding?.first_run, true);
        return { kind: "tool", tool: "complete_onboarding", arguments: {} };
      }
      return { kind: "reply", message: "Saved." };
    } };
    const agent = new Agent({ provider, tools, personality: "Base identity.", refreshPersonality: () => loadPersonality(directory) });
    assert.equal(await agent.startOnboarding(), "What should I call you?");
    assert.equal((await loadConfig(configFile)).onboarding?.first_run, true);
    await agent.run("Call me Casey. Save that and my preference for concise replies.");
    assert.equal(tools.onboardingPending, false);
    assert.equal(await readFile(configFile, "utf8"), settings.replace("first_run = true", "first_run = false"));
    assert.deepEqual((await readdir(directory)).sort(), ["bishop.md", "soul.md"]);
    const relaunchedTools = new Tools({ skills: f.skills, cwd: f.root, firstRun: (await loadConfig(configFile)).onboarding?.first_run });
    const relaunched = new Agent({ provider, tools: relaunchedTools, personality: await loadPersonality(directory) });
    assert.equal(await relaunched.startOnboarding(), undefined);
    assert.deepEqual(relaunched.history, []);
    const loads = agent.history.filter(entry => entry.role === "tool").length;
    await agent.run("Hello again.");
    assert.equal(agent.history.filter(entry => entry.role === "tool").length, loads);
    assert.equal(await agent.startOnboarding(), undefined);
  } finally { await f.cleanup(); }
});

test("onboarding completion enforces current-turn delivery and retains pending state on failed saves", async () => {
  const f = await fixture();
  try {
    await f.skills.save("personal-onboarding", "Personal setup.", "Confirm preferences.");
    const tools = new Tools({ skills: f.skills, cwd: f.root, firstRun: true });
    assert.equal((await tools.execute("complete_onboarding", {})).ok, false);
    await tools.execute("load_skill", { name: "personal-onboarding" });
    await f.skills.save("personal-onboarding", "Personal setup.", "Revised procedure.");
    assert.equal((await tools.execute("complete_onboarding", {})).ok, false);
    await tools.execute("load_skill", { name: "personal-onboarding" });
    const failedSave = await tools.execute("complete_onboarding", {});
    assert.equal(failedSave.ok, false); // Config does not exist.
    assert.equal(tools.onboardingPending, true);
    tools.beginTurn();
    assert.equal((await tools.execute("complete_onboarding", {})).ok, false);
  } finally { await f.cleanup(); }
});

test("startup never infers without required onboarding delivery; ordinary startup does not trigger it", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const provider: Provider = { async next() { calls++; return { kind: "reply", message: "Hello" }; } };
    for (const settings of [{}, { load_skill: false }]) {
      const agent = new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root, firstRun: true, settings }), personality: "Identity." });
      await assert.rejects(agent.startOnboarding());
      assert.equal(calls, 0);
    }
    const agent = new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root }), personality: "Identity." });
    assert.equal(await agent.startOnboarding(), undefined);
    assert.equal(agent.history.length, 0);
    await agent.run("Hello");
    assert.equal(calls, 1);
  } finally { await f.cleanup(); }
});

test("situational references stay out of normal requests and load through the skill dispatcher", async () => {
  const skills = new Skills("skills", "skills/.revisions");
  const tools = new Tools({ skills, cwd: process.cwd() });
  const catalog = await skills.catalog();
  const harness = await loadHarness("config/harness.md");
  const prompt = renderHarness(harness, { instructions: JSON.stringify(catalog), tools: tools.specs(), history: [] });
  for (const [name, detail] of [["web-research", "same URL with offset set to next_offset"], ["memory-use", "Do not save every exchange"], ["reading-output", "Command stdout and stderr retain only their initial prefixes"], ["command-runner-use", "For every run_command request"]]) {
    assert.match(prompt, new RegExp(name));
    assert.ok(!prompt.includes(detail));
    const result = await tools.execute("load_skill", { name });
    assert.equal(result.ok, true);
    assert.ok(JSON.stringify(result.data).includes(detail));
  }
  for (const file of ["config/runtime/compacted.md", "config/runtime/decision-limit.md"]) assert.ok(!prompt.includes(await loadGuidance(file)));
  const f = await fixture();
  try {
    const empty = join(f.root, "empty.md");
    await writeFile(empty, " \n");
    await assert.rejects(loadGuidance(empty), /empty/);
    await assert.rejects(loadGuidance(join(f.root, "missing.md")), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("editable harness instructions preserve payloads without recursive substitutions", async () => {
  const f = await fixture();
  try {
    const file = join(f.root, "harness.md");
    await writeFile(file, "Edited harness behavior.\n{{instructions}}\n{{tools}}\n{{conversation}}");
    const template = await loadHarness(file);
    const prompt = renderHarness(template, {
      instructions: "Keep literal {{conversation}} inside this instruction.",
      history: [{ role: "user", content: "My message includes {{tools}} and quotes: \"hello\"" }], tools: [],
    });
    assert.match(prompt, /Edited harness behavior/);
    assert.match(prompt, /Keep literal \{\{conversation\}\} inside this instruction/);
    const payload = JSON.parse(prompt.split("\n").at(-1)!);
    assert.equal(payload[0].content, 'My message includes {{tools}} and quotes: "hello"');
    await writeFile(file, "Changed after restart.\n{{instructions}}\n{{tools}}\n{{conversation}}");
    assert.match(await loadHarness(file), /Changed after restart/);
    for (const invalid of ["", "Missing payloads.", "{{instructions}}{{tools}}{{conversation}}{{tools}}", "{{instructions}}{{tools}}{{conversation}}{{unknown}}"] ) {
      await writeFile(file, invalid);
      await assert.rejects(loadHarness(file));
    }
  } finally { await f.cleanup(); }
});

test("edited personality Markdown reaches the model on the next launch", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "bishop.md"), "# Bishop\nGive concise evidence-based answers.");
    await writeFile(join(directory, "notes.txt"), "Do not load this.");
    const first = await loadPersonality(directory);
    await writeFile(join(directory, "bishop.md"), "# Bishop\nUse the newly edited voice.");
    const personality = await loadPersonality(directory);
    assert.notEqual(first, personality);
    const provider: Provider = { async next(input) {
      assert.match(input.instructions, /Use the newly edited voice/);
      assert.doesNotMatch(input.instructions, /Do not load this|Give concise evidence/);
      return { kind: "reply", message: "Hello" };
    } };
    const agent = new Agent({ provider, tools: new Tools({ skills: f.skills, cwd: f.root }), personality });
    await agent.run("Hello");
    await writeFile(join(directory, "bishop.md"), "   ");
    await assert.rejects(loadPersonality(directory), /empty/);
  } finally { await f.cleanup(); }
});

test("soul updates enforce the character budget, preserve rejected drafts, and skip unchanged content", async () => {
  const f = await fixture();
  try {
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    const file = join(directory, "soul.md");
    await writeFile(file, "# Soul\nExisting character.\n");
    const accepted = await updateSoul(file, "x".repeat(1998));
    assert.equal(accepted.characters, 1999);
    const before = await readFile(file, "utf8");
    await assert.rejects(updateSoul(file, "x".repeat(1999)), /under 2,000/);
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal((await updateSoul(file, before)).saved, false);
    await assert.rejects(updateSoul(file, "   "), /nonempty/);
    await writeFile(file, "x".repeat(2000));
    await assert.rejects(loadPersonality(directory), /under 2,000/);
  } finally { await f.cleanup(); }
});

test("soul editing requires the profiler's current version in the current turn", async () => {
  const f = await fixture();
  try {
    await f.skills.save("bishop-core-profiler", "Refine the soul.", "Keep it compact.");
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    const file = join(directory, "soul.md");
    await writeFile(file, "# Soul\nOriginal.\n");
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    assert.equal((await tools.execute("update_soul", { content: "# Soul\nRevised." })).ok, false);
    await tools.execute("load_skill", { name: "bishop-core-profiler" });
    assert.equal((await tools.execute("update_soul", { content: "# Soul\nRevised." })).ok, true);
    assert.equal(await readFile(file, "utf8"), "# Soul\nRevised.\n");
    await f.skills.save("bishop-core-profiler", "Refine the soul.", "Changed procedure.");
    assert.equal((await tools.execute("update_soul", { content: "Another edit." })).ok, false);
    await tools.execute("load_skill", { name: "bishop-core-profiler" });
    tools.beginTurn();
    assert.equal((await tools.execute("update_soul", { content: "Another edit." })).ok, false);
  } finally { await f.cleanup(); }
});

test("an accepted soul edit reaches the next model decision without reloading old conversations", async () => {
  const f = await fixture();
  try {
    await f.skills.save("bishop-core-profiler", "Refine the soul.", "Keep it compact.");
    const directory = join(f.root, "config", "personality");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "bishop.md"), "# Bishop\nBase identity and voice.");
    await writeFile(join(directory, "soul.md"), "# Soul\nOld character note.");
    let step = 0;
    const provider: Provider = { async next(input) {
      step++;
      if (step === 1) return { kind: "tool", tool: "load_skill", arguments: { name: "bishop-core-profiler" } };
      if (step === 2) return { kind: "tool", tool: "update_soul", arguments: { content: "# Soul\nNew enduring character." } };
      assert.match(input.instructions, /Base identity and voice/);
      assert.match(input.instructions, /New enduring character/);
      assert.doesNotMatch(input.instructions, /Old character note/);
      assert.equal(JSON.parse(input.history.at(-1)!.content).ok, true);
      return { kind: "reply", message: "Soul refined." };
    } };
    const agent = new Agent({
      provider, tools: new Tools({ skills: f.skills, cwd: f.root }),
      personality: await loadPersonality(directory), refreshPersonality: () => loadPersonality(directory),
    });
    assert.equal(await agent.run("Refine your character from this feedback."), "Soul refined.");
    assert.equal(step, 3);
  } finally { await f.cleanup(); }
});

test("Codex desktop executable is discovered when it is absent from PATH", async () => {
  const f = await fixture();
  try {
    const older = join(f.root, "OpenAI", "Codex", "bin", "older", "codex.exe");
    const newer = join(f.root, "OpenAI", "Codex", "bin", "newer", "codex.exe");
    await mkdir(join(older, ".."), { recursive: true });
    await mkdir(join(newer, ".."), { recursive: true });
    await writeFile(older, "fixture");
    await writeFile(newer, "fixture");
    await utimes(older, 1000, 1000);
    await utimes(newer, 2000, 2000);
    assert.equal(findCodex({ env: { PATH: "", LOCALAPPDATA: f.root }, platform: "win32" }), newer);
    assert.equal(findCodex({ env: { BISHOP_CODEX_BIN: older }, platform: "win32" }), older);
  } finally { await f.cleanup(); }
});

test("native Codex on PATH takes precedence over desktop discovery", async () => {
  const f = await fixture();
  try {
    const executable = join(f.root, "codex.exe");
    await writeFile(executable, "fixture");
    assert.equal(findCodex({ env: { Path: f.root }, platform: "win32" }), executable);
  } finally { await f.cleanup(); }
});

test("missing Codex and invalid overrides return setup instructions", () => {
  assert.throws(() => findCodex({ env: { PATH: "" }, platform: "win32" }), /Codex executable not found/);
  assert.throws(() => findCodex({ env: { BISHOP_CODEX_BIN: "missing-executable" }, platform: "win32" }), /full path/);
});

test("direct tool use executes a harmless command without loading a skill", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    const result = await tools.execute("run_command", { command: print });
    assert.equal(result.ok, true);
    assert.match((result.data as { stdout: string }).stdout, /bishop-test-ok/);
    assert.equal(tools.loaded.size, 0);
  } finally { await f.cleanup(); }
});

test("a magic prefix or remembered claim cannot bypass the skill prerequisite", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root, requiredCommandSkill: "command-runner-use" });
    const blocked = await tools.execute("run_command", { command: `ggg ${print}` });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error!, /Load the current/);
    assert.equal((await tools.execute("load_skill", { name: "command-runner-use" })).ok, true);
    assert.equal((await tools.execute("run_command", { command: print })).ok, true);
    tools.beginTurn();
    assert.equal((await tools.execute("run_command", { command: print })).ok, false);
  } finally { await f.cleanup(); }
});

test("changing a skill invalidates its loaded version and preserves the old one", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root, requiredCommandSkill: "command-runner-use" });
    const before = await f.skills.load("command-runner-use");
    await tools.execute("load_skill", { name: before.name });
    await f.skills.save(before.name, before.description, "Updated instructions.");
    assert.equal((await tools.execute("run_command", { command: print })).ok, false);
    assert.equal(await readFile(join(f.root, "revisions", `${before.name}-${before.hash}.md`), "utf8"), before.content);
  } finally { await f.cleanup(); }
});

test("disabled tools are hidden and blocked, while other tools remain available", async () => {
  const f = await fixture();
  try {
    for (const name of TOOL_NAMES) {
      const tools = new Tools({ skills: f.skills, cwd: f.root, settings: { [name]: false } });
      assert.equal(tools.specs().some(tool => tool.name === name), false);
      assert.equal(tools.specs().length, TOOL_NAMES.length - 1);
      const blocked = await tools.execute(name, {});
      assert.equal(blocked.ok, false);
      assert.match(blocked.error!, /disabled by configuration/);
    }
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    assert.equal((await tools.execute("load_skill", { name: "command-runner-use", bypass: "yes" })).ok, false);
    assert.equal((await tools.execute("invented_tool", {})).ok, false);
  } finally { await f.cleanup(); }
});

test("skill names cannot escape the library and catalogs omit full instructions", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.skills.save("../escape", "Test", "Test"));
    await assert.rejects(f.skills.load("../escape"));
    const catalog = await f.skills.catalog();
    assert.deepEqual(catalog, [{ name: "command-runner-use", description: "Shell result interpretation." }]);
  } finally { await f.cleanup(); }
});

test("agent returns failed tool evidence to the model without adding its own steps", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    let calls = 0;
    const events: Event[] = [];
    const provider: Provider = { async next(input) {
      calls++;
      if (calls === 1) return { kind: "tool", tool: "run_command", arguments: { command: "exit 7", goal: "check failure reporting" } };
      const last = JSON.parse(input.history.at(-1)!.content);
      assert.equal(last.ok, false);
      assert.equal(last.data.exitCode, 7);
      return { kind: "reply", message: "The command failed with exit code 7." };
    } };
    const agent = new Agent({ personality: "Test behavior instructions.", provider, tools, onEvent: event => events.push(event) });
    assert.equal(await agent.run("Run the test command."), "The command failed with exit code 7.");
    assert.deepEqual(events.flatMap(event => event.type === "context_compaction" ? [] : [event.goal]), ["check failure reporting", "check failure reporting"]);
    assert.equal(calls, 2);
    assert.equal(agent.history.filter(entry => entry.role === "tool").length, 1);
    assert.equal(tools.loaded.size, 0);
  } finally { await f.cleanup(); }
});

test("command goals validate without changing legacy command execution", async () => {
  const f = await fixture();
  try {
    const tools = new Tools({ skills: f.skills, cwd: f.root });
    for (const goal of ["", "   ", 42, null]) {
      assert.equal((await tools.execute("run_command", { command: "exit 0", goal })).ok, false);
    }
    assert.equal((await tools.execute("run_command", { command: "exit 0", goal: "check runner", extra: true })).ok, false);
    assert.equal((await tools.execute("run_command", { command: "exit 0", goal: "check runner" })).ok, true);
    assert.equal((await tools.execute("run_command", { command: "exit 0" })).ok, true);
  } finally { await f.cleanup(); }
});

test("console command goals are brief single-line labels in both output modes", () => {
  for (const interactive of [false, true]) {
    const stream = interactive ? process.stdout : process.stderr;
    const original = stream.write;
    let output = "";
    const ui = new ConsoleUI(interactive);
    ui.color = false;
    ui.waiting = () => {};
    stream.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof stream.write;
    try {
      ui.event({ type: "tool_requested", name: "run_command", goal: "\x1b[31mget\n files\t in directory\x1b[0m" });
      ui.event({ type: "tool_result", name: "run_command", goal: "get files in directory", result: { ok: true } });
      assert.equal(output.split("run_command : get files in directory").length - 1, 2);
      assert.ok(!output.includes("\x1b"));
      output = "";
      ui.event({ type: "tool_requested", name: "run_command", goal: "a".repeat(150) });
      const unwrapped = output.replace(/\n\s*/g, "");
      assert.ok(unwrapped.includes("run_command :"));
      assert.ok(unwrapped.includes("a".repeat(120)));
      assert.ok(!unwrapped.includes("a".repeat(121)));
      output = "";
      ui.event({ type: "tool_requested", name: "run_command" });
      assert.ok(output.includes("run_command"));
      assert.ok(!output.includes("run_command :"));
    } finally { stream.write = original; ui.stop(); }
  }
});

test("activity redraw stays on one terminal row, including wide text and narrow or resized terminals", () => {
  for (const columns of [2, 8, 20, 40, 80, 140]) {
    const line = activityLine("Running run_command : inspect 世界 👨‍👩‍👧‍👦 " + "long-directory/".repeat(10), "1234.5", "|", columns);
    assert.ok(displayWidth(line) < columns);
    assert.ok(!line.includes("\n"));
    if (columns >= 20) assert.ok(line.endsWith("1234.5s"));
  }
  assert.equal(displayWidth("世界"), 4);
  assert.equal(displayWidth("e\u0301"), 1);
  assert.equal(displayWidth("👨‍👩‍👧‍👦"), 2);
  assert.equal(fitLine("世界 hello", 5), "世界…");
});

test("live activity switches between narrow and two-row layouts with honest phase labels", () => {
  for (const columns of [8, 25, 41, 42, 80, 140]) {
    const lines = activityBlock("Running #01 run_command : inspect 世界 " + "long-path/".repeat(20), "123.4", 5, 1, columns);
    assert.equal(lines.length, columns < 42 ? 1 : 2);
    assert.ok(lines.every(line => displayWidth(line) < columns));
    if (columns >= 42) assert.ok(lines[0].includes("EXECUTING"));
  }
  assert.ok(activityBlock("Thinking", "1.0", 0, 0, 80)[0].includes("THINKING"));
  assert.ok(activityBlock("Compacting context", "1.0", 0, 0, 80)[0].includes("COMPACTING"));
});

test("bottom status abbreviates model and sums session tokens without double counting cached input", () => {
  const runs = [{ startedAt: "test", elapsedMs: 1, failed: false, calls: [{ mode: "decision" as const, elapsedMs: 1, failed: false, input: 13122, cachedInput: 9088, output: 30 }] }];
  const bar = sessionStatus("gpt-6.1-sol", runs, 79);
  assert.ok(bar.includes("6.1-sol"));
  assert.ok(bar.includes("IN 13.1k"));
  assert.ok(bar.includes("CACHE 9.1k"));
  assert.ok(bar.includes("OUT 30"));
  assert.ok(sessionStatus("gpt-6.1-sol", [...runs, ...runs], 79).includes("IN 26.2k"));
  assert.ok(sessionStatus("Codex default", [], 79).includes("auto"));
  assert.ok(sessionStatus("model", [{ ...runs[0], calls: [{ ...runs[0].calls[0], input: null }] }], 79).includes("IN ?"));
  assert.ok(displayWidth(sessionStatus("gpt-6.1-sol", runs, 39)) <= 39);
});

test("input wraps into three visible rows with its cursor and graphemes intact", () => {
  const text = "世界 😀 " + "long-input/".repeat(12);
  for (const cursor of [0, 2, text.length - 10, text.length]) {
    const view = inputViewport(text, cursor, 25);
    assert.ok(view.lines.length <= 3);
    assert.ok(view.lines.every(line => displayWidth(line) <= 25));
    assert.ok(view.cursor < 25);
    assert.ok(view.cursorRow >= 0 && view.cursorRow < 3);
    assert.ok(!view.lines.join("").includes("\ufffd"));
  }
  assert.ok(inputViewport(text, 0, 25).lines[0].startsWith("世界"));
  assert.deepEqual(inputViewport("abcdefghijkl", 12, 5), { lines: ["abcde", "fghij", "kl"], cursor: 2, cursorRow: 2 });
  assert.deepEqual(inputViewport("abcdefghijklmno", 15, 5), { lines: ["fghij", "klmno", ""], cursor: 0, cursorRow: 2 });
  assert.deepEqual(inputViewport("abcd世界", 4, 5), { lines: ["abcd", "世界"], cursor: 0, cursorRow: 1 });
});

test("dock reserves footer rows, retains history for paging, redraws on resize, and restores terminal state", () => {
  let output = "", rows = 24, columns = 80;
  const dock = new ConsoleDock(text => { output += text; }, () => ({ rows, columns }), () => "6.1-sol IN 1k CACHE 0 OUT 10", () => false);
  assert.ok(!output.includes("\x1b[1;20r"));
  assert.ok(output.includes("\x1b[21;1H"));
  assert.ok(output.includes("\x1b[22;1H"));
  assert.ok(output.includes("\x1b[23;1H"));
  assert.ok(output.includes("\x1b[24;1H"));
  for (let i = 0; i < 60; i++) dock.print(`History ${i}\n`);
  dock.setInput("typed question", 5);
  dock.page(1);
  assert.ok(dock.offset > 0);
  assert.equal(dock.input, "typed question");
  dock.page(-1);
  assert.equal(dock.offset, 0);
  assert.equal(dock.history.length, 60);
  dock.showActivity(["Thinking", "Current goal"]);
  assert.ok(output.includes("\x1b[19;1H"));
  rows = 18; columns = 60; dock.resize();
  assert.ok(output.includes("\x1b[12;1H"));
  assert.ok(output.includes("\x1b[15;1H"));
  assert.ok(output.includes("\x1b[17;1H"));
  dock.close();
  assert.equal(dock.active, false);
  assert.ok(output.endsWith("\x1b[r\x1b[18;1H"));
});

test("long replies remain browsable without incoming output moving the reading viewport", () => {
  let output = "";
  const dock = new ConsoleDock(text => { output += text; }, () => ({ rows: 24, columns: 80 }), () => "status", () => false);
  assert.match(output, /\x1b\[\?1006h/);
  dock.print(Array.from({ length: 300 }, (_, i) => `File line ${i}`).join("\n") + "\n");
  dock.setInput("draft 漢字", 8);
  dock.scroll(3);
  dock.page(1);
  output = "";
  dock.print("More output\n");
  assert.equal(dock.offset, 22);
  assert.doesNotMatch(output, /File line|More output/);
  dock.scroll(10000);
  assert.match(output, /File line 0\b/);
  assert.equal(dock.input, "draft 漢字");
  dock.scroll(-10000);
  assert.equal(dock.offset, 0);
  assert.match(output, /More output/);
  dock.close();
  assert.match(output, /\x1b\[\?1000l\x1b\[\?1006l/);
});

test("mouse reports never enter readline text, including split reports and UTF-8 input", async () => {
  const directions: number[] = [];
  const input = new ConsoleInput(direction => directions.push(direction));
  let text = "";
  input.on("data", chunk => { text += chunk.toString(); });
  input.write("draft\x1b");
  input.write("[<64;10;");
  input.write("5M\x1b[<65;10;5M\x1b[<0;10;5M\x1b[<0;10;5m");
  input.write("\x1b[5~\x1b[6~");
  const unicode = Buffer.from("漢字");
  input.write(unicode.subarray(0, 2));
  input.write(unicode.subarray(2));
  input.write("\x1b");
  await new Promise(resolve => setTimeout(resolve, 70));
  input.end();
  assert.deepEqual(directions, [1, -1]);
  assert.equal(text, "draft\x1b[5~\x1b[6~漢字\x1b");
});

test("dock status background matches the bright cyan identity color", () => {
  let output = "";
  const dock = new ConsoleDock(text => { output += text; }, () => ({ rows: 24, columns: 80 }), () => "status", () => true);
  assert.ok(output.includes("\x1b[106;30m"));
  assert.ok(!output.includes("\x1b[44;97m"));
  output = "";
  dock.setInput("x".repeat(150), 150);
  assert.ok(output.includes("\x1b[24;17H"));
  dock.close();
});

test("TTY tool activity is replaced in place and stop clears all live rows", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const original = process.stdout.write;
  const term = process.env.TERM;
  process.env.TERM = "xterm";
  let output = "";
  const ui = new ConsoleUI(true, () => 80);
  ui.color = true;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    ui.begin();
    ui.event({ type: "tool_requested", name: "run_command", goal: "Check the workspace" });
    assert.equal(ui.liveRows, 2);
    ui.event({ type: "tool_result", name: "run_command", goal: "Check the workspace", result: { ok: true, data: { exitCode: 0 } } });
    ui.reply("Completed.");
    assert.equal(ui.liveRows, 0);
    assert.equal(ui.timer, undefined);
    assert.ok(output.includes("\x1b[1A"));
    assert.ok(output.includes("\x1b[2K"));
    assert.ok(!output.includes("↳ 01"));
    assert.ok(output.includes("✓ 01"));
    assert.ok(output.includes("\x1b[1;96m"));
    assert.ok(!output.includes("\x1b[1;95m"));
  } finally {
    ui.stop(); process.stdout.write = original;
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    else Reflect.deleteProperty(process.stdout, "isTTY");
    if (term === undefined) delete process.env.TERM; else process.env.TERM = term;
  }
});

test("richer scrolling console wraps panels without dropping tools or runtime fields", () => {
  const original = process.stdout.write;
  let output = "";
  const ui = new ConsoleUI(true, () => 40);
  ui.color = false; ui.waiting = () => {};
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    ui.banner("test-model", ["apply_patch", "web_search", "load_skill", "run_command"], { cwd: "C:/very-long-workspace/BishopAgent", contextLimit: 500000, compactAt: 400000, sessionLabel: "default" });
    assert.ok(output.includes("apply_patch"));
    assert.ok(output.includes("run_command"));
    assert.ok(output.includes("500,000"));
    assert.ok(output.includes("400,000"));
    assert.ok(output.includes("test-model"));
    assert.ok(output.split("\n").every(line => displayWidth(line) < 40));
    output = "";
    ui.begin();
    ui.event({ type: "tool_requested", name: "apply_patch" });
    ui.event({ type: "tool_result", name: "apply_patch", result: { ok: true, data: { files: [{ path: "app/example.ts", operation: "update" }] } } });
    ui.reply("Updated the requested feature.", { startedAt: "test", elapsedMs: 10, failed: false, calls: [{ mode: "decision", elapsedMs: 10, failed: false, input: 1000, cachedInput: 500, output: 20 }] });
    assert.ok(output.includes("01  apply_patch"));
    assert.ok(output.includes("update  app/example.ts"));
    assert.ok(output.includes("1 tool"));
    assert.ok(output.includes("input 1,000"));
    assert.ok(output.includes("output 20"));
    assert.ok(output.split("\n").every(line => displayWidth(line) < 40));
  } finally { process.stdout.write = original; ui.stop(); }
});

test("redirected replies retain plain output and unknown usage is not displayed as zero", () => {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    new ConsoleUI(false).reply("Plain reply.");
    assert.equal(output, "Plain reply.\n");
    output = "";
    const ui = new ConsoleUI(true); ui.color = false;
    ui.reply("Done.", { startedAt: "test", elapsedMs: 10, failed: false, calls: [{ mode: "decision", elapsedMs: 10, failed: false, input: null, cachedInput: null, output: null }] });
    assert.ok(output.includes("input unknown"));
    assert.ok(output.includes("cached unknown"));
  } finally { process.stdout.write = original; }
});

test("status displays complete runtime settings and help lists the local command", () => {
  const original = process.stdout.write;
  let output = "";
  const ui = new ConsoleUI(false);
  ui.color = false;
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    const cwd = "C:/" + "long-directory/".repeat(12);
    ui.status("override-model", ["apply_patch", "load_skill"], cwd, CONTEXT_LIMIT, 18000);
    assert.ok(output.includes("Model: override-model"));
    assert.ok(output.includes("Enabled tools: apply_patch, load_skill"));
    assert.ok(output.includes(`Working directory: ${cwd}`));
    assert.ok(output.includes("Context guard: 500000 characters (UTF-16 units)"));
    assert.ok(output.includes("Compaction threshold: 18000 characters (UTF-16 units)"));
    output = "";
    ui.status("Codex default", [], cwd, CONTEXT_LIMIT, 400000);
    assert.ok(output.includes("Model: Codex default"));
    assert.ok(output.includes("Enabled tools: none enabled"));
    ui.help();
    assert.ok(output.includes("/status"));
  } finally { process.stdout.write = original; ui.stop(); }
});

test("missing config and omitted tool settings leave all tools enabled", async () => {
  const f = await fixture();
  try {
    const config = await loadConfig(join(f.root, "absent.json"));
    const tools = new Tools({ skills: f.skills, cwd: f.root, settings: config.tools });
    assert.equal(tools.specs().length, TOOL_NAMES.length);
    assert.deepEqual(parseConfig({}), { tools: {}, provider: {} });
    assert.deepEqual(parseConfig({ tools: { run_command: false } }), { tools: { run_command: false }, provider: {} });
    assert.deepEqual(parseConfig({ tools: { save_skill: true } }), { tools: { save_skill: true }, provider: {} });
  } finally { await f.cleanup(); }
});

test("provider model loads alongside tool switches and invalid provider values are rejected", async () => {
  const f = await fixture();
  try {
    const file = join(f.root, "bishop.config.json");
    await writeFile(file, JSON.stringify({ tools: { save_skill: false }, provider: { model: "gpt-6.1-sol" } }));
    assert.deepEqual(await loadConfig(file), { tools: { save_skill: false }, provider: { model: "gpt-6.1-sol" } });
    assert.deepEqual(parseConfig({ provider: {} }), { tools: {}, provider: {} });
    for (const provider of [null, [], "model", { model: null }, { model: 7 }, { model: "   " }, { modle: "typo" }]) {
      assert.throws(() => parseConfig({ provider }));
    }
  } finally { await f.cleanup(); }
});

test("config loads disabled tools and rejects malformed or misspelled settings", async () => {
  const f = await fixture();
  try {
    const file = join(f.root, "bishop.config.json");
    await writeFile(file, '\uFEFF{"tools":{"run_command":false}}');
    assert.equal((await loadConfig(file)).tools.run_command, false);
    for (const value of [null, [], { tools: null }, { tools: [] }, { tools: { run_command: "false" } }, { tools: { run_commmand: false } }, { unknown: {} }]) {
      assert.throws(() => parseConfig(value));
    }
    await writeFile(file, "not json");
    await assert.rejects(loadConfig(file), /Invalid configuration/);
  } finally { await f.cleanup(); }
});

test("commented TOML loads tool switches and model, with legacy settings preserved", async () => {
  const f = await fixture();
  try {
    const file = join(f.root, "bishop.config.toml");
    const legacy = join(f.root, "bishop.config.json");
    await writeFile(legacy, JSON.stringify({ tools: { run_command: false }, provider: { model: "legacy-model" } }));
    assert.equal((await loadConfig(file)).tools.run_command, false);
    assert.equal((await loadConfig(file)).provider.model, "legacy-model");
    await writeFile(file, '\uFEFF# Settings\n[tools]\nrun_command = false # keep this disabled\n[provider]\nmodel = "gpt-6.1-sol"\n');
    assert.deepEqual(await loadConfig(file), { tools: { run_command: false }, provider: { model: "gpt-6.1-sol" } });
    await writeFile(file, '[tools]\nrun_command = "false"');
    await assert.rejects(loadConfig(file), /must be true or false/);
    await writeFile(file, '[provider]\nmodel = "first"\nmodel = "second"');
    await assert.rejects(loadConfig(file), /Invalid configuration/);
    await writeFile(file, '[tools]\nrun_command =');
    await assert.rejects(loadConfig(file), /Invalid configuration/);
  } finally { await f.cleanup(); }
});

test("decision settings validate and default to 100", () => {
  assert.deepEqual(parseConfig({ agent: {} }).agent, { max_decisions: 100 });
  assert.deepEqual(parseConfig({ agent: { max_decisions: 25 } }).agent, { max_decisions: 25 });
  for (const agent of [null, [], { max_decisions: 0 }, { max_decisions: -1 }, { max_decisions: 1.5 }, { max_decisions: "100" }, { max_decisions: Infinity }, { max_decisions: Number.MAX_SAFE_INTEGER + 1 }, { other: 100 }]) {
    assert.throws(() => parseConfig({ agent }));
  }
});

test("context settings validate compaction thresholds", () => {
  assert.deepEqual(parseConfig({ context: {} }).context, { compact_at_characters: 400000 });
  assert.deepEqual(parseConfig({ context: { compact_at_characters: 60000 } }).context, { compact_at_characters: 60000 });
  assert.deepEqual(parseConfig({ context: { compact_at_characters: 450000 } }).context, { compact_at_characters: 450000 });
  for (const context of [null, [], { other: true }, { compact_at_characters: 15999 }, { compact_at_characters: 450001 }, { compact_at_characters: "400000" }, { compact_at_characters: 20000.5 }]) {
    assert.throws(() => parseConfig({ context }));
  }
});

function bulkyHistory(): Entry[] {
  return [{ role: "user", content: "Implement the feature; preserve unrelated changes." },
    ...Array.from({ length: 8 }, (_, i): Entry => ({ role: "tool", content: JSON.stringify({ name: "run_command", ok: i !== 3, data: { stdout: `File section ${i}: ` + "x".repeat(16000), exitCode: i === 3 ? 1 : 0 } }) })),
    { role: "assistant", content: JSON.stringify({ kind: "tool", tool: "missing", arguments: {} }) },
    { role: "tool", content: JSON.stringify({ name: "missing", ok: false, error: "Keep this final evidence." }) }];
}

test("default context keeps inputs beyond the old guard and compacts only above 400k", async () => {
  const context = new WorkingContext();
  assert.equal(CONTEXT_LIMIT, 500000);
  const history: Entry[] = [
    { role: "user", content: "Continue the requested feature." },
    ...Array.from({ length: 20 }, (): Entry => ({ role: "tool", content: "x".repeat(16000) })),
  ];
  let requests = 0;
  const provider: Provider = { async next(input) {
    requests++;
    assert.equal(input.mode, "compaction");
    return { kind: "reply", message: "Requested feature remains in progress; inspected source is summarized." };
  } };
  const unchanged = await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [history[0]], () => assert.fail("Premature compaction"));
  assert.ok(contextSize({ instructions: "Test.", history: unchanged, tools: [] }) > 128000);
  assert.deepEqual(unchanged, history);
  assert.equal(requests, 0);
  history.push(...Array.from({ length: 8 }, (): Entry => ({ role: "tool", content: "y".repeat(16000) })));
  const compacted = await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [history[0]], () => {});
  assert.ok(requests > 0);
  assert.ok(contextSize({ instructions: "Test.", history: compacted, tools: [] }) < 400000);
  assert.equal(compacted.at(-1), history.at(-1));
});

test("compaction uses bounded tool-free requests, retains recent evidence, and leaves the transcript intact", async () => {
  const history = bulkyHistory();
  const original = JSON.stringify(history);
  const guidance = await loadGuidance("config/runtime/compacted.md");
  const context = new WorkingContext(80_000, 0, guidance);
  const phases: string[] = [];
  let requests = 0;
  const provider: Provider = { async next(input) {
    assert.equal(input.mode, "compaction");
    assert.deepEqual(input.tools, []);
    assert.ok(contextSize(input) <= CONTEXT_LIMIT);
    if (requests++) assert.match(input.history[0].content, /context_summary/);
    return { kind: "reply", message: "Feature requested. Sections inspected; one command failed. Work remains." };
  } };
  const view = await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [history[0]], phase => phases.push(phase));
  assert.ok(requests > 1);
  assert.deepEqual(phases, ["started", "completed"]);
  assert.ok(JSON.stringify(view).length < 40000);
  assert.ok(view.includes(history[0]));
  assert.equal(view.at(-1), history.at(-1));
  assert.equal(view.at(-2), history.at(-2));
  assert.equal(JSON.stringify(history), original);
  assert.equal(JSON.parse(view[0].content).guidance, guidance);
  const again = await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [history[0]], () => assert.fail("Unexpected re-compaction"));
  assert.deepEqual(again, view);
  context.reset();
  const fresh: Entry[] = [{ role: "user", content: "Fresh task" }];
  assert.deepEqual(await context.prepare(provider, { instructions: "Test.", history: fresh, tools: [] }, [], () => assert.fail("Unexpected compaction")), fresh);
});

test("failed and invalid summary requests preserve previous context without executing tools", async () => {
  for (const response of ["throw", "tool", "empty", "oversize"] as const) {
    const context = new WorkingContext(80_000);
    const history = bulkyHistory();
    const original = JSON.stringify(history);
    const provider: Provider = { async next() {
      if (response === "throw") throw new Error("Provider unavailable.");
      if (response === "tool") return { kind: "tool", tool: "run_command", arguments: { command: "never execute" } };
      return { kind: "reply", message: response === "empty" ? " " : "x".repeat(8001) };
    } };
    await assert.rejects(context.prepare(provider, { instructions: "Test.", history, tools: [] }, [], () => {}));
    assert.equal(context.through, 0);
    assert.equal(context.summary, "");
    assert.equal(JSON.stringify(history), original);
  }
});

test("an invalid summary gets one bounded correction attempt with explicit diagnostic feedback", async () => {
  for (const invalid of ["oversize", "tool", "empty"] as const) {
    const context = new WorkingContext(80_000);
    const history = bulkyHistory();
    const phases: string[] = [];
    let calls = 0;
    const provider: Provider = { async next(input) {
      assert.deepEqual(input.tools, []);
      assert.equal(input.mode, "compaction");
      if (++calls === 1) {
        if (invalid === "tool") return { kind: "tool", tool: "run_command", arguments: { command: "never execute" } };
        return { kind: "reply", message: invalid === "empty" ? " " : "x".repeat(8001) };
      }
      if (calls === 2) assert.match(input.instructions, /Summary validation feedback:.*target_characters.*2000/);
      return { kind: "reply", message: "Task and progress retained; continue unfinished work." };
    } };
    const view = await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [], phase => phases.push(phase));
    assert.ok(view.length < history.length);
    assert.deepEqual(phases, ["started", "retrying", "completed"]);
  }
});

test("repeated invalid summaries stop after two attempts with the specific cause", async () => {
  const context = new WorkingContext(80_000);
  let calls = 0;
  const provider: Provider = { async next() { calls++; return { kind: "reply", message: "x".repeat(9000) }; } };
  await assert.rejects(context.prepare(provider, { instructions: "Test.", history: bulkyHistory(), tools: [] }, [], () => {}), /after two summary attempts: reply contained 9000 characters; maximum is 8000/);
  assert.equal(calls, 2);
  assert.equal(context.through, 0);
});

test("repeated compaction carries the checkpoint forward and a failed later batch does not replace it", async () => {
  const context = new WorkingContext(80_000);
  const history = bulkyHistory();
  const provider: Provider = { async next() { return { kind: "reply", message: "Prior work and its verification preserved." }; } };
  await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [], () => {});
  const previous = { through: context.through, summary: context.summary };
  history.push(...bulkyHistory());
  let requests = 0;
  const failing: Provider = { async next(input) {
    assert.match(input.history[0].content, /context_summary/);
    if (++requests === 2) throw new Error("Second batch failed.");
    return { kind: "reply", message: "Candidate checkpoint, not committed yet." };
  } };
  await assert.rejects(context.prepare(failing, { instructions: "Test.", history, tools: [] }, [], () => {}), /Second batch failed/);
  assert.deepEqual({ through: context.through, summary: context.summary }, previous);
  const view = await context.prepare(provider, { instructions: "Test.", history, tools: [] }, [], () => {});
  assert.ok(context.through > previous.through);
  assert.equal(view.at(-1), history.at(-1));
});

test("an oversized current request fails visibly rather than being silently shortened", async () => {
  const context = new WorkingContext();
  const request: Entry = { role: "user", content: "x".repeat(CONTEXT_LIMIT) };
  const provider: Provider = { async next() { assert.fail("An oversized retained request must not reach the provider."); } };
  await assert.rejects(context.prepare(provider, { instructions: "Test.", history: [request], tools: [] }, [request], () => {}), /shorten the input/);
  assert.equal(request.content.length, CONTEXT_LIMIT);
  assert.equal(context.through, 0);
});

test("agent continues after compaction, pins current-turn skill delivery, preserves transcript, and resets cleanly", async () => {
  const f = await fixture();
  try {
    const history: Entry[] = [{ role: "user", content: "Current task: inspect, then run a harmless command." }];
    const events: Event[] = [];
    let ordinary = 0, summaries = 0, commands = 0;
    const tools = new Tools({ skills: f.skills, cwd: f.root, requiredCommandSkill: "command-runner-use" });
    const execute = tools.execute.bind(tools);
    tools.execute = async (name, args) => {
      if (name === "bulky-evidence") return { ok: true, data: { stdout: "z".repeat(16000) } };
      if (name === "run_command") commands++;
      return execute(name, args);
    };
    const provider: Provider = { async next(input) {
      if (input.mode === "compaction") {
        summaries++;
        assert.deepEqual(input.tools, []);
        return { kind: "reply", message: "Current task: inspect then run a harmless command. Evidence inspected. No command executed yet." };
      }
      ordinary++;
      if (ordinary === 1) return { kind: "tool", tool: "load_skill", arguments: { name: "command-runner-use" } };
      if (ordinary <= 9) return { kind: "tool", tool: "bulky-evidence", arguments: {} };
      if (ordinary === 10) {
        assert.ok(summaries > 0);
        assert.ok(input.history.some(entry => entry.role === "user" && entry.content === "Develop."));
        assert.ok(input.history.some(entry => entry.role === "tool" && entry.content.includes('"name":"load_skill"')));
        return { kind: "tool", tool: "run_command", arguments: { command: print } };
      }
      assert.equal(JSON.parse(input.history.at(-1)!.content).ok, true);
      return { kind: "reply", message: "Finished." };
    } };
    const agent = new Agent({ provider, tools, personality: "Test.", history, maxSteps: 10, compactAt: 80_000, onEvent: event => events.push(event) });
    assert.equal(await agent.run("Develop."), "Finished.");
    assert.equal(commands, 1);
    assert.equal(agent.history.filter(entry => entry.role === "tool").length, 10);
    assert.ok(JSON.stringify(agent.history).length > 128000);
    assert.ok(events.some(event => event.type === "context_compaction" && event.phase === "completed"));
    const sessions = new Sessions(join(f.root, "history"));
    await sessions.save("test", agent.history);
    assert.deepEqual(await sessions.load("test"), agent.history);
    agent.resetConversation();
    assert.deepEqual(agent.history, []);
    assert.equal(agent.context.summary, "");
    assert.equal(agent.context.through, 0);
    assert.equal(tools.loaded.size, 0);
  } finally { await f.cleanup(); }
});

test("exhaustion gives one reply-only request with the last tool evidence", async () => {
  const f = await fixture();
  try {
    const runtimeGuidance = { compacted: await loadGuidance("config/runtime/compacted.md"), exhausted: await loadGuidance("config/runtime/decision-limit.md") };
    let decisions = 0;
    const provider: Provider = { async next(input) {
      decisions++;
      if (decisions <= 2) {
        assert.ok(input.tools.length > 0);
        assert.ok(!input.instructions.includes(runtimeGuidance.exhausted));
        assert.ok(!input.instructions.includes(runtimeGuidance.compacted));
        return { kind: "tool", tool: "load_skill", arguments: { name: "command-runner-use" } };
      }
      assert.equal(decisions, 3);
      assert.deepEqual(input.tools, []);
      assert.match(input.instructions, /Turn decision budget exhausted: true/);
      assert.ok(input.instructions.includes(runtimeGuidance.exhausted));
      assert.equal(input.history.at(-1)!.role, "tool");
      assert.equal(JSON.parse(input.history.at(-1)!.content).ok, true);
      return { kind: "reply", message: "Budget reached. Loaded the skill; remaining work is unfinished." };
    } };
    const agent = new Agent({ personality: "Test.", provider, tools: new Tools({ skills: f.skills, cwd: f.root }), maxSteps: 2, runtimeGuidance });
    assert.match(await agent.run("Test"), /Budget reached/);
    assert.equal(agent.history.filter(entry => entry.role === "tool").length, 2);
    assert.equal(agent.history.at(-1)!.role, "assistant");
  } finally { await f.cleanup(); }
});

test("normal replies finish without an extra request and omitted budgets default to 100", async () => {
  const f = await fixture();
  try {
    let decisions = 0;
    const provider: Provider = { async next() {
      decisions++;
      return { kind: "reply", message: "Done." };
    } };
    const agent = new Agent({ personality: "Test.", provider, tools: new Tools({ skills: f.skills, cwd: f.root }) });
    assert.equal(agent.maxSteps, 100);
    assert.equal(await agent.run("Test"), "Done.");
    assert.equal(decisions, 1);
    for (const maxSteps of [0, -1, 1.5, Infinity]) {
      assert.throws(() => new Agent({ personality: "Test.", provider, tools: agent.tools, maxSteps }));
    }
  } finally { await f.cleanup(); }
});

test("an endlessly retrying model cannot execute tools in its final reply opportunity", async () => {
  const f = await fixture();
  try {
    let decisions = 0;
    const provider: Provider = { async next(input): Promise<Action> {
      decisions++;
      if (decisions === 3) assert.deepEqual(input.tools, []);
      return { kind: "tool", tool: "missing", arguments: {} };
    } };
    const agent = new Agent({ personality: "Test behavior instructions.", provider, tools: new Tools({ skills: f.skills, cwd: f.root }), maxSteps: 2 });
    await assert.rejects(agent.run("Test"), /No further tool was executed/);
    assert.equal(decisions, 3);
    assert.equal(agent.history.filter(entry => entry.role === "tool").length, 2);
  } finally { await f.cleanup(); }
});

test("process output is capped and execution errors remain distinguishable", async () => {
  const f = await fixture();
  try {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('a'.repeat(1000)); process.exitCode=3"], { cwd: f.root, outputLimit: 50 });
    assert.equal(result.exitCode, 3);
    assert.equal(result.stdout.length, 50);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.output, { limit: 50, stdout: { total: 1000, omitted: 950 }, stderr: { total: 0, omitted: 0 } });
    await assert.rejects(runProcess(join(f.root, "not-an-executable"), [], { cwd: f.root }));
  } finally { await f.cleanup(); }
});

test("output metadata identifies each truncated stream and preserves the captured prefixes", async () => {
  const f = await fixture();
  try {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('abcdef'); process.stderr.write('123456789');"], { cwd: f.root, outputLimit: 5 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.equal(result.stdout, "abcde");
    assert.equal(result.stderr, "12345");
    assert.deepEqual(result.output, { limit: 5, stdout: { total: 6, omitted: 1 }, stderr: { total: 9, omitted: 4 } });
    const complete = await runProcess(process.execPath, ["-e", "process.stdout.write('abcde'); process.stderr.write('123');"], { cwd: f.root, outputLimit: 5 });
    assert.equal(complete.truncated, false);
    assert.equal(complete.output, undefined);
  } finally { await f.cleanup(); }
});

test("stream decoding preserves UTF-8 characters split across chunks and counts omitted text", async () => {
  const f = await fixture();
  try {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write(Buffer.from([0xf0, 0x9f])); setTimeout(() => process.stdout.write(Buffer.from([0x98, 0x80, 0x61, 0x62])), 20);"], { cwd: f.root, outputLimit: 3 });
    assert.equal(result.stdout, "😀a");
    assert.deepEqual(result.output, { limit: 3, stdout: { total: 4, omitted: 1 }, stderr: { total: 0, omitted: 0 } });
  } finally { await f.cleanup(); }
});

test("process timeouts are reported without claiming success", async () => {
  const f = await fixture();
  try {
    const result = await runProcess(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { cwd: f.root, timeoutMs: 100 });
    assert.equal(result.timedOut, true);
  } finally { await f.cleanup(); }
});

test("malformed model actions cannot become executable requests", () => {
  assert.throws(() => parseAction('{"kind":"tool","tool":"run_command","arguments":"[]"}'));
  assert.throws(() => parseAction("not JSON"));
  assert.deepEqual(parseAction('{"kind":"reply","message":"Hello"}'), { kind: "reply", message: "Hello" });
  assert.deepEqual(parseAction('{"kind":"tool","tool":"load_skill","arguments":"{\\"name\\":\\"command-runner-use\\"}"}'), {
    kind: "tool", tool: "load_skill", arguments: { name: "command-runner-use" },
  });
});

test("sessions persist real tool evidence and reject path traversal", async () => {
  const f = await fixture();
  try {
    const sessions = new Sessions(join(f.root, "sessions"));
    const history = [{ role: "user" as const, content: "Hello" }, { role: "tool" as const, content: '{"ok":false}' }];
    await sessions.save("test", history);
    await sessions.save("test", history);
    assert.deepEqual(await sessions.load("test"), history);
    assert.deepEqual(await sessions.load("new"), []);
    assert.throws(() => sessions.path("../escape"));
    assert.deepEqual(await readdir(join(f.root, "sessions")), ["test.json"]);
  } finally { await f.cleanup(); }
});

test("relaunch starts empty despite the same label, while prior transcripts stay intact", async () => {
  const f = await fixture();
  try {
    const sessions = new Sessions(join(f.root, "sessions"));
    const prior = [{ role: "user" as const, content: "Old conversation must not reach the model." }];
    await sessions.save("default", prior);
    const first = await sessions.start("default");
    const current = [{ role: "user" as const, content: "Previous launch." }];
    await sessions.save(first.name, current);
    const second = await sessions.start("default");
    assert.notEqual(first.name, second.name);
    assert.deepEqual(second.history, []);
    assert.deepEqual(await sessions.load(second.name), []);
    assert.deepEqual(await sessions.load(first.name), current);
    assert.deepEqual(await sessions.load("default"), prior);
    const provider: Provider = { async next(input) {
      assert.deepEqual(input.history, [{ role: "user", content: "Fresh hello" }]);
      return { kind: "reply", message: "Fresh reply" };
    } };
    const agent = new Agent({ personality: "Test behavior instructions.", provider, tools: new Tools({ skills: f.skills, cwd: f.root }), history: second.history });
    await agent.run("Fresh hello");
    assert.equal(agent.history.length, 2);
  } finally { await f.cleanup(); }
});
