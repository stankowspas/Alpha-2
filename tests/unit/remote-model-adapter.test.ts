import { describe, expect, it, vi } from "vitest";
import { BrowserGeminiModelAdapter } from "@alpha/models";

function streamResponse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const generationInput = {
  systemPrompt: "system",
  userPrompt: "hello",
  maxTokens: 64,
  thinking: false
};

describe("BrowserGeminiModelAdapter", () => {
  it("requires a configured API key", async () => {
    const adapter = new BrowserGeminiModelAdapter({ apiKey: "" });
    await expect(adapter.load()).rejects.toThrow("GEMINI_API_KEY_MISSING");
  });

  it("loads locally without a backend health probe", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new BrowserGeminiModelAdapter({ apiKey: "test-key", fetchImpl });
    await adapter.load();
    expect(adapter.loaded).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("streams Gemini SSE text directly in the browser", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(streamResponse([
      { candidates: [{ content: { parts: [{ text: "Hello " }] } }] },
      { candidates: [{ content: { parts: [{ text: "world" }] } }] }
    ]));
    const adapter = new BrowserGeminiModelAdapter({ apiKey: "test-key", fetchImpl });
    await adapter.load();

    let output = "";
    for await (const token of adapter.generate(generationInput)) output += token;

    expect(output).toBe("Hello world");
    expect(adapter.lastGenerationMetadata).toMatchObject({
      actualModel: "gemini-3.6-flash",
      fallbackUsed: false,
      provider: "gemini-api-browser"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("streamGenerateContent?alt=sse");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
  });

  it("falls back to the second free model after provider failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(streamResponse([
        { candidates: [{ content: { parts: [{ text: "fallback" }] } }] }
      ]));
    const adapter = new BrowserGeminiModelAdapter({ apiKey: "test-key", fetchImpl });
    await adapter.load();

    let output = "";
    for await (const token of adapter.generate(generationInput)) output += token;

    expect(output).toBe("fallback");
    expect(adapter.lastGenerationMetadata).toMatchObject({
      actualModel: "gemini-3.5-flash",
      fallbackUsed: true
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("passes AbortSignal to the browser fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
      return new Response();
    });
    const adapter = new BrowserGeminiModelAdapter({ apiKey: "test-key", fetchImpl });
    await adapter.load();
    const controller = new AbortController();
    const consume = async () => {
      for await (const _token of adapter.generate({ ...generationInput, signal: controller.signal })) { /* consume */ }
    };

    const pending = consume();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
