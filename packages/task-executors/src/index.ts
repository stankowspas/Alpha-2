import type { StepContextAssembler } from "@alpha/context";
import type { ModelAdapter } from "@alpha/models";
import {
  isSearchExecutionOutput,
  validateEvidenceDocument,
  validateSearchResult,
  type ContentFetchExtractAdapter,
  type RetrievalExecutionOutput,
  type SearchExecutionOutput,
  type SearchProviderAdapter
} from "@alpha/retrieval";
import type { StepExecutor, StepExecutionContext, StepExecutionResult } from "@alpha/task-execution";
import { calculateFromText } from "@alpha/tools";

export type { AssembledStepPrompt, StepContextAssembler } from "@alpha/context";

export class CalculatorStepExecutor implements StepExecutor {
  readonly kinds = ["CALCULATOR"] as const;

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const calculation = calculateFromText(context.currentStep.goal);
    return {
      output: calculation,
      metadata: {
        executor: "CALCULATOR",
        deterministic: true,
        expression: calculation.expression
      }
    };
  }
}

export class TimeStepExecutor implements StepExecutor {
  readonly kinds = ["TIME"] as const;

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("bg-BG", {
      dateStyle: "full",
      timeStyle: "medium"
    }).format(now);
    return {
      output: { iso: now.toISOString(), formatted },
      metadata: { executor: "TIME", deterministic: true, capturedAtUtc: now.toISOString() }
    };
  }
}

export interface ModelStepStreamObserver {
  onAnswerToken?: (context: StepExecutionContext, token: string) => void;
  onThinkingToken?: (context: StepExecutionContext, token: string) => void;
}

export class ModelStepExecutor implements StepExecutor {
  readonly kinds = ["MODEL"] as const;

  constructor(
    private readonly model: ModelAdapter,
    private readonly contextAssembler: StepContextAssembler,
    private readonly observer: ModelStepStreamObserver = {}
  ) {}

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    if (!this.model.loaded) throw new Error("ModelStepExecutor: моделът не е зареден.");
    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const prompt = await this.contextAssembler.assemble(context);
    let answer = "";

    for await (const token of this.model.generate({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      maxTokens: prompt.maxTokens,
      thinking: prompt.thinking,
      temperature: prompt.temperature,
      useGoogleSearch: true,
      signal: context.signal
    })) {
      answer += token;
      this.observer.onAnswerToken?.(context, token);
    }

    const runtime = this.model.lastGenerationMetadata;
    return {
      output: answer,
      metadata: {
        executor: "MODEL",
        modelId: runtime?.actualModel ?? this.model.capabilities.modelId,
        requestedModel: runtime?.requestedModel ?? this.model.capabilities.modelId,
        fallbackUsed: runtime?.fallbackUsed ?? false,
        fallbackReason: runtime?.fallbackReason ?? null,
        provider: runtime?.provider,
        providerSources: runtime?.providerSources ?? [],
        generationComplete: true,
        verificationRequired: true,
        thinkingPresent: false,
        contextAudit: prompt.audit
      }
    };
  }
}

export interface SearchStepExecutorOptions {
  maxResults?: number;
  freshnessHint?: "CURRENT" | "RECENT" | "HISTORICAL";
}

export class SearchStepExecutor implements StepExecutor {
  readonly kinds = ["WEB_SEARCH"] as const;
  readonly #maxResults: number;
  readonly #freshnessHint?: "CURRENT" | "RECENT" | "HISTORICAL";

  constructor(
    private readonly provider: SearchProviderAdapter,
    options: SearchStepExecutorOptions = {}
  ) {
    this.#maxResults = Math.max(1, Math.min(10, Math.trunc(options.maxResults ?? 5)));
    this.#freshnessHint = options.freshnessHint;
  }

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const query = context.currentStep.goal.trim();
    if (!query) throw new Error("WEB_SEARCH step няма query.");

    // Consume the budget before the actual provider call so an over-budget
    // request is never sent to the network.
    context.recordWebRequest?.();
    const providerResults = await this.provider.search({
      query,
      maxResults: this.#maxResults,
      freshnessHint: this.#freshnessHint
    }, context.signal);

    const results = providerResults.slice(0, this.#maxResults);
    for (const result of results) {
      validateSearchResult(result);
      if (result.providerId !== this.provider.id) {
        throw new Error("Search result providerId не съвпада с активния SearchProviderAdapter.");
      }
    }

    const output: SearchExecutionOutput = { query, results };
    return {
      output,
      metadata: {
        executor: "WEB_SEARCH",
        providerId: this.provider.id,
        resultCount: results.length
      }
    };
  }
}

