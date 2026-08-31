import { pipeline } from "@huggingface/transformers";
import type { GenerationInput, ModelAdapter, ModelCapabilities, ModelGenerationMetadata } from "./index";

const MODEL_ID = "HuggingFaceTB/SmolLM3-3B-ONNX";

type GeneratedMessage = { role?: unknown; content?: unknown };
type GenerationCandidate = { generated_text?: unknown };
type Generator = ((messages: Array<{ role: "system" | "user"; content: string }>, options: Record<string, unknown>) => Promise<unknown>) & {
  tokenizer?: unknown;
};

type ProgressEvent = {
  status?: unknown;
  file?: unknown;
  progress?: unknown;
  loaded?: unknown;
  total?: unknown;
};

type FileProgress = { loaded: number; total: number };

function extractGeneratedText(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) return "";
  const candidate = output[0] as GenerationCandidate;
  const generated = candidate?.generated_text;
  if (typeof generated === "string") return generated;
  if (Array.isArray(generated)) {
    for (let i = generated.length - 1; i >= 0; i -= 1) {
      const message = generated[i] as GeneratedMessage;
      if (message?.role === "assistant" && typeof message.content === "string") return message.content;
    }
  }
  return "";
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function aggregateProgress(files: Map<string, FileProgress>, fallback?: number): number {
  let loaded = 0;
  let total = 0;
  for (const item of files.values()) {
    loaded += Math.min(item.loaded, item.total);
    total += item.total;
  }
  if (total > 0) return Math.max(0, Math.min(0.995, loaded / total));
  if (fallback !== undefined) return Math.max(0, Math.min(0.995, fallback));
  return 0;
}

function humanFileName(file: string): string {
  const parts = file.split("/");
  return parts.at(-1) || file;
}

export class SmolLM3WebGpuAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 64_000,
    thinkingSupport: true,
    structuredOutputSupport: true,
    toolCallSupport: true,
    stopTokens: ["<|im_end|>", "<|endoftext|>"],
    modelId: MODEL_ID
  };

  loaded = false;
  lastGenerationMetadata?: ModelGenerationMetadata;
  #generator?: Generator;

  async load(onProgress?: (progress: number, text: string) => void): Promise<void> {
    if (this.loaded) {
      onProgress?.(1, "SmolLM3-3B е готов.");
      return;
    }
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      throw new Error("WEBGPU_NOT_AVAILABLE: SmolLM3 requires a WebGPU-capable browser.");
    }

    const files = new Map<string, FileProgress>();
    let lastProgress = 0;
    onProgress?.(0, "Подготовка на SmolLM3-3B…");

    const created = await pipeline("text-generation", MODEL_ID, {
      dtype: "q4f16",
      device: "webgpu",
      progress_callback: (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const event = raw as ProgressEvent;
        const file = typeof event.file === "string" ? event.file : undefined;
        const status = typeof event.status === "string" ? event.status : undefined;
        const loaded = safeNumber(event.loaded);
        const total = safeNumber(event.total);
        const rawProgress = safeNumber(event.progress);
        const normalizedFileProgress = rawProgress === undefined
          ? undefined
          : Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress));

        if (file && total && total > 0) {
          files.set(file, {
            loaded: loaded ?? (normalizedFileProgress ?? 0) * total,
            total
          });
        } else if (file && status === "done") {
          const existing = files.get(file);
          if (existing) files.set(file, { loaded: existing.total, total: existing.total });
        }

        const aggregate = aggregateProgress(files, normalizedFileProgress);
        lastProgress = Math.max(lastProgress, aggregate);

        let text = "Зареждане на модела…";
        if (file) text = `Теглене: ${humanFileName(file)}`;
        else if (status === "initiate") text = "Подготовка на файловете…";
        else if (status === "ready") text = "Инициализиране на WebGPU…";

        onProgress?.(lastProgress, text);
      }
    });

    onProgress?.(Math.max(lastProgress, 0.995), "Инициализиране на модела в WebGPU…");
    this.#generator = created as unknown as Generator;
    this.loaded = true;
    onProgress?.(1, "SmolLM3-3B е готов.");
  }

  async *generate(input: GenerationInput): AsyncIterable<string> {
    if (!this.#generator || !this.loaded) throw new Error("MODEL_NOT_LOADED: SmolLM3-3B is not loaded.");
    if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const reasoningDirective = input.thinking ? "/think" : "/no_think";
    const messages = [
      { role: "system" as const, content: `${input.systemPrompt.trim()}\n${reasoningDirective}` },
      { role: "user" as const, content: input.userPrompt }
    ];

    const output = await this.#generator(messages, {
      max_new_tokens: Math.max(1, Math.trunc(input.maxTokens)),
      temperature: input.temperature ?? 0.2,
      do_sample: (input.temperature ?? 0.2) > 0
    });

    if (input.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const text = extractGeneratedText(output).trim();
    if (!text) throw new Error("MODEL_EMPTY_OUTPUT: SmolLM3 returned no assistant content.");

    this.lastGenerationMetadata = {
      requestedModel: MODEL_ID,
      actualModel: MODEL_ID,
      fallbackUsed: false,
      fallbackReason: null,
      provider: "transformers.js-webgpu",
      providerSources: []
    };

    yield text;
  }

  async unload(): Promise<void> {
    this.#generator = undefined;
    this.loaded = false;
    this.lastGenerationMetadata = undefined;
  }
}
