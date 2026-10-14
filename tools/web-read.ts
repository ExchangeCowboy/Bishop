import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { load } from "cheerio/slim";
import { DEFAULT_WEB_READ_SETTINGS, type WebReadSettings } from "../app/config.ts";
import type { ToolResult } from "../app/types.ts";

function pageUrl(value: string): URL {
  if (value.length > 4096) throw new Error("Page URL exceeds 4096 characters.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Page URL must use HTTP or HTTPS without embedded credentials.");
  }
  return url;
}

const compact = (text: string) => text.replace(/\s+/g, " ").trim();

export function extractPage(html: string, url: string, linkLimit: number) {
  // Default jsdom settings neither run page scripts nor load subresources.
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    if (doc.getElementsByTagName("*").length > 50000) throw new Error("Page exceeds the 50000-element extraction limit.");
    const title = compact(doc.title).slice(0, 300);
    const challengeTitle = /^(just a moment|attention required|access denied|verify (you|your)|checking your browser)/i.test(title);
    if (challengeTitle || doc.querySelector('#challenge-form, #cf-challenge-running, .g-recaptcha, .h-captcha') && compact(doc.body.textContent ?? "").length < 2000) {
      throw new Error("Page returned a bot challenge or access block; browser access may be required.");
    }
    doc.querySelectorAll('script, style, noscript, template, nav, aside, footer, [hidden], [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"], .advertisement, .ads').forEach(el => el.remove());
    const article = new Readability(doc.cloneNode(true) as Document, { maxElemsToParse: 50000, charThreshold: 100 }).parse();
    const fallback = doc.querySelector("main, [role='main'], article") ?? doc.body;
    const $ = load(article?.content ?? fallback.innerHTML);
    $('script, style, noscript, nav, aside, footer, [hidden], [aria-hidden="true"]').remove();
    const links: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    let linkCount = 0;
    $('a[href]').each((_, el) => {
      try {
        const href = $(el).attr('href')!;
        const resolved = pageUrl(new URL(href, url).href).href;
        if (seen.has(resolved)) return;
        seen.add(resolved);
        linkCount++;
        if (links.length < linkLimit) links.push({ title: compact($(el).text()).slice(0, 200), url: resolved });
      } catch { /* Non-web and credential-bearing links are omitted. */ }
    });
    // Preserve block boundaries and code whitespace instead of joining paragraphs.
    $('br').replaceWith('\n');
    $('p, div, section, article, h1, h2, h3, h4, h5, h6, li, tr, pre, blockquote').each((_, el) => { $(el).prepend('\n'); $(el).append('\n'); });
    $('td, th').each((_, el) => { $(el).append('\t'); });
    const text = $.root().text().replace(/\r\n?/g, '\n').replace(/[^\S\n]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text || text.length < 80 && /enable javascript|javascript (is required|must be enabled)|sign in to continue/i.test(text)) {
      throw new Error("Page has no readable content; JavaScript or login may be required.");
    }
    return { title: compact(article?.title ?? title).slice(0, 300), text, links, links_truncated: linkCount > links.length, extraction: article ? "readability" : "fallback" };
  } finally { dom.window.close(); }
}

export async function webRead(value: string, settings: WebReadSettings = DEFAULT_WEB_READ_SETTINGS, request: typeof fetch = fetch, offset = 0): Promise<ToolResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeout_ms);
  try {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Page offset must be a nonnegative safe integer.");
    let url = pageUrl(value.trim());
    let response: Response;
    let redirects = 0;
    while (true) {
      response = await request(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "text/html, application/xhtml+xml, text/plain;q=0.9", "User-Agent": "BishopAgent/0.1 (page reader)" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Page redirect has no destination.");
      if (++redirects > 5) throw new Error("Page exceeded the 5-redirect limit.");
      url = pageUrl(new URL(location, url).href);
    }
    if (!response.ok || response.status === 202) {
      await response.body?.cancel();
      throw new Error(`Page request failed (HTTP ${response.status})${[202, 401, 403, 429].includes(response.status) ? "; login, a bot challenge, or rate limiting may require browser access" : ""}.`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const mime = contentType.split(';')[0]!.trim().toLowerCase();
    if (!["text/html", "application/xhtml+xml", "text/plain"].includes(mime)) {
      await response.body?.cancel();
      throw new Error(`Unsupported page content type: ${mime || "missing"}. Expected HTML or plain text.`);
    }
    if (!response.body) throw new Error("Page returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.byteLength;
        if (bytes > settings.max_bytes) {
          await reader.cancel();
          throw new Error(`Page response exceeded the ${settings.max_bytes}-byte limit.`);
        }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? "utf-8";
    const body = new TextDecoder(charset).decode(Buffer.concat(chunks));
    const page = mime === "text/plain" ? { title: "", text: body.replace(/\r\n?/g, '\n').trim(), links: [], links_truncated: false, extraction: "plain_text" } : extractPage(body, url.href, settings.link_limit);
    if (!page.text) throw new Error("Page has no readable content.");
    if (offset >= page.text.length && offset !== 0) throw new Error(`Page offset ${offset} is beyond the readable text (${page.text.length} UTF-16 units).`);
    if (/[\uDC00-\uDFFF]/.test(page.text[offset]!)) throw new Error("Page offset splits a Unicode character; use the returned next_offset.");
    let end = Math.min(page.text.length, offset + settings.max_characters);
    // Avoid splitting an astral character at chunk boundaries.
    if (end < page.text.length && /[\uDC00-\uDFFF]/.test(page.text[end]!)) end--;
    if (end === offset) throw new Error("The configured text limit is too small for this Unicode character; increase max_characters.");
    const text = page.text.slice(offset, end);
    return { ok: true, data: { ...page, text, url: url.href, content_type: mime, bytes, offset, total_characters: page.text.length, truncated: end < page.text.length, next_offset: end < page.text.length ? end : null } };
  } catch (error) {
    return { ok: false, error: controller.signal.aborted ? `Page reading timed out after ${settings.timeout_ms} ms.` : error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
}
