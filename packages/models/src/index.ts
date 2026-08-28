export const GEMINI_PRIMARY_MODEL_ID = "gemini-3.6-flash";

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

export interface RemoteGeminiModelAdapterOptions {
  baseUrl?: string;
  requestedModel?: string;
  fetchImpl?: typeof fetch;
}

interface StreamEnvelope {
  event: "start" | "model_selected" | "token" | "metadata" | "done" | "error";
  data: Record<string, unknown>;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/u, "")}${path}`;
}

function makeRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `alpha-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function parseSseBlock(block: string): StreamEnvelope | null {
  let eventName = "";
  let dataText = "";
  for (const rawLine of block.split(/\r?\n/u)) {
    if (rawLine.startsWith("event:")) eventName = rawLine.slice(6).trim();
    else if (rawLine.startsWith("data:")) dataText += rawLine.slice(5).trim();
  }
  if (!eventName || !dataText) return null;
  const allowed = new Set(["start", "model_selected", "token", "metadata", "done", "error"]);
  if (!allowed.has(eventName)) return null;
  return {
    event: eventName as StreamEnvelope["event"],
    data: JSON.parse(dataText) as Record<string, unknown>
  };
}

export class RemoteGeminiModelAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #requestedModel: string;
  #loaded = false;
  #lastGenerationMetadata?: ModelGenerationMetadata;

  constructor(options: RemoteGeminiModelAdapterOptions = {}) {
    this.#baseUrl = options.baseUrl ?? "http://127.0.0.1:5177";
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#requestedModel = options.requestedModel ?? GEMINI_PRIMARY_MODEL_ID;
    this.capabilities = {
      maxContext: 32768,
      thinkingSupport: false,
      structuredOutputSupport: false,
      toolCallSupport: false,
      stopTokens: [],
      modelId: this.#requestedModel
    };
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  get lastGenerationMetadata(): ModelGenerationMetadata | undefined {
    return this.#lastGenerationMetadata;
  }

  async load(onProgress?: (progress: number, text: string) => void): Promise<void> {
    if (this.#loaded) return;
    onProgress?.(0.2, "Проверка на Alpha AI backend...");
    const healthResponse = await this.#fetch(joinUrl(this.#baseUrl, "/health"));
    if (!healthResponse.ok) throw new Error(`AI backend health failed: HTTP ${healthResponse.status}`);
    const health = await healthResponse.json() as {
      status?: string;
      free_only?: boolean;
      provider_available?: boolean;
    };
    if (health.free_only !== true) throw new Error("AI backend violates Alpha free-only policy.");
    if (!health.provider_available || health.status !== "ok") {
      throw new Error("Free AI provider is unavailable.");
    }

    onProgress?.(0.6, "Проверка на безплатните Gemini модели...");
    const modelsResponse = await this.#fetch(joinUrl(this.#baseUrl, "/v1/models"));
    if (!modelsResponse.ok) throw new Error(`AI model probe failed: HTTP ${modelsResponse.status}`);
    const models = await modelsResponse.json() as Array<{
      model_id?: string;
      free_allowed?: boolean;
      availability?: string;
    }>;
    const hasFreeAvailable = models.some((item) => item.free_allowed === true && item.availability === "AVAILABLE");
    if (!hasFreeAvailable) throw new Error("No allowed free Gemini model is available.");

    this.#loaded = true;
    onProgress?.(1, "Alpha AI backend е готов.");
  }

  async *generate(input: GenerationInput): AsyncIterable<string> {
    if (!this.#loaded) throw new Error("RemoteGeminiModelAdapter: backend не е зареден.");
    if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const requestId = makeRequestId();
    this.#lastGenerationMetadata = undefined;
    let cancelSent = false;
    let sawDone = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const streamController = new AbortController();
    const sendCancel = async (): Promise<void> => {
      if (cancelSent) return;
      cancelSent = true;
      const cancelController = new AbortController();
      const cancelTimer = setTimeout(() => cancelController.abort(), 1_500);
      try {
        await this.#fetch(joinUrl(this.#baseUrl, `/v1/cancel/${encodeURIComponent(requestId)}`), {
          method: "POST",
          signal: cancelController.signal
        });
      } catch {
        // Local abort wins; backend cancellation is best-effort and bounded.
      } finally {
        clearTimeout(cancelTimer);
      }
    };
    const abort = () => {
      streamController.abort(input.signal?.reason);
      void reader?.cancel().catch(() => undefined);
      void sendCancel();
    };
    input.signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.#fetch(joinUrl(this.#baseUrl, "/v1/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          system_prompt: input.systemPrompt,
          user_prompt: input.userPrompt,
          requested_model: this.#requestedModel,
          max_tokens: input.maxTokens,
          temperature: input.temperature
        }),
        signal: streamController.signal
      });
      if (!response.ok) throw new Error(`AI stream failed: HTTP ${response.status}`);
      if (!response.body) throw new Error("AI stream response has no body.");

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const readOrAbort = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        if (!input.signal) return reader!.read();
        return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Cancelled", "AbortError"));
          input.signal!.addEventListener("abort", onAbort, { once: true });
          reader!.read().then(resolve, reject).finally(() => {
            input.signal!.removeEventListener("abort", onAbort);
          });
        });
      };

      const consumeBlock = (block: string): string | undefined => {
        const envelope = parseSseBlock(block);
        if (!envelope) return undefined;
        if (envelope.event === "model_selected") {
          this.#lastGenerationMetadata = {
            requestedModel: String(envelope.data.requestedModel ?? this.#requestedModel),
            actualModel: String(envelope.data.actualModel ?? this.#requestedModel),
            fallbackUsed: envelope.data.fallbackUsed === true,
            fallbackReason: typeof envelope.data.fallbackReason === "string" ? envelope.data.fallbackReason : null
          };
        } else if (envelope.event === "metadata" && this.#lastGenerationMetadata) {
          const provider = envelope.data.provider;
          if (typeof provider === "string") this.#lastGenerationMetadata.provider = provider;
          const providerSources = envelope.data.providerSources;
          if (Array.isArray(providerSources)) {
            this.#lastGenerationMetadata.providerSources = providerSources
              .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
              .slice(0, 12);
          }
        } else if (envelope.event === "error") {
          const code = String(envelope.data.code ?? "AI_STREAM_ERROR");
          const message = String(envelope.data.message ?? "AI generation failed.");
          throw new Error(`${code}: ${message}`);
        } else if (envelope.event === "done") {
          sawDone = true;
        }
        return envelope.event === "token" && typeof envelope.data.text === "string" ? envelope.data.text : undefined;
      };
      while (!sawDone) {
        const result = await readOrAbort();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/u);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const token = consumeBlock(block);
          if (token) yield token;
          if (sawDone) break;
        }
      }

      buffer += decoder.decode();
      if (!sawDone && buffer.trim()) {
        const token = consumeBlock(buffer);
        if (token) yield token;
      }

      if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!sawDone) throw new Error("AI_STREAM_INCOMPLETE: backend stream ended without done event.");
      if (!this.#lastGenerationMetadata) {
        throw new Error("AI_STREAM_PROTOCOL_ERROR: model_selected event was not received.");
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      if (!sawDone) {
        streamController.abort();
        void reader?.cancel().catch(() => undefined);
      }
      if (input.signal?.aborted) void sendCancel();
    }
  }

  async unload(): Promise<void> {
    this.#loaded = false;
    this.#lastGenerationMetadata = undefined;
  }
}
