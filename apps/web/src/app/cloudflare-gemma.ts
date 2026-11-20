import type { GenerationInput, ModelAdapter, ModelCapabilities, ModelGenerationMetadata } from "@alpha/models";

export const CLOUDFLARE_ENDPOINT = "https://alpha2-cloud-ai-test.stankowspas.workers.dev";
const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export type ChatLine = { role: "user" | "assistant"; content: string };
export type WebSearchMode = "auto" | "on" | "off";
export type AiModelId = "gemma4" | "gpt-oss-120b" | "gemini-flash-lite";
export const MODEL_LABELS: Record<AiModelId, string> = {
  gemma4: "Gemma 4", "gpt-oss-120b": "GPT-OSS 120B", "gemini-flash-lite": "Gemini 3.5 Flash-Lite"
};
export const MODEL_PROVIDERS: Record<AiModelId, string> = {
  gemma4: "Cloudflare AI", "gpt-oss-120b": "Groq Free", "gemini-flash-lite": "Google Free"
};
export interface WebSource { title: string; url: string; publishedAt?: string }
export interface ChatReply { answer: string; sources: WebSource[]; searchWarning: boolean; modelId: AiModelId }

export class CloudflareGemmaAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 256000, thinkingSupport: true, structuredOutputSupport: false,
    toolCallSupport: false, stopTokens: [], modelId: MODEL_ID,
  };
  loaded = false;
  searchAvailable = false;
  availableModels: Record<AiModelId, boolean> = {
    gemma4: true, "gpt-oss-120b": false, "gemini-flash-lite": false
  };
  lastGenerationMetadata?: ModelGenerationMetadata;

  async load(onProgress?: (progress: number, text: string) => void): Promise<void> {
    onProgress?.(0, "Проверка на Cloudflare AI…");
    const response = await fetch(`${CLOUDFLARE_ENDPOINT}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cloudflare AI не е достъпен (HTTP ${response.status}).`);
    const status: {
      available?: boolean; model?: string; searchAvailable?: boolean;
      models?: Array<{ id?: string; available?: boolean }>
    } = await response.json();
    if (!status.available || status.model !== MODEL_ID) {
      throw new Error("Cloudflare AI не е готов: липсва активна връзка с модела.");
    }
    this.loaded = true;
    this.searchAvailable = status.searchAvailable === true;
    // An older deployed Worker may not provide a models list; only Gemma 4 is then enabled.
    this.availableModels = {
      gemma4: true,
      "gpt-oss-120b": status.models?.some(item => item.id === "gpt-oss-120b" && item.available === true) === true,
      "gemini-flash-lite": status.models?.some(item => item.id === "gemini-flash-lite" && item.available === true) === true,
    };
    onProgress?.(1, "Gemma 4 е свързан. Можеш да изпратиш въпрос.");
  }

  async generateConversationWithSources(messages: ChatLine[], webSearch: WebSearchMode = "auto", signal?: AbortSignal, selectedModel: AiModelId = "gemma4"): Promise<ChatReply> {
    if (!this.loaded) throw new Error("Cloudflare AI не е свързан.");
    if (!this.availableModels[selectedModel]) throw new Error("Избраният AI модел още не е конфигуриран.");
    const response = await fetch(`${CLOUDFLARE_ENDPOINT}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, webSearch, model: selectedModel }), cache: "no-store", signal,
    });
    let data: { answer?: string; error?: string; webSearch?: { sources?: WebSource[]; used?: boolean; warning?: string } };
    try { data = await response.json(); } catch { throw new Error(`Невалиден отговор от Cloudflare (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(data.error || `Cloudflare AI върна HTTP ${response.status}.`);
    if (!data.answer?.trim()) throw new Error("Моделът не върна отговор.");
    this.lastGenerationMetadata = {
      requestedModel: selectedModel, actualModel: selectedModel,
      provider: selectedModel === "gemma4" ? "cloudflare-workers-ai" : selectedModel === "gpt-oss-120b" ? "groq" : "google",
      fallbackUsed: false, fallbackReason: null, providerSources: [],
    };
    const sources = Array.isArray(data.webSearch?.sources) ? data.webSearch.sources.filter((source): source is WebSource => {
      if (!source || typeof source.title !== "string" || typeof source.url !== "string") return false;
      try {
        const url = new URL(source.url);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    }) : [];
    return { answer: data.answer.trim(), sources, searchWarning: Boolean(data.webSearch?.warning), modelId: selectedModel };
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
    this.availableModels = {gemma4: true, "gpt-oss-120b": false, "gemini-flash-lite": false};
    this.lastGenerationMetadata = undefined;
  }
}
