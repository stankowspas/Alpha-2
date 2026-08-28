import { describe, expect, it } from "vitest";
import { SafeEvidenceFetcher, type PinnedTransport, type TransportResponse } from "../../server/fetch-extract/src/fetcher";
import { resolvePublicTarget, validateRemoteUrl, type ResolveHost } from "../../server/fetch-extract/src/security";

const SOURCE = "SRC-aaaaaaaaaaaaaaaaaaaa";
const publicResolver: ResolveHost = async (hostname) => {
  if (hostname === "127.0.0.1") return [{ address: "127.0.0.1", family: 4 }];
  return [{ address: "93.184.216.34", family: 4 }];
};

class QueueTransport implements PinnedTransport {
  calls: string[] = [];
  constructor(private readonly responses: TransportResponse[]) {}

  async request(target: Parameters<PinnedTransport["request"]>[0]): Promise<TransportResponse> {
    this.calls.push(target.url.toString());
    const next = this.responses.shift();
    if (!next) throw new Error("No fake response.");
    return next;
  }
}

function response(statusCode: number, headers: Record<string, string>, body = ""): TransportResponse {
  return {
    statusCode,
    headers,
    body: Buffer.from(body, "utf8")
  };
}

describe("fetch SSRF guards", () => {
  it("rejects unsupported schemes, credentials, custom ports and localhost", () => {
    expect(() => validateRemoteUrl("file:///etc/passwd")).toThrow(/HTTP/u);
    expect(() => validateRemoteUrl("https://user:pass@example.com/")).toThrow(/credentials/u);
    expect(() => validateRemoteUrl("https://example.com:8443/")).toThrow(/port/u);
    expect(() => validateRemoteUrl("http://localhost/")).toThrow(/Local\/internal/u);
  });

  it("rejects private DNS answers and numeric localhost forms", async () => {
    await expect(resolvePublicTarget("https://example.com/", async () => [{ address: "10.0.0.7", family: 4 }]))
      .rejects.toThrow(/непублична/u);
    await expect(resolvePublicTarget("http://2130706433/"))
      .rejects.toThrow(/непублична/u);
    await expect(resolvePublicTarget("http://[::1]/"))
      .rejects.toThrow(/непублична/u);
  });

  it("blocks a redirect to private IP before a second transport request", async () => {
    const transport = new QueueTransport([
      response(302, { location: "https://127.0.0.1/private" })
    ]);
    const fetcher = new SafeEvidenceFetcher({ resolver: publicResolver, transport });

    await expect(fetcher.fetch({ sourceId: SOURCE, url: "https://example.com/start", maxChars: 2_000 }))
      .rejects.toThrow(/непублична/u);
    expect(transport.calls).toHaveLength(1);
  });

  it("blocks HTTPS downgrade redirects", async () => {
    const transport = new QueueTransport([
      response(302, { location: "http://example.org/plain" })
    ]);
    const fetcher = new SafeEvidenceFetcher({ resolver: publicResolver, transport });

    await expect(fetcher.fetch({ sourceId: SOURCE, url: "https://example.com/start", maxChars: 2_000 }))
      .rejects.toThrow(/HTTPS към HTTP/u);
  });

  it("extracts bounded untrusted evidence from a public HTML response", async () => {
    const transport = new QueueTransport([
      response(200, { "content-type": "text/html; charset=utf-8" }, "<html><head><title>Title</title><script>ignore()</script></head><body><h1>Факт</h1><p>Проверим текст.</p></body></html>")
    ]);
    const fetcher = new SafeEvidenceFetcher({ resolver: publicResolver, transport });
    const document = await fetcher.fetch({ sourceId: SOURCE, url: "https://example.com/a#fragment", maxChars: 2_000 });

    expect(document.untrusted).toBe(true);
    expect(document.sourceId).toBe(SOURCE);
    expect(document.canonicalUrl).toBe("https://example.com/a");
    expect(document.title).toBe("Title");
    expect(document.text).toContain("Проверим текст.");
    expect(document.text).not.toContain("ignore()");
    expect(document.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
