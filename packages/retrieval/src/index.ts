export interface SearchRequest {
  query: string;
  maxResults: number;
  freshnessHint?: "CURRENT" | "RECENT" | "HISTORICAL";
}

export interface SearchResult {
  sourceId: string;
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  updatedAt?: string;
  retrievedAtUtc: string;
  providerId: string;
  fetchToken?: string;
}

export interface SearchProviderAdapter {
  readonly id: string;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]>;
}

export interface EvidenceDocument {
  evidenceId: string;
  sourceId: string;
  canonicalUrl: string;
  title?: string;
  mimeType: string;
  text: string;
  contentHash: string;
  retrievedAtUtc: string;
  publishedAt?: string;
  updatedAt?: string;
  location?: string;
  untrusted: true;
}

export interface FetchExtractRequest {
  source: SearchResult;
  maxChars: number;
}

export interface ContentFetchExtractAdapter {
  readonly id: string;
  fetchExtract(request: FetchExtractRequest, signal?: AbortSignal): Promise<EvidenceDocument>;
}

export interface SearchExecutionOutput {
  query: string;
  results: SearchResult[];
}

export interface RetrievalExecutionOutput {
  query: string;
  documents: EvidenceDocument[];
}

function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function validateSearchResult(result: SearchResult): void {
  if (!result.sourceId.trim()) throw new Error("Search result липсва sourceId.");
  if (!result.title.trim()) throw new Error("Search result липсва title.");
  if (!isSafeHttpUrl(result.url)) throw new Error("Search result съдържа невалиден URL.");
  if (!result.providerId.trim()) throw new Error("Search result липсва providerId.");
  if (!isIsoDate(result.retrievedAtUtc)) throw new Error("Search result има невалиден retrievedAtUtc.");
  if (result.publishedAt && !isIsoDate(result.publishedAt)) throw new Error("Search result има невалиден publishedAt.");
  if (result.updatedAt && !isIsoDate(result.updatedAt)) throw new Error("Search result има невалиден updatedAt.");
  if (result.fetchToken !== undefined) {
    if (typeof result.fetchToken !== "string" || result.fetchToken.length < 32 || result.fetchToken.length > 2_048) {
      throw new Error("Search result има невалиден fetchToken.");
    }
  }
}

export function validateEvidenceDocument(document: EvidenceDocument): void {
  if (!document.evidenceId.trim()) throw new Error("Evidence document липсва evidenceId.");
  if (!document.sourceId.trim()) throw new Error("Evidence document липсва sourceId.");
  if (!isSafeHttpUrl(document.canonicalUrl)) throw new Error("Evidence document съдържа невалиден canonicalUrl.");
  if (!document.mimeType.trim()) throw new Error("Evidence document липсва mimeType.");
  if (!document.text.trim()) throw new Error("Evidence document няма извлечено текстово съдържание.");
  if (!document.contentHash.trim()) throw new Error("Evidence document липсва contentHash.");
  if (!isIsoDate(document.retrievedAtUtc)) throw new Error("Evidence document има невалиден retrievedAtUtc.");
  if (document.publishedAt && !isIsoDate(document.publishedAt)) throw new Error("Evidence document има невалиден publishedAt.");
  if (document.updatedAt && !isIsoDate(document.updatedAt)) throw new Error("Evidence document има невалиден updatedAt.");
  if (document.untrusted !== true) throw new Error("Web evidence трябва да е маркирано като untrusted.");
}

export function isSearchExecutionOutput(value: unknown): value is SearchExecutionOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SearchExecutionOutput>;
  if (typeof candidate.query !== "string" || !candidate.query.trim() || !Array.isArray(candidate.results)) return false;
  try {
    for (const result of candidate.results) validateSearchResult(result);
    return true;
  } catch {
    return false;
  }
}

export function isRetrievalExecutionOutput(value: unknown): value is RetrievalExecutionOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RetrievalExecutionOutput>;
  if (typeof candidate.query !== "string" || !candidate.query.trim() || !Array.isArray(candidate.documents)) return false;
  try {
    for (const document of candidate.documents) validateEvidenceDocument(document);
    return true;
  } catch {
    return false;
  }
}

