import type { GenerationInput, ModelAdapter, ModelCapabilities, ModelGenerationMetadata } from "@alpha/models";

export const CLOUDFLARE_ENDPOINT = "https://alpha2-cloud-ai-test.stankowspas.workers.dev";
const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export type ChatLine = { role: "user" | "assistant"; content: string };
export type WebSearchMode = "auto" | "on" | "off";
export interface WebSource { title: string; url: string; publishedAt?: string }
export interface ChatReply { answer: string; sources: WebSource[]; searchWarning: boolean }

export class CloudflareGemmaAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 256000, thinkingSupport: true, structuredOutputSupport: false,
    toolCallSupport: false, stopTokens: [], modelId: MODEL_ID,
  };
  loaded = false;
  searchAvailable = false;
  lastGenerationMetadata?: ModelGenerationMetadata;

  async load(onProgress?: (progress: number, text: string) => void): Promise<void> {
    onProgress?.(0, "Проверка на Cloudflare AI…");
    const response = await fetch(`${CLOUDFLARE_ENDPOINT}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cloudflare AI не е достъпен (HTTP ${response.status}).`);
    const status: { available?: boolean; model?: string; searchAvailable?: boolean } = await response.json();
    if (!status.available || status.model !== MODEL_ID) {
      throw new Error("Cloudflare AI не е готов: липсва активна връзка с модела.");
    }
    this.loaded = true;
    this.searchAvailable = status.searchAvailable === true;
    onProgress?.(1, "Gemma 4 е свързан. Можеш да изпратиш въпрос.");
  }

  async generateConversationWithSources(messages: ChatLine[], webSearch: WebSearchMode = "auto", signal?: AbortSignal): Promise<ChatReply> {
    if (!this.loaded) throw new Error("Cloudflare AI не е свързан.");
    const response = await fetch(`${CLOUDFLARE_ENDPOINT}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, webSearch }), cache: "no-store", signal,
    });
    let data: { answer?: string; error?: string; webSearch?: { sources?: WebSource[]; used?: boolean; warning?: string } };
    try { data = await response.json(); } catch { throw new Error(`Невалиден отговор от Cloudflare (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(data.error || `Cloudflare AI върна HTTP ${response.status}.`);
    if (!data.answer?.trim()) throw new Error("Моделът не върна отговор.");
    this.lastGenerationMetadata = {
      requestedModel: MODEL_ID, actualModel: MODEL_ID, provider: "cloudflare-workers-ai",
      fallbackUsed: false, fallbackReason: null, providerSources: [],
    };
    const sources = Array.isArray(data.webSearch?.sources) ? data.webSearch.sources.filter((source): source is WebSource => {
      if (!source || typeof source.title !== "string" || typeof source.url !== "string") return false;
      try {
        const url = new URL(source.url);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    }) : [];
    return { answer: data.answer.trim(), sources, searchWarning: Boolean(data.webSearch?.warning) };
  }

  async generateConversation(messages: ChatLine[], signal?: AbortSignal): Promise<string> {
    const reply = await this.generateConversationWithSources(messages, "auto", signal);
    return reply.answer;
  }

  async *generate(input: GenerationInput): AsyncIterable<string> {
    // The server owns the system prompt; client-provided system prompts are never trusted.
    yield await this.generateConversation([{ role: "user", content: input.userPrompt }], input.signal);
  }

  async unload(): Promise<void> {
    this.loaded = false;
    this.searchAvailable = false;
    this.lastGenerationMetadata = undefined;
  }
}
