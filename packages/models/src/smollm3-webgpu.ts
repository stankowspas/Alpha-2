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

function normalizePercent(value: unknown): number | undefined {
  const progress = safeNumber(value);
  if (progress === undefined) return undefined;
  return Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
}

function humanFileName(file: string): string {
  const parts = file.split("/");
  return parts.at(-1) || file;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
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

    // Transformers.js v4 emits progress_total with the actual aggregate
    // loaded/total bytes for all required pipeline files. Do not derive an
    // overall percentage from per-file events: files are discovered over time
    // and doing so can incorrectly report 100% while a later large file is
    // still downloading.
    let totalProgress = 0;
    onProgress?.(0, "Подготовка на SmolLM3-3B…");

    const created = await pipeline("text-generation", MODEL_ID, {
      dtype: "q4f16",
      device: "webgpu",
      progress_callback: (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const event = raw as ProgressEvent;
        const status = typeof event.status === "string" ? event.status : undefined;
        const file = typeof event.file === "string" ? event.file : undefined;

        if (status === "progress_total") {
          const progress = normalizePercent(event.progress);
          const loaded = safeNumber(event.loaded);
          const total = safeNumber(event.total);
          if (progress !== undefined) totalProgress = Math.max(totalProgress, Math.min(progress, 0.99));

          const detail = loaded !== undefined && total !== undefined && total > 0
            ? `Общо: ${formatMiB(loaded)} / ${formatMiB(total)}`
            : "Теглене на файловете на модела…";
          onProgress?.(totalProgress, detail);
          return;
        }

        if (status === "progress" && file) {
          const fileProgress = normalizePercent(event.progress);
          const loaded = safeNumber(event.loaded);
          const total = safeNumber(event.total);
          const percent = fileProgress === undefined ? "" : ` · ${Math.round(fileProgress * 100)}%`;
          const bytes = loaded !== undefined && total !== undefined && total > 0
            ? ` · ${formatMiB(loaded)} / ${formatMiB(total)}`
            : "";
          onProgress?.(totalProgress, `Текущ файл: ${humanFileName(file)}${percent}${bytes}`);
          return;
        }

        if (status === "download" && file) {
          onProgress?.(totalProgress, `Теглене: ${humanFileName(file)}`);
          return;
        }
        if (status === "initiate") {
          onProgress?.(totalProgress, "Подготовка на файловете…");
          return;
        }
        if (status === "ready") {
          onProgress?.(Math.max(totalProgress, 0.99), "Инициализиране на модела в WebGPU…");
        }
      }
    });

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