export interface BackendSearchProviderOptions {
  endpoint: string;
  providerId?: string;
  fetchImpl?: typeof fetch;
}

interface BackendSearchSuccess {
  ok: true;
  providerId: string;
  query: string;
  freshnessHint?: SearchRequest["freshnessHint"];
  results: SearchResult[];
}

interface BackendApiError {
  ok: false;
  code: string;
  message: string;
}

function isBackendSearchSuccess(value: unknown): value is BackendSearchSuccess {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackendSearchSuccess>;
  if (candidate.ok !== true || typeof candidate.providerId !== "string" || !candidate.providerId.trim()) return false;
  if (typeof candidate.query !== "string" || !Array.isArray(candidate.results)) return false;
  try {
    for (const result of candidate.results) {
      validateSearchResult(result);
      if (result.providerId !== candidate.providerId) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isBackendApiError(value: unknown): value is BackendApiError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackendApiError>;
  return candidate.ok === false
    && typeof candidate.code === "string"
    && typeof candidate.message === "string";
}

export class BackendSearchProviderAdapter implements SearchProviderAdapter {
  readonly id: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: BackendSearchProviderOptions) {
    if (!isSafeHttpUrl(options.endpoint)) throw new Error("Search backend endpoint трябва да е валиден HTTP(S) URL.");
    const providerId = options.providerId?.trim() || "web-no-key";
    if (!providerId) throw new Error("Search backend providerId е празен.");
    this.id = providerId;
    this.#endpoint = options.endpoint;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: request.query,
        maxResults: request.maxResults,
        freshnessHint: request.freshnessHint
      }),
      signal
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`Search backend върна невалиден JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      if (isBackendApiError(body)) throw new Error(`${body.code}: ${body.message}`);
      throw new Error(`Search backend грешка HTTP ${response.status}.`);
    }

    if (!isBackendSearchSuccess(body)) {
      throw new Error("Search backend върна невалидна provenance структура.");
    }
    if (body.providerId !== this.id) {
      throw new Error(`Search backend providerId ${body.providerId} не съвпада с очаквания ${this.id}.`);
    }
    if (body.query.trim() !== request.query.trim()) {
      throw new Error("Search backend query provenance не съвпада със заявката.");
    }

    return body.results.slice(0, request.maxResults);
  }
}

export interface BackendContentFetchExtractOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

interface BackendFetchSuccess {
  ok: true;
  document: EvidenceDocument;
}

function isBackendFetchSuccess(value: unknown): value is BackendFetchSuccess {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackendFetchSuccess>;
  if (candidate.ok !== true || !candidate.document) return false;
  try {
    validateEvidenceDocument(candidate.document);
    return true;
  } catch {
    return false;
  }
}

export class BackendContentFetchExtractAdapter implements ContentFetchExtractAdapter {
  readonly id = "alpha-fetch-extract-v1";
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: BackendContentFetchExtractOptions) {
    if (!isSafeHttpUrl(options.endpoint)) throw new Error("Fetch backend endpoint трябва да е валиден HTTP(S) URL.");
    this.#endpoint = options.endpoint;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async fetchExtract(request: FetchExtractRequest, signal?: AbortSignal): Promise<EvidenceDocument> {
    const source = request.source;
    validateSearchResult(source);
    if (!source.fetchToken) {
      throw new Error("Search source няма signed fetch capability token.");
    }

    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: source.sourceId,
        url: source.url,
        fetchToken: source.fetchToken,
        maxChars: request.maxChars
      }),
      signal
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`Fetch backend върна невалиден JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      if (isBackendApiError(body)) throw new Error(`${body.code}: ${body.message}`);
      throw new Error(`Fetch backend грешка HTTP ${response.status}.`);
    }
    if (!isBackendFetchSuccess(body)) {
      throw new Error("Fetch backend върна невалидна evidence структура.");
    }
    if (body.document.sourceId !== source.sourceId) {
      throw new Error("Fetch backend sourceId provenance не съвпада със search source.");
    }

    return body.document;
  }
}
