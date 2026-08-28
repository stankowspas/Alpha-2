import { describe, expect, it, vi } from "vitest";
import { RemoteGeminiModelAdapter } from "@alpha/models";

function sseResponse(blocks: string[]): Response {
  const body = blocks.join("\n\n") + "\n\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

const generationInput = {
  systemPrompt: "system",
  userPrompt: "hello",
  maxTokens: 64,
  thinking: false
};
describe("RemoteGeminiModelAdapter", () => {
  it("loads only when backend reports free-only and an available model", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", free_only: true, provider_available: true }))
      .mockResolvedValueOnce(jsonResponse([
        { model_id: "gemini-3.6-flash", free_allowed: true, availability: "AVAILABLE" }
      ]));
    const adapter = new RemoteGeminiModelAdapter({ fetchImpl });

    await adapter.load();

    expect(adapter.loaded).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a backend that violates free-only policy", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", free_only: false, provider_available: true }));
    const adapter = new RemoteGeminiModelAdapter({ fetchImpl });

    await expect(adapter.load()).rejects.toThrow("free-only policy");
    expect(adapter.loaded).toBe(false);
  });

  it("streams tokens and records actual model/fallback metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", free_only: true, provider_available: true }))
      .mockResolvedValueOnce(jsonResponse([{ free_allowed: true, availability: "AVAILABLE" }]))
      .mockResolvedValueOnce(sseResponse([
        "event: start\ndata: {\"freeOnly\":true}",
        "event: model_selected\ndata: {\"requestedModel\":\"gemini-3.6-flash\",\"actualModel\":\"gemini-3.5-flash\",\"fallbackUsed\":true,\"fallbackReason\":\"requested_model_unavailable\"}",
        "event: token\ndata: {\"text\":\"Hello \"}",
        "event: token\ndata: {\"text\":\"world\"}",
        "event: metadata\ndata: {\"provider\":\"g4f-gemini\"}",
        "event: done\ndata: {\"actualModel\":\"gemini-3.5-flash\"}"
      ]));
    const adapter = new RemoteGeminiModelAdapter({ fetchImpl });
    await adapter.load();

    let output = "";
    for await (const token of adapter.generate(generationInput)) output += token;

    expect(output).toBe("Hello world");
    expect(adapter.lastGenerationMetadata).toEqual({
      requestedModel: "gemini-3.6-flash",
      actualModel: "gemini-3.5-flash",
      fallbackUsed: true,
      fallbackReason: "requested_model_unavailable",
      provider: "g4f-gemini"
    });
  });

  it("surfaces explicit backend stream errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", free_only: true, provider_available: true }))
      .mockResolvedValueOnce(jsonResponse([{ free_allowed: true, availability: "AVAILABLE" }]))
      .mockResolvedValueOnce(sseResponse([
        "event: start\ndata: {\"freeOnly\":true}",
        "event: error\ndata: {\"code\":\"FREE_MODEL_UNAVAILABLE\",\"message\":\"No allowed free model.\"}"
      ]));
    const adapter = new RemoteGeminiModelAdapter({ fetchImpl });
    await adapter.load();

    const consume = async () => {
      for await (const _token of adapter.generate(generationInput)) { /* consume */ }
    };

    await expect(consume()).rejects.toThrow("FREE_MODEL_UNAVAILABLE");
  });

  it("fails closed when stream ends without done", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", free_only: true, provider_available: true }))
      .mockResolvedValueOnce(jsonResponse([{ free_allowed: true, availability: "AVAILABLE" }]))
      .mockResolvedValueOnce(sseResponse([
        "event: model_selected\ndata: {\"requestedModel\":\"gemini-3.6-flash\",\"actualModel\":\"gemini-3.6-flash\",\"fallbackUsed\":false}",
        "event: token\ndata: {\"text\":\"partial\"}"
      ]));
    const adapter = new RemoteGeminiModelAdapter({ fetchImpl });
    await adapter.load();
    const consume = async () => {
      for await (const _token of adapter.generate(generationInput)) { /* consume */ }
    };

    await expect(consume()).rejects.toThrow("AI_STREAM_INCOMPLETE");
  });

  it("releases a hung SSE read immediately when caller aborts", async () => {
    const hangingResponse = new Response(new ReadableStream<Uint8Array>({ start() { /* intentionally never settles */ } }), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", free_only: true, provider_available: true }))
      .mockResolvedValueOnce(jsonResponse([{ free_allowed: true, availability: "AVAILABLE" }]))
      .mockResolvedValueOnce(hangingResponse)
      .mockResolvedValueOnce(jsonResponse({ cancelRequested: true }));
    const adapter = new RemoteGeminiModelAdapter({ fetchImpl });
    await adapter.load();
    const controller = new AbortController();
    const consume = async () => {
      for await (const _token of adapter.generate({ ...generationInput, signal: controller.signal })) { /* consume */ }
    };

    const started = Date.now();
    const pending = consume();
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
