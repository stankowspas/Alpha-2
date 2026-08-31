import { pipeline } from "@huggingface/transformers";
import type { GenerationInput, ModelAdapter, ModelCapabilities, ModelGenerationMetadata } from "./index";

const MODEL_ID = "HuggingFaceTB/SmolLM3-3B-ONNX";

type GeneratedMessage = { role?: unknown; content?: unknown };
type GenerationCandidate = { generated_text?: unknown };
type Generator = ((messages: Array<{ role: "system" | "user"; content: string }>, options: Record<string, unknown>) => Promise<unknown>) & {
  tokenizer?: unknown;
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
    if (this.loaded) return;
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      throw new Error("WEBGPU_NOT_AVAILABLE: SmolLM3 requires a WebGPU-capable browser.");
    }

    onProgress?.(0, "Зареждане на SmolLM3-3B…");
    const created = await pipeline("text-generation", MODEL_ID, {
      dtype: "q4f16",
      device: "webgpu",
      progress_callback: (event: unknown) => {
        if (!event || typeof event !== "object") return;
        const progress = (event as { progress?: unknown }).progress;
        const file = (event as { file?: unknown }).file;
        if (typeof progress === "number") {
          const normalized = Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
          onProgress?.(normalized, typeof file === "string" ? `Зареждане: ${file}` : "Зареждане на модела…");
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
