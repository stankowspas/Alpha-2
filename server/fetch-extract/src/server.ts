import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { FetchApiRequestError, FetchApiService, mapFetchServiceError, type FetchApiError } from "./api";
import { NodePinnedTransport, SafeEvidenceFetcher } from "./fetcher";

function loadLocalEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const path of candidates) {
    try {
      loadEnvFile(path);
      return;
    } catch {
      // Host environment remains authoritative.
    }
  }
}

loadLocalEnv();
setDefaultCACertificates([...getCACertificates("default"), ...getCACertificates("system")]);

const PORT = Number.parseInt(process.env.FETCH_PORT ?? "5175", 10);
const HOST = process.env.FETCH_HOST?.trim() || "127.0.0.1";
const ALLOWED_ORIGINS = new Set((process.env.ALPHA_ALLOWED_ORIGIN?.trim() || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean));
const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

interface RateEntry { startedAt: number; count: number; }
const rate = new Map<string, RateEntry>();

function clientKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function allowRequest(key: string, now = Date.now()): boolean {
  const existing = rate.get(key);
  if (!existing || now - existing.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rate.set(key, { startedAt: now, count: 1 });
    return true;
  }
  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX;
}

function setCommonHeaders(response: ServerResponse, origin?: string): void {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  setCommonHeaders(response, origin);
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new FetchApiRequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type трябва да е application/json.");
  }

  const declared = Number.parseInt(request.headers["content-length"] ?? "0", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new FetchApiRequestError(413, "BODY_TOO_LARGE", "Fetch body надвишава 8 KiB.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new FetchApiRequestError(413, "BODY_TOO_LARGE", "Fetch body надвишава 8 KiB.");
    chunks.push(buffer);
  }

  if (size === 0) throw new FetchApiRequestError(400, "EMPTY_BODY", "Fetch body е празно.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new FetchApiRequestError(400, "INVALID_JSON", "Fetch body не е валиден JSON.");
  }
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function createService(): FetchApiService | null {
  const secret = process.env.ALPHA_SOURCE_TOKEN_SECRET?.trim();
  if (!secret) return null;

  const transport = new NodePinnedTransport({
    maxBytes: intEnv("FETCH_MAX_BYTES", 2 * 1024 * 1024),
    timeoutMs: intEnv("FETCH_HOP_TIMEOUT_MS", 8_000)
  });
  const fetcher = new SafeEvidenceFetcher({
    transport,
    maxRedirects: intEnv("FETCH_MAX_REDIRECTS", 3),
    overallTimeoutMs: intEnv("FETCH_OVERALL_TIMEOUT_MS", 12_000)
  });
  return new FetchApiService(secret, fetcher);
}

const service = createService();

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    writeJson(response, 403, { ok: false, code: "ORIGIN_DENIED", message: "Origin не е разрешен." } satisfies FetchApiError);
    return;
  }

  if (request.method === "OPTIONS") {
    setCommonHeaders(response, origin);
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.url !== "/api/fetch-extract") {
    writeJson(response, 404, { ok: false, code: "NOT_FOUND", message: "Endpoint не е намерен." } satisfies FetchApiError, origin);
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    writeJson(response, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "Използвай POST /api/fetch-extract." } satisfies FetchApiError, origin);
    return;
  }
  if (!allowRequest(clientKey(request))) {
    writeJson(response, 429, { ok: false, code: "RATE_LIMITED", message: "Твърде много fetch заявки." } satisfies FetchApiError, origin);
    return;
  }
  if (!service) {
    writeJson(response, 503, {
      ok: false,
      code: "FETCH_UNAVAILABLE",
      message: "Evidence fetch не е конфигуриран. Липсва ALPHA_SOURCE_TOKEN_SECRET."
    } satisfies FetchApiError, origin);
    return;
  }

  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  try {
    const body = await readJsonBody(request);
    const result = await service.handle(body, controller.signal);
    writeJson(response, 200, result, origin);
  } catch (error) {
    const mapped = mapFetchServiceError(error);
    if (mapped.status >= 500 && mapped.status !== 504 && mapped.status !== 502) {
      console.error("Fetch backend error:", error instanceof Error ? error.message : error);
    }
    if (!response.headersSent) writeJson(response, mapped.status, mapped.body, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Alpha fetch backend: http://${HOST}:${PORT}/api/fetch-extract`);
  if (!service) console.warn("ALPHA_SOURCE_TOKEN_SECRET липсва: evidence fetch ще връща FETCH_UNAVAILABLE.");
});
