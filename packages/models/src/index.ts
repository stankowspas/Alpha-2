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
  responseJsonSchema?: Record<string, unknown>;
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

export class UnconfiguredModelAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 0,
    thinkingSupport: false,
    structuredOutputSupport: false,
    toolCallSupport: false,
    stopTokens: [],
    modelId: "not-configured"
  };

  readonly loaded = false;
  readonly lastGenerationMetadata = undefined;

  async load(): Promise<void> {
    throw new Error("MODEL_NOT_CONFIGURED: local browser model is not installed yet.");
  }

  async *generate(_input: GenerationInput): AsyncIterable<string> {
    throw new Error("MODEL_NOT_CONFIGURED: local browser model is not installed yet.");
  }

  async unload(): Promise<void> {}
}