export interface RetrievalStepExecutorOptions {
  maxDocuments?: number;
  maxCharsPerDocument?: number;
}

export class RetrievalStepExecutor implements StepExecutor {
  readonly kinds = ["RETRIEVAL"] as const;
  readonly #maxDocuments: number;
  readonly #maxCharsPerDocument: number;

  constructor(
    private readonly fetcher: ContentFetchExtractAdapter,
    options: RetrievalStepExecutorOptions = {}
  ) {
    this.#maxDocuments = Math.max(1, Math.min(10, Math.trunc(options.maxDocuments ?? 5)));
    this.#maxCharsPerDocument = Math.max(1_000, Math.min(50_000, Math.trunc(options.maxCharsPerDocument ?? 12_000)));
  }

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const dependencyIds = new Set(context.currentStep.dependsOn);
    const searchDependencies = context.completedSteps.filter((candidate) =>
      dependencyIds.has(candidate.id)
      && candidate.status === "COMPLETE"
      && candidate.kind === "WEB_SEARCH"
      && isSearchExecutionOutput(candidate.result)
    );

    if (searchDependencies.length === 0) {
      throw new Error("RETRIEVAL step изисква деклариран COMPLETE WEB_SEARCH dependency.");
    }
    if (searchDependencies.length > 1) {
      throw new Error("RETRIEVAL step има повече от един WEB_SEARCH dependency; source provenance е двусмислен.");
    }

    const searchOutput = searchDependencies[0].result as SearchExecutionOutput;
    if (searchOutput.results.length === 0) throw new Error("WEB_SEARCH dependency няма source candidates за retrieval.");

    const documents = [];
    const fetchErrors: string[] = [];
    for (const source of searchOutput.results.slice(0, this.#maxDocuments)) {
      if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      context.recordWebRequest?.();
      try {
        const document = await this.fetcher.fetchExtract({
          source,
          maxChars: this.#maxCharsPerDocument
        }, context.signal);
        validateEvidenceDocument(document);
        if (document.sourceId !== source.sourceId) {
          throw new Error("Evidence document sourceId не съвпада със search sourceId.");
        }
        documents.push(document);
      } catch (error) {
        if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        fetchErrors.push(`${source.url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (documents.length === 0) {
      throw new Error(`RETRIEVAL_ALL_SOURCES_FAILED: ${fetchErrors.join(" | ")}`);
    }

    const output: RetrievalExecutionOutput = { query: searchOutput.query, documents };
    return {
      output,
      metadata: {
        executor: "RETRIEVAL",
        fetcherId: this.fetcher.id,
        documentCount: documents.length,
        skippedSourceCount: fetchErrors.length
      }
    };
  }
}


export interface WeatherStepResult {
  providerId: "open-meteo";
  location: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  observedAtLocal: string;
  retrievedAtUtc: string;
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPercent: number;
  precipitationMm: number;
  weatherCode: number;
  windSpeedKmh: number;
  condition: string;
  sourceUrl: string;
  formatted: string;
}

export interface WeatherStepExecutorOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export class WeatherStepExecutor implements StepExecutor {
  readonly kinds = ["WEATHER"] as const;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  constructor(options: WeatherStepExecutorOptions) {
    const endpoint = options.endpoint.trim();
    if (!endpoint) throw new Error("WeatherStepExecutor изисква endpoint.");
    this.#endpoint = endpoint;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    context.recordWebRequest?.();
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: context.currentStep.goal }),
      signal: context.signal
    });
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error(`WEATHER_INVALID_RESPONSE: HTTP ${response.status}.`); }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `WEATHER_HTTP_${response.status}`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
      throw new Error("WEATHER_INVALID_RESPONSE: липсва ok=true.");
    }
    const result = (payload as { result?: unknown }).result;
    if (!result || typeof result !== "object") {
      throw new Error("WEATHER_INVALID_RESPONSE: липсва result.");
    }
    const candidate = result as Partial<WeatherStepResult>;
    if (candidate.providerId !== "open-meteo" || typeof candidate.formatted !== "string" || !candidate.formatted.trim()) {
      throw new Error("WEATHER_INVALID_RESPONSE: невалиден Open-Meteo result.");
    }
    return {
      output: result,
      metadata: {
        executor: "WEATHER",
        providerId: candidate.providerId,
        sourceUrl: candidate.sourceUrl,
        observedAtLocal: candidate.observedAtLocal,
        retrievedAtUtc: candidate.retrievedAtUtc
      }
    };
  }
}
