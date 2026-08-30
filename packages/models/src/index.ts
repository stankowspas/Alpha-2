export const GEMINI_PRIMARY_MODEL_ID = "gemini-3.6-flash";
export const GEMINI_FALLBACK_MODEL_ID = "gemini-3.5-flash";

export interface ModelCapabilities {
  maxContext: number;
  thinkingSupport: boolean;
  structuredOutputSupport: boolean;
  toolCallSupport: boolean;
  stopTokens: readonly string[];
  modelId: string;
}

export interface GenerationInput {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  thinking: boolean;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ModelGenerationMetadata {
  requestedModel: string;
  actualModel: string;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
  provider?: string;
  providerSources?: string[];
}

export interface ModelAdapter {
  readonly capabilities: ModelCapabilities;
  readonly loaded: boolean;
  readonly lastGenerationMetadata?: ModelGenerationMetadata;
  load(onProgress?: (progress: number, text: string) => void): Promise<void>;
  generate(input: GenerationInput): AsyncIterable<string>;
  unload(): Promise<void>;
}

export interface BrowserGeminiModelAdapterOptions {
  apiKey?: string;
  requestedModel?: string;
  fallbackModel?: string;
  fetchImpl?: typeof fetch;
}

type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string } }>;
    };
  }>;
};

function collectSources(chunk: GeminiChunk, target: string[]): void {
  for (const candidate of chunk.candidates ?? []) {
    for (const item of candidate.groundingMetadata?.groundingChunks ?? []) {
      const uri = item.web?.uri?.trim();
      if (uri && !target.includes(uri)) target.push(uri);
      if (target.length >= 12) return;
    }
  }
}

function chunkTexts(chunk: GeminiChunk): string[] {
  const result: string[] = [];
  for (const candidate of chunk.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.length > 0) result.push(part.text);
    }
  }
  return result;
}

function apiUrl(modelId: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
}

export class BrowserGeminiModelAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities;
  readonly #apiKey: string;
  readonly #requestedModel: string;
  readonly #fallbackModel: string;
  readonly #fetch: typeof fetch;
  #loaded = false;
  #lastGenerationMetadata?: ModelGenerationMetadata;

  constructor(options: BrowserGeminiModelAdapterOptions = {}) {
    this.#apiKey = options.apiKey?.trim() ?? "";
    this.#requestedModel = options.requestedModel ?? GEMINI_PRIMARY_MODEL_ID;
    this.#fallbackModel = options.fallbackModel ?? GEMINI_FALLBACK_MODEL_ID;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.capabilities = {
      maxContext: 32768,
      thinkingSupport: false,
      structuredOutputSupport: false,
      toolCallSupport: false,
      stopTokens: [],
      modelId: this.#requestedModel
    };
  }

  get loaded(): boolean { return this.#loaded; }
  get lastGenerationMetadata(): ModelGenerationMetadata | undefined { return this.#lastGenerationMetadata; }

  async load(onProgress?: (progress: number, text: string) => void): Promise<void> {
    if (this.#loaded) return;
    onProgress?.(0.25, "Проверка на browser Gemini runtime...");
    if (!this.#apiKey) throw new Error("GEMINI_API_KEY_MISSING: Gemini API key is not configured in this build.");
    this.#loaded = true;
    onProgress?.(1, "Browser Gemini runtime е готов.");
  }

  async *generate(input: GenerationInput): AsyncIterable<string> {
    if (!this.#loaded) throw new Error("BrowserGeminiModelAdapter: runtime не е зареден.");
    if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    this.#lastGenerationMetadata = undefined;
    const candidates = [...new Set([this.#requestedModel, this.#fallbackModel])];
    let lastError: Error | undefined;

    for (const modelId of candidates) {
      try {
        let emitted = false;
        const providerSources: string[] = [];
        const generationConfig: Record<string, number> = { maxOutputTokens: input.maxTokens };
        if (typeof input.temperature === "number") generationConfig.temperature = input.temperature;

        const response = await this.#fetch(apiUrl(modelId), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.#apiKey
          },
          body: JSON.stringify({
            ...(input.systemPrompt.trim() ? {
              systemInstruction: { parts: [{ text: input.systemPrompt }] }
            } : {}),
            contents: [{ role: "user", parts: [{ text: input.userPrompt }] }],
            generationConfig
          }),
          signal: input.signal
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`GEMINI_HTTP_${response.status}: ${detail.slice(0, 240)}`);
        }
        if (!response.body) throw new Error("GEMINI_STREAM_EMPTY: response has no body.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/u);
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const dataLines = block.split(/\r?\n/u)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim());
              if (!dataLines.length) continue;
              const payload = JSON.parse(dataLines.join("\n")) as GeminiChunk;
              collectSources(payload, providerSources);
              for (const text of chunkTexts(payload)) {
                emitted = true;
                yield text;
              }
            }
          }
        } finally {
          void reader.cancel().catch(() => undefined);
        }

        if (buffer.trim()) {
          const data = buffer.split(/\r?\n/u)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (data) {
            const payload = JSON.parse(data) as GeminiChunk;
            collectSources(payload, providerSources);
            for (const text of chunkTexts(payload)) {
              emitted = true;
              yield text;
            }
          }
        }

        if (!emitted) throw new Error("MODEL_EMPTY_RESPONSE: Gemini returned no text.");

        this.#lastGenerationMetadata = {
          requestedModel: this.#requestedModel,
          actualModel: modelId,
          fallbackUsed: modelId !== this.#requestedModel,
          fallbackReason: modelId !== this.#requestedModel ? "requested_model_provider_error" : null,
          provider: "gemini-api-browser",
          providerSources
        };
        return;
      } catch (error) {
        if (input.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error("AI_BACKEND_UNAVAILABLE: browser Gemini generation failed.");
  }

  async unload(): Promise<void> {
    this.#loaded = false;
    this.#lastGenerationMetadata = undefined;
  }
}
