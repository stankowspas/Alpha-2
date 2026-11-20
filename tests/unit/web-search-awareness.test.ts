import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareGemmaAdapter,
  withWebSearchAwareness,
  type ChatLine,
} from "../../apps/web/src/app/cloudflare-gemma";

const conversation: ChatLine[] = [
  { role: "user", content: "Здравей" },
  { role: "assistant", content: "Здравей!" },
  { role: "user", content: "Кой е президентът на Русия?" },
];

afterEach(() => vi.unstubAllGlobals());

describe("Alpha 2 web-search awareness", () => {
  it("keeps the original question and only adds conditional context for Groq and Gemini", () => {
    for (const model of ["gpt-oss-120b", "gemini-flash-lite"] as const) {
      for (const mode of ["on", "auto"] as const) {
        const result = withWebSearchAwareness(conversation, true, mode, model);
        expect(result).toHaveLength(conversation.length);
        expect(result.slice(0, -1)).toEqual(conversation.slice(0, -1));
        expect(result.at(-1)?.content.startsWith("Кой е президентът на Русия?")).toBe(true);
        expect(result.at(-1)?.content).toContain("УЕБ ИЗТОЧНИЦИ");
        expect(result.at(-1)?.content).toContain("Tavily");
        expect(result.at(-1)?.content).toContain("Ако източници липсват");
      }
    }
    expect(conversation.at(-1)?.content).toBe("Кой е президентът на Русия?");
  });

  it("does not modify Gemma 4, disabled search, or unavailable search", () => {
    expect(withWebSearchAwareness(conversation, true, "on", "gemma4")).toBe(conversation);
    expect(withWebSearchAwareness(conversation, true, "off", "gpt-oss-120b")).toBe(conversation);
    expect(withWebSearchAwareness(conversation, false, "auto", "gemini-flash-lite")).toBe(conversation);
  });

  it("passes the awareness context to Groq without changing the webSearch flag", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/status")) {
        return Response.json({
          available: true,
          model: "@cf/google/gemma-4-26b-a4b-it",
          searchAvailable: true,
          models: [{ id: "gpt-oss-120b", available: true }],
        });
      }
      expect(url.endsWith("/api/chat")).toBe(true);
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-oss-120b");
      expect(body.webSearch).toBe("auto");
      expect(body.messages.at(-1).content).toContain("УЕБ ИЗТОЧНИЦИ");
      expect(body.messages.at(-1).content.startsWith("Кой е президентът на Русия?")).toBe(true);
      return Response.json({ answer: "Отговор", webSearch: { used: true, sources: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new CloudflareGemmaAdapter();
    await adapter.load();
    const reply = await adapter.generateConversationWithSources(conversation, "auto", undefined, "gpt-oss-120b");
    expect(reply.answer).toBe("Отговор");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
