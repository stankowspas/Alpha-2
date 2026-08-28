import { describe, expect, it } from "vitest";
import { createSourceFetchToken } from "../../server/source-token/src/index";
import { FetchApiService } from "../../server/fetch-extract/src/api";
import { SafeEvidenceFetcher, type FetchEvidenceRequest } from "../../server/fetch-extract/src/fetcher";

const SECRET = "alpha-test-secret-0123456789abcdef";
const SOURCE = "SRC-aaaaaaaaaaaaaaaaaaaa";
const URL = "https://example.com/article";

class FakeFetcher extends SafeEvidenceFetcher {
  calls = 0;

  override async fetch(request: FetchEvidenceRequest) {
    this.calls += 1;
    return {
      evidenceId: "EVD-bbbbbbbbbbbbbbbbbbbb",
      sourceId: request.sourceId,
      canonicalUrl: request.url,
      mimeType: "text/plain",
      text: "Проверим текст.",
      contentHash: "c".repeat(64),
      retrievedAtUtc: "2026-08-24T16:00:00.000Z",
      untrusted: true as const,
      fetchedBytes: 16,
      truncated: false,
      extractorId: "fake"
    };
  }
}

describe("FetchApiService capability gate", () => {
  it("rejects an invalid token before invoking remote fetch", async () => {
    const fetcher = new FakeFetcher();
    const service = new FetchApiService(SECRET, fetcher);

    await expect(service.handle({
      sourceId: SOURCE,
      url: URL,
      fetchToken: "x".repeat(64),
      maxChars: 12_000
    })).rejects.toMatchObject({ code: "FETCH_CAPABILITY_DENIED" });
    expect(fetcher.calls).toBe(0);
  });

  it("allows the exact signed source and rejects unknown payload fields", async () => {
    const fetcher = new FakeFetcher();
    const service = new FetchApiService(SECRET, fetcher);
    const token = createSourceFetchToken(SECRET, SOURCE, URL);

    const result = await service.handle({ sourceId: SOURCE, url: URL, fetchToken: token, maxChars: 12_000 });
    expect(result.document.sourceId).toBe(SOURCE);
    expect(fetcher.calls).toBe(1);

    await expect(service.handle({ sourceId: SOURCE, url: URL, fetchToken: token, maxChars: 12_000, history: [] }))
      .rejects.toMatchObject({ code: "UNEXPECTED_FIELDS" });
  });
});
