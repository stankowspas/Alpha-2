import { describe, expect, it } from "vitest";
import { BackendContentFetchExtractAdapter, type SearchResult } from "@alpha/retrieval";

const source: SearchResult = {
  sourceId: "SRC-aaaaaaaaaaaaaaaaaaaa",
  title: "Result",
  url: "https://example.com/article",
  retrievedAtUtc: "2026-08-24T16:00:00.000Z",
  providerId: "web-no-key",
  fetchToken: "x".repeat(64)
};

function document(sourceId = source.sourceId) {
  return {
    evidenceId: "EVD-bbbbbbbbbbbbbbbbbbbb",
    sourceId,
    canonicalUrl: "https://example.com/article",
    title: "Article",
    mimeType: "text/html",
    text: "Проверим текст.",
    contentHash: "c".repeat(64),
    retrievedAtUtc: "2026-08-24T16:01:00.000Z",
    untrusted: true as const
  };
}

describe("BackendContentFetchExtractAdapter", () => {
  it("sends only signed source provenance and maxChars", async () => {
    let body: unknown;
    const adapter = new BackendContentFetchExtractAdapter({
      endpoint: "http://127.0.0.1:5175/api/fetch-extract",
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, document: document() }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const result = await adapter.fetchExtract({ source, maxChars: 12_000 });

    expect(body).toEqual({
      sourceId: source.sourceId,
      url: source.url,
      fetchToken: source.fetchToken,
      maxChars: 12_000
    });
    expect(result.sourceId).toBe(source.sourceId);
  });

  it("fails closed when the search result has no signed capability", async () => {
    const adapter = new BackendContentFetchExtractAdapter({
      endpoint: "http://127.0.0.1:5175/api/fetch-extract",
      fetchImpl: async () => { throw new Error("must not be called"); }
    });

    const unsigned = { ...source, fetchToken: undefined };
    await expect(adapter.fetchExtract({ source: unsigned, maxChars: 12_000 }))
      .rejects.toThrow(/capability token/u);
  });

  it("rejects evidence provenance with a mismatched sourceId", async () => {
    const adapter = new BackendContentFetchExtractAdapter({
      endpoint: "http://127.0.0.1:5175/api/fetch-extract",
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, document: document("SRC-bbbbbbbbbbbbbbbbbbbb") }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });

    await expect(adapter.fetchExtract({ source, maxChars: 12_000 }))
      .rejects.toThrow(/sourceId provenance/u);
  });

  it("rejects invalid optional evidence provenance timestamps", async () => {
    for (const invalidDocument of [
      { ...document(), publishedAt: "not-a-date" },
      { ...document(), updatedAt: "not-a-date" }
    ]) {
      const adapter = new BackendContentFetchExtractAdapter({
        endpoint: "http://127.0.0.1:5175/api/fetch-extract",
        fetchImpl: async () => new Response(JSON.stringify({ ok: true, document: invalidDocument }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      });

      await expect(adapter.fetchExtract({ source, maxChars: 12_000 }))
        .rejects.toThrow(/невалидна evidence структура/u);
    }
  });
});

