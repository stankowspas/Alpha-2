import type { GenerationInput, ModelAdapter, ModelCapabilities, ModelGenerationMetadata } from "@alpha/models";

export const CLOUDFLARE_ENDPOINT = "https://alpha2-cloud-ai-test.stankowspas.workers.dev";
const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export type ChatLine = { role: "user" | "assistant"; content: string };

export class CloudflareGemmaAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 9000, thinkingSupport: false, structuredOutputSupport: false,
    toolCallSupport: false, stopTokens: [], modelId: MODEL_ID,
  };
  loaded = false;
  siteKey = "";
  lastGenerationMetadata?: ModelGenerationMetadata;
  private verificationToken = "";

  async load(onProgress?: (progress: number, text: string) => void): Promise<void> {
    onProgress?.(0, "Проверка на Cloudflare AI…");
    const response = await fetch(`${CLOUDFLARE_ENDPOINT}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cloudflare AI не е достъпен (HTTP ${response.status}).`);
    const status: { available?: boolean; model?: string; siteKey?: string | null } = await response.json();
    if (!status.available || !status.siteKey || status.model !== MODEL_ID) {
      throw new Error("Cloudflare AI не е готов: необходимо е да се конфигурират Turnstile и ограниченията на заявките.");
    }
    this.siteKey = status.siteKey;
    this.loaded = true;
    onProgress?.(1, "Gemma 4 е свързан. Потвърди Turnstile, за да изпратиш въпрос.");
  }

  setVerificationToken(token: string): void { this.verificationToken = token; }

  async generateConversation(messages: ChatLine[], signal?: AbortSignal): Promise<string> {
    if (!this.loaded) throw new Error("Cloudflare AI не е свързан.");
    const token = this.verificationToken;
    this.verificationToken = "";
    if (!token) throw new Error("Потвърди проверката Turnstile преди изпращане.");
    const response = await fetch(`${CLOUDFLARE_ENDPOINT}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, turnstileToken: token }), cache: "no-store", signal,
    });
    let data: { answer?: string; error?: string };
    try { data = await response.json(); } catch { throw new Error(`Невалиден отговор от Cloudflare (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(data.error || `Cloudflare AI върна HTTP ${response.status}.`);
    if (!data.answer?.trim()) throw new Error("Моделът не върна отговор.");
    this.lastGenerationMetadata = {
      requestedModel: MODEL_ID, actualModel: MODEL_ID, provider: "cloudflare-workers-ai",
      fallbackUsed: false, fallbackReason: null, providerSources: [],
    };
    return data.answer.trim();
  }

  async *generate(input: GenerationInput): AsyncIterable<string> {
    // The server owns the system prompt; client-provided system prompts are never trusted.
    yield await this.generateConversation([{ role: "user", content: input.userPrompt }], input.signal);
  }

  async unload(): Promise<void> {
    this.loaded = false;
    this.siteKey = "";
    this.verificationToken = "";
    this.lastGenerationMetadata = undefined;
  }
}
