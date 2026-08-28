import type { EvidenceDocument } from "@alpha/retrieval";
import { SourceTokenError, verifySourceFetchToken } from "@alpha/source-token";
import { ExtractionError } from "./extractor";
import { RemoteFetchError, SafeEvidenceFetcher } from "./fetcher";
import { FetchSecurityError } from "./security";

export interface FetchApiInput {
  sourceId: string;
  url: string;
  fetchToken: string;
  maxChars?: number;
}

export interface FetchApiSuccess {
  ok: true;
  document: EvidenceDocument;
}

export interface FetchApiError {
  ok: false;
  code: string;
  message: string;
}

export class FetchApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FetchApiRequestError";
  }
}

const ALLOWED_KEYS = new Set(["sourceId", "url", "fetchToken", "maxChars"]);

export function parseFetchApiInput(value: unknown): Required<FetchApiInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FetchApiRequestError(400, "INVALID_BODY", "Fetch body трябва да е JSON object.");
  }

  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new FetchApiRequestError(
      400,
      "UNEXPECTED_FIELDS",
      `Fetch endpoint не приема допълнителни полета: ${unknownKeys.join(", ")}.`
    );
  }

  if (typeof input.sourceId !== "string" || !/^SRC-[a-f0-9]{20}$/u.test(input.sourceId)) {
    throw new FetchApiRequestError(400, "INVALID_SOURCE_ID", "sourceId е невалиден.");
  }
  if (typeof input.url !== "string" || !input.url.trim() || input.url.length > 2_048) {
    throw new FetchApiRequestError(400, "INVALID_URL", "url е невалиден или прекалено дълъг.");
  }
  if (typeof input.fetchToken !== "string" || input.fetchToken.length < 32 || input.fetchToken.length > 2_048) {
    throw new FetchApiRequestError(403, "FETCH_CAPABILITY_REQUIRED", "Липсва валиден signed fetch capability token.");
  }

  let maxChars = 12_000;
  if (input.maxChars !== undefined) {
    if (typeof input.maxChars !== "number" || !Number.isInteger(input.maxChars)) {
      throw new FetchApiRequestError(400, "INVALID_MAX_CHARS", "maxChars трябва да е цяло число.");
    }
    if (input.maxChars < 1_000 || input.maxChars > 50_000) {
      throw new FetchApiRequestError(400, "INVALID_MAX_CHARS", "maxChars трябва да е между 1000 и 50000.");
    }
    maxChars = input.maxChars;
  }

  return {
    sourceId: input.sourceId,
    url: input.url.trim(),
    fetchToken: input.fetchToken,
    maxChars
  };
}

export class FetchApiService {
  readonly #secret: string;

  constructor(
    sourceTokenSecret: string,
    private readonly fetcher: SafeEvidenceFetcher = new SafeEvidenceFetcher()
  ) {
    const secret = sourceTokenSecret.trim();
    if (secret.length < 24) throw new Error("ALPHA_SOURCE_TOKEN_SECRET трябва да е поне 24 символа.");
    this.#secret = secret;
  }

  async handle(body: unknown, signal?: AbortSignal): Promise<FetchApiSuccess> {
    const input = parseFetchApiInput(body);

    try {
      verifySourceFetchToken(this.#secret, input.fetchToken, input.sourceId, input.url);
    } catch (error) {
      if (error instanceof SourceTokenError) {
        throw new FetchApiRequestError(403, "FETCH_CAPABILITY_DENIED", "Signed fetch capability token е невалиден или изтекъл.");
      }
      throw error;
    }

    const document = await this.fetcher.fetch({
      sourceId: input.sourceId,
      url: input.url,
      maxChars: input.maxChars
    }, signal);

    return { ok: true, document };
  }
}

export function mapFetchServiceError(error: unknown): { status: number; body: FetchApiError } {
  if (error instanceof FetchApiRequestError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  if (error instanceof FetchSecurityError) {
    return {
      status: 403,
      body: { ok: false, code: "FETCH_TARGET_DENIED", message: "Remote target е блокиран от SSRF policy." }
    };
  }
  if (error instanceof ExtractionError) {
    const status = error.code === "MIME_DENIED" || error.code === "CHARSET_DENIED" ? 415 : 422;
    return { status, body: { ok: false, code: error.code, message: error.message } };
  }
  if (error instanceof RemoteFetchError) {
    if (error.code === "BODY_TOO_LARGE") {
      return { status: 413, body: { ok: false, code: error.code, message: error.message } };
    }
    if (["FETCH_TIMEOUT", "OVERALL_TIMEOUT"].includes(error.code)) {
      return { status: 504, body: { ok: false, code: error.code, message: "Remote evidence fetch timeout." } };
    }
    if (error.code === "CANCELLED") {
      return { status: 499, body: { ok: false, code: error.code, message: "Fetch заявката е отменена." } };
    }
    return { status: 502, body: { ok: false, code: error.code, message: "Remote evidence source не върна използваем отговор." } };
  }

  return {
    status: 500,
    body: { ok: false, code: "FETCH_INTERNAL_ERROR", message: "Вътрешна грешка при evidence fetch." }
  };
}
