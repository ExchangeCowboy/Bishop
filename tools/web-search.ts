import { load } from "cheerio/slim";
import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from "../app/config.ts";
import type { ToolResult } from "../app/types.ts";

const ENDPOINT = "https://html.duckduckgo.com/html/";
const MAX_BYTES = 1_000_000;
export type SearchResult = { title: string; url: string; snippet: string };
export type SearchFetch = typeof fetch;

function destination(href: string): string | undefined {
  try {
    let url = new URL(href, ENDPOINT);
    if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) {
      const target = url.searchParams.get("uddg");
      if (!target) return;
      url = new URL(target);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) return;
    return url.href;
  } catch { return; }
}

export function parseSearchResults(html: string, limit: number): SearchResult[] {
  const $ = load(html);
  if ($('#challenge-form, #anomaly-form, .anomaly-modal').length) {
    throw new Error("DuckDuckGo returned a bot challenge. Search is temporarily unavailable; try again later.");
  }
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const text = (value: string, maximum: number) => value.replace(/\s+/g, " ").trim().slice(0, maximum);
  $('.result').each((_, element) => {
    const row = $(element);
    if (results.length >= limit || row.is('.result--ad') || row.find('.result__badge').length) return;
    const link = row.find('a.result__a').first();
    const url = destination(link.attr('href') ?? "");
    const title = text(link.text(), 300);
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    results.push({ title, url, snippet: text(row.find('.result__snippet').first().text(), 1000) });
  });
  if (!results.length && !$('.no-results, .result--no-result').length) {
    throw new Error("DuckDuckGo returned an unrecognized search page. Results could not be read.");
  }
  return results;
}

export async function webSearch(query: string, settings: SearchSettings = DEFAULT_SEARCH_SETTINGS, request: SearchFetch = fetch): Promise<ToolResult> {
  const normalized = query.trim();
  if (!normalized || normalized.length > 500) return { ok: false, error: "Search query must contain 1 to 500 characters." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeout_ms);
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", normalized);
    const response = await request(url, { signal: controller.signal, headers: { Accept: "text/html" } });
    if (response.status === 202 || response.status === 403 || response.status === 429) {
      await response.body?.cancel();
      throw new Error(`DuckDuckGo blocked or rate-limited the search (HTTP ${response.status}). Try again later.`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`DuckDuckGo search failed (HTTP ${response.status}).`);
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new Error("DuckDuckGo returned an unexpected content type.");
    }
    if (!response.body) throw new Error("DuckDuckGo returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new Error("DuckDuckGo response exceeded the 1 MB limit.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const results = parseSearchResults(Buffer.concat(chunks).toString("utf8"), settings.result_limit);
    return { ok: true, data: { provider: settings.provider, query: normalized, search_url: url.href, results } };
  } catch (error) {
    return { ok: false, error: controller.signal.aborted
      ? `DuckDuckGo search timed out after ${settings.timeout_ms} ms.`
      : error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
}
