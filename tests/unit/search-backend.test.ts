import { describe, expect, it } from "vitest";
import type { SearchRequest, SearchResult } from "@alpha/retrieval";
import {
  SearchApiRequestError,
  SearchApiService,
  parseSearchApiInput,
  type SearchClient
} from "../../server/search/src/api";
import { NoKeyWebSearchClient } from "../../server/search/src/no-key-web-client";

class StubSearchClient implements SearchClient {
  readonly id = "web-no-key";
  readonly requests: SearchRequest[] = [];

  constructor(private readonly results: SearchResult[] = []) {}

  async search(request: SearchRequest): Promise<SearchResult[]> {
    this.requests.push(request);
    return this.results;
  }
}

describe("search backend request contract", () => {
  it("accepts only the minimal search payload", () => {
    expect(parseSearchApiInput({ query: "актуални AI новини", maxResults: 4, freshnessHint: "CURRENT" }))
      .toEqual({ query: "актуални AI новини", maxResults: 4, freshnessHint: "CURRENT" });
  });

  it("rejects unexpected fields", () => {
    expect(() => parseSearchApiInput({ query: "тест", history: [] }))
      .toThrow(SearchApiRequestError);
  });

  it("enforces query and result limits before provider execution", () => {
    expect(() => parseSearchApiInput({ query: "x".repeat(401) })).toThrow(/400 символа/u);
    expect(() => parseSearchApiInput({ query: "test", maxResults: 11 })).toThrow(/между 1 и 10/u);
    expect(() => parseSearchApiInput({ query: Array.from({ length: 51 }, () => "дума").join(" ") }))
      .toThrow(/50 думи/u);
  });

  it("passes the normalized request to the no-key service boundary", async () => {
    const client = new StubSearchClient();
    const service = new SearchApiService(client);
    const response = await service.handle({ query: "  проверка   сега ", maxResults: 2 });

    expect(client.requests).toEqual([{ query: "проверка сега", maxResults: 2, freshnessHint: undefined }]);
    expect(response.providerId).toBe("web-no-key");
    expect(response.results).toEqual([]);
  });
});

describe("NoKeyWebSearchClient", () => {  it("normalizes public no-key search results", async () => {
    const html = '<li><div class="dd algo"><a href="https://example.com/article#part"><h3><span>Example result</span></h3></a></div></li>';
    const client = new NoKeyWebSearchClient({
      fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })
    });

    const results = await client.search({ query: "example query", maxResults: 3 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Example result",
      url: "https://example.com/article",
      providerId: "web-no-key"
    });
    expect(results[0].sourceId).toMatch(/^SRC-[a-f0-9]{20}$/u);
  });
});
