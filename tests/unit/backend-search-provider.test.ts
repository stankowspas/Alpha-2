import { describe, expect, it } from "vitest";
import { BackendSearchProviderAdapter } from "@alpha/retrieval";

function validResult(providerId = "web-no-key") {
  return {
    sourceId: "SRC-abc",
    title: "Result",
    url: "https://example.com/result",
    snippet: "Snippet",
    retrievedAtUtc: "2026-08-24T16:00:00.000Z",
    providerId
  };
}

describe("BackendSearchProviderAdapter", () => {
  it("sends only the minimal search payload", async () => {
    let sentBody: unknown;
    const adapter = new BackendSearchProviderAdapter({
      endpoint: "http://127.0.0.1:5174/api/search",
      fetchImpl: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          ok: true,
          providerId: "web-no-key",
          query: "актуален тест",
          freshnessHint: "CURRENT",
          results: [validResult()]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const results = await adapter.search({ query: "актуален тест", maxResults: 3, freshnessHint: "CURRENT" });

    expect(sentBody).toEqual({ query: "актуален тест", maxResults: 3, freshnessHint: "CURRENT" });
    expect(results).toHaveLength(1);
  });

  it("rejects a providerId mismatch inside returned provenance", async () => {
    const adapter = new BackendSearchProviderAdapter({
      endpoint: "http://127.0.0.1:5174/api/search",
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        providerId: "web-no-key",
        query: "test",
        results: [validResult("other-provider")]
      }), { status: 200, headers: { "content-type": "application/json" } })
    });

    await expect(adapter.search({ query: "test", maxResults: 2 }))
      .rejects.toThrow(/provenance структура/u);
  });

  it("surfaces a sanitized backend availability error", async () => {
    const adapter = new BackendSearchProviderAdapter({
      endpoint: "http://127.0.0.1:5174/api/search",
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        code: "SEARCH_UNAVAILABLE",
        message: "Live search не е конфигуриран."
      }), { status: 503, headers: { "content-type": "application/json" } })
    });

    await expect(adapter.search({ query: "test", maxResults: 2 }))
      .rejects.toThrow(/SEARCH_UNAVAILABLE/u);
  });
});

