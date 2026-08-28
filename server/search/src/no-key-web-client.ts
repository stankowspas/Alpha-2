import { createHash } from "node:crypto";
import type { SearchRequest, SearchResult } from "@alpha/retrieval";

const PROVIDER_ID = "web-no-key";
const BING_SEARCH = "https://www.bing.com/search";
const YAHOO_SEARCH = "https://search.yahoo.com/search";
const BRAVE_SEARCH = "https://search.brave.com/search";
const DDG_SEARCH = "https://html.duckduckgo.com/html/";

export interface NoKeyWebSearchClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

function sourceIdFor(url: string): string {
  return `SRC-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
}

function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/giu, (_m, entity: string) => {
    const e = entity.toLowerCase();
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "nbsp") return " ";    if (e.startsWith("#x")) {
      const code = Number.parseInt(e.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    }
    if (e.startsWith("#")) {
      const code = Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    }
    return _m;
  });
}

function addResult(results: SearchResult[], url: string, title: string, max: number): void {
  if (results.length >= max) return;
  let parsed: URL;
  try { parsed = new URL(decodeHtml(url)); } catch { return; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return;
  parsed.hash = "";
  const normalizedTitle = decodeHtml(stripTags(title));
  if (!normalizedTitle) return;
  const normalizedUrl = parsed.toString();
  if (results.some((item) => item.url === normalizedUrl)) return;
  results.push({
    sourceId: sourceIdFor(normalizedUrl), title: normalizedTitle,
    url: normalizedUrl, retrievedAtUtc: new Date().toISOString(), providerId: PROVIDER_ID
  });
}
function normalizeBingHref(href: string): string {
  try {
    const parsed = new URL(decodeHtml(href));
    if (parsed.hostname.endsWith("bing.com") && parsed.pathname.startsWith("/ck/a")) {
      const encoded = parsed.searchParams.get("u");
      if (encoded?.startsWith("a1")) {
        const decoded = Buffer.from(encoded.slice(2), "base64").toString("utf8");
        if (/^https?:\/\//iu.test(decoded)) return decoded;
      }
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function parseBing(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  const re = /<li[^>]+class=["'][^"']*b_algo[^"']*["'][\s\S]*?<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(re)) {
    addResult(results, normalizeBingHref(match[1] ?? ""), match[2] ?? "", max);
    if (results.length >= max) break;
  }
  return results;
}

function parseBrave(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  const re = /<a\s+href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*\bl1\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(re)) {
    const inner = match[2] ?? "";
    const titleMatch = inner.match(/class=["'][^"']*title[^"']*search-snippet-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu);
    addResult(results, match[1] ?? "", titleMatch?.[1] ?? inner, max);
    if (results.length >= max) break;
  }
  return results;
}

function normalizeYahooHref(href: string): string {
  try {
    const parsed = new URL(decodeHtml(href));
    if (parsed.hostname.endsWith("search.yahoo.com")) {
      const match = parsed.pathname.match(/\/RU=([^/]+)\/RK=/u);
      if (match?.[1]) {
        const target = decodeURIComponent(match[1]);
        if (/^https?:\/\//iu.test(target)) return target;
      }
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function parseYahoo(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  const re = /<li[^>]*>\s*<div class=["']dd algo[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][\s\S]*?<h3[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>\s*<\/h3>/giu;
  for (const match of html.matchAll(re)) {
    addResult(results, normalizeYahooHref(match[1] ?? ""), match[2] ?? "", max);
    if (results.length >= max) break;
  }
  return results;
}
function findStockTicker(results: SearchResult[]): string | undefined {
  for (const result of results) {
    const match = result.title.match(/(?:\(([A-Z]{1,5})\)|:\s*([A-Z]{1,5})\b)/u);
    const ticker = match?.[1] ?? match?.[2];
    if (ticker && !["USD", "NYSE", "ETF"].includes(ticker)) return ticker;
  }
  return undefined;
}

function parseDdg(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  const re = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(re)) {
    let href = decodeHtml(match[1] ?? "");
    if (href.startsWith("//")) href = `https:${href}`;
    try {
      const parsed = new URL(href);
      if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
        const target = parsed.searchParams.get("uddg");
        if (target) href = target;
      }
    } catch { continue; }
    addResult(results, href, match[2] ?? "", max);
    if (results.length >= max) break;
  }
  return results;
}

async function fetchHtml(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      throw new Error(`timeout ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export class NoKeyWebSearchClient {
  readonly id = PROVIDER_ID;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #userAgent: string;

  constructor(options: NoKeyWebSearchClientOptions = {}) {
    this.#timeoutMs = Math.max(2_000, Math.min(20_000, options.timeoutMs ?? 8_000));
    this.#fetch = options.fetchImpl ?? fetch;
    this.#userAgent = options.userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]> {
    const query = request.query.trim();
    if (!query) throw new Error("Search query е празна.");
    const max = Math.max(1, Math.min(10, request.maxResults));
    const effectiveQuery = /(?:цена.*акци|акци.*цена|stock\s+price|share\s+price)/iu.test(query)
      ? `${query} primary listing ticker USD`
      : query;
    const headers = { "User-Agent": this.#userAgent, "Accept-Language": "en-US,en;q=0.9,bg;q=0.7", Accept: "text/html" };
    const attempts: Array<() => Promise<SearchResult[]>> = [
      async () => {
        const url = new URL(YAHOO_SEARCH);
        url.searchParams.set("p", query);
        const initial = parseYahoo(await fetchHtml(this.#fetch, url.toString(), { headers }, this.#timeoutMs, signal), max);
        if (/(?:цена.*акци|акци.*цена|stock\s+price|share\s+price)/iu.test(query)) {
          const ticker = findStockTicker(initial);
          if (!ticker) return [];
          const refinedUrl = new URL(YAHOO_SEARCH);
          refinedUrl.searchParams.set("p", `${ticker} stock price quote today`);
          const refined = parseYahoo(await fetchHtml(this.#fetch, refinedUrl.toString(), { headers }, this.#timeoutMs, signal), max);
          return refined;
        }
        return initial;
      },
      async () => {
        const url = new URL(BRAVE_SEARCH);
        url.searchParams.set("q", effectiveQuery);
        url.searchParams.set("source", "web");
        return parseBrave(await fetchHtml(this.#fetch, url.toString(), { headers }, this.#timeoutMs, signal), max);
      },
      async () => {
        const body = new URLSearchParams({ q: effectiveQuery });
        return parseDdg(await fetchHtml(this.#fetch, DDG_SEARCH, {
          method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body
        }, this.#timeoutMs, signal), max);
      },
      async () => {
        const url = new URL(BING_SEARCH);
        url.searchParams.set("q", effectiveQuery);
        return parseBing(await fetchHtml(this.#fetch, url.toString(), { headers }, this.#timeoutMs, signal), max);
      }
    ];

    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const results = await attempt();
        if (results.length > 0) return results;
        errors.push("no usable results");
      } catch (error) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(`No-key web search failed: ${errors.join(" | ")}`);
  }
}
