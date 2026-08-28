import type { SearchRequest, SearchResult } from "@alpha/retrieval";
import { createSourceFetchToken } from "@alpha/source-token";

export interface SearchClient {
  readonly id: string;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]>;
}

export interface SearchApiInput {
  query: string;
  maxResults?: number;
  freshnessHint?: "CURRENT" | "RECENT" | "HISTORICAL";
}

export interface SearchApiSuccess {
  ok: true;
  providerId: string;
  query: string;
  freshnessHint?: "CURRENT" | "RECENT" | "HISTORICAL";
  results: SearchResult[];
}

export interface SearchApiError {
  ok: false;
  code: string;
  message: string;
}

export type SearchApiResponse = SearchApiSuccess | SearchApiError;

export class SearchApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const ALLOWED_KEYS = new Set(["query", "maxResults", "freshnessHint"]);
const ALLOWED_FRESHNESS = new Set(["CURRENT", "RECENT", "HISTORICAL"]);

export function parseSearchApiInput(value: unknown): Required<Pick<SearchApiInput, "query" | "maxResults">> & Pick<SearchApiInput, "freshnessHint"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SearchApiRequestError(400, "INVALID_BODY", "Search body трябва да е JSON object.");
  }

  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new SearchApiRequestError(
      400,
      "UNEXPECTED_FIELDS",
      `Search endpoint не приема допълнителни полета: ${unknownKeys.join(", ")}.`
    );
  }

  if (typeof input.query !== "string") {
    throw new SearchApiRequestError(400, "INVALID_QUERY", "query трябва да е string.");
  }
  const query = input.query.trim().replace(/\s+/gu, " ");
  if (!query) throw new SearchApiRequestError(400, "INVALID_QUERY", "query е празна.");
  if (query.length > 400) throw new SearchApiRequestError(400, "QUERY_TOO_LONG", "query надвишава 400 символа.");
  const wordCount = query.split(/\s+/u).filter(Boolean).length;
  if (wordCount > 50) throw new SearchApiRequestError(400, "QUERY_TOO_MANY_WORDS", "query надвишава 50 думи.");

  let maxResults = 5;
  if (input.maxResults !== undefined) {
    if (typeof input.maxResults !== "number" || !Number.isInteger(input.maxResults)) {
      throw new SearchApiRequestError(400, "INVALID_MAX_RESULTS", "maxResults трябва да е цяло число.");
    }
    if (input.maxResults < 1 || input.maxResults > 10) {
      throw new SearchApiRequestError(400, "INVALID_MAX_RESULTS", "maxResults трябва да е между 1 и 10.");
    }
    maxResults = input.maxResults;
  }

  let freshnessHint: SearchApiInput["freshnessHint"];
  if (input.freshnessHint !== undefined) {
    if (typeof input.freshnessHint !== "string" || !ALLOWED_FRESHNESS.has(input.freshnessHint)) {
      throw new SearchApiRequestError(400, "INVALID_FRESHNESS", "freshnessHint е невалиден.");
    }
    freshnessHint = input.freshnessHint as SearchApiInput["freshnessHint"];
  }

  return { query, maxResults, freshnessHint };
}

export class SearchApiService {
  readonly #sourceTokenSecret?: string;

  constructor(
    private readonly client: SearchClient,
    sourceTokenSecret?: string
  ) {
    const secret = sourceTokenSecret?.trim();
    if (secret && secret.length < 24) {
      throw new Error("ALPHA_SOURCE_TOKEN_SECRET трябва да е поне 24 символа.");
    }
    this.#sourceTokenSecret = secret || undefined;
  }

  async handle(body: unknown, signal?: AbortSignal): Promise<SearchApiSuccess> {
    const input = parseSearchApiInput(body);
    const request: SearchRequest = {
      query: input.query,
      maxResults: input.maxResults,
      freshnessHint: input.freshnessHint
    };
    const rawResults = await this.client.search(request, signal);
    const results = this.#sourceTokenSecret
      ? rawResults.map((result) => ({
          ...result,
          fetchToken: createSourceFetchToken(this.#sourceTokenSecret!, result.sourceId, result.url)
        }))
      : rawResults;

    return {
      ok: true,
      providerId: this.client.id,
      query: input.query,
      freshnessHint: input.freshnessHint,
      results
    };
  }
}
