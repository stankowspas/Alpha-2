import { describe, expect, it } from "vitest";
import type { SearchRequest, SearchResult } from "@alpha/retrieval";
import { verifySourceFetchToken } from "../../server/source-token/src/index";
import { SearchApiService, type SearchClient } from "../../server/search/src/api";

const SECRET = "alpha-test-secret-0123456789abcdef";

class StubClient implements SearchClient {
  readonly id = "web-no-key";

  async search(_request: SearchRequest): Promise<SearchResult[]> {
    return [{
      sourceId: "SRC-example",
      title: "Example",
      url: "https://example.com/article",
      snippet: "Snippet",
      retrievedAtUtc: "2026-08-27T00:00:00.000Z",
      providerId: this.id
    }];
  }
}

describe("search signed source capability", () => {
  it("issues a fetch token bound to the returned sourceId and URL", async () => {
    const service = new SearchApiService(new StubClient(), SECRET);
    const response = await service.handle({ query: "example", maxResults: 1 });
    const result = response.results[0];

    expect(result.fetchToken).toBeTruthy();
    expect(() => verifySourceFetchToken(
      SECRET,
      result.fetchToken!,
      result.sourceId,
      result.url
    )).not.toThrow();
  });
});