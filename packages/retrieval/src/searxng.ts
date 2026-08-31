import type { SearchProviderAdapter, SearchRequest, SearchResult } from "./index";

export interface SearxngSearchProviderOptions {
  baseUrl: string;
  providerId?: string;
  fetchImpl?: typeof fetch;
  language?: string;
  categories?: string[];
}

interface SearxngResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  publishedDate?: unknown;
}

interface SearxngResponse {
  results?: unknown;
}

function assertHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SearXNG baseUrl must use HTTP(S).");
  }
  return url;
}

function safeIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function makeSourceId(index: number, url: string): string {
  return `searxng:${index}:${encodeURIComponent(url).slice(0, 180)}`;
}

/**
 * Direct SearXNG JSON API adapter.
 *
 * The configured SearXNG instance must allow JSON output. When Alpha 2 is
 * served from another origin, the SearXNG deployment must also allow the
 * browser origin (CORS) or be placed behind a same-origin proxy.
 */
export class SearxngSearchProviderAdapter implements SearchProviderAdapter {
  readonly id: string;
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #language?: string;
  readonly #categories?: string[];

  constructor(options: SearxngSearchProviderOptions) {
    this.#baseUrl = assertHttpUrl(options.baseUrl);
    this.id = options.providerId?.trim() || "searxng";
    this.#fetch = options.fetchImpl ?? fetch;
    this.#language = options.language;
    this.#categories = options.categories;
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]> {
    const query = request.query.trim();
    if (!query) throw new Error("Search query is empty.");
    if (!Number.isInteger(request.maxResults) || request.maxResults < 1) {
      throw new Error("maxResults must be a positive integer.");
    }

    const endpoint = new URL("search", this.#baseUrl.toString().endsWith("/") ? this.#baseUrl : `${this.#baseUrl}/`);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    if (this.#language) endpoint.searchParams.set("language", this.#language);
    if (this.#categories?.length) endpoint.searchParams.set("categories", this.#categories.join(","));

    const response = await this.#fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal
    });

    if (!response.ok) {
      throw new Error(`SearXNG search failed with HTTP ${response.status}.`);
    }

    const body = await response.json() as SearxngResponse;
    if (!Array.isArray(body.results)) {
      throw new Error("SearXNG returned an invalid JSON response.");
    }

    const retrievedAtUtc = new Date().toISOString();
    const results: SearchResult[] = [];

    for (const [index, raw] of body.results.entries()) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as SearxngResult;
      if (typeof item.title !== "string" || typeof item.url !== "string") continue;

      try {
        assertHttpUrl(item.url);
      } catch {
        continue;
      }

      results.push({
        sourceId: makeSourceId(index, item.url),
        title: item.title.trim() || item.url,
        url: item.url,
        snippet: typeof item.content === "string" ? item.content : undefined,
        publishedAt: safeIsoDate(item.publishedDate),
        retrievedAtUtc,
        providerId: this.id
      });

      if (results.length >= request.maxResults) break;
    }

    return results;
  }
}
