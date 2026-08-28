import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { NoKeyWebSearchClient } from "./no-key-web-client";
import { OpenMeteoWeatherService } from "./weather";
import { SearchApiRequestError, SearchApiService, type SearchApiError } from "./api";

function loadLocalEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env")
  ];
  for (const path of candidates) {
    try {
      loadEnvFile(path);
      return;
    } catch {
      // Environment variables supplied by the host remain authoritative.
    }
  }
}

loadLocalEnv();
setDefaultCACertificates([...getCACertificates("default"), ...getCACertificates("system")]);

const PORT = Number.parseInt(process.env.SEARCH_PORT ?? "5174", 10);
const HOST = process.env.SEARCH_HOST?.trim() || "127.0.0.1";
const ALLOWED_ORIGINS = new Set((process.env.ALPHA_ALLOWED_ORIGIN?.trim() || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean));
const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

interface RateEntry {
  startedAt: number;
  count: number;
}

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
    throw new SearchApiRequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type трябва да е application/json.");
  }

  const declared = Number.parseInt(request.headers["content-length"] ?? "0", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new SearchApiRequestError(413, "BODY_TOO_LARGE", "Search body надвишава 8 KiB.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
    throw new SearchApiRequestError(413, "BODY_TOO_LARGE", "Search body надвишава 8 KiB.");
    }
    chunks.push(buffer);
  }

  if (size === 0) throw new SearchApiRequestError(400, "EMPTY_BODY", "Search body е празно.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new SearchApiRequestError(400, "INVALID_JSON", "Search body не е валиден JSON.");
  }
}

function createService(): SearchApiService {
  return new SearchApiService(new NoKeyWebSearchClient({
    timeoutMs: Number.parseInt(process.env.SEARCH_TIMEOUT_MS ?? "8000", 10)
  }), process.env.ALPHA_SOURCE_TOKEN_SECRET);
}

const service = createService();
const weatherService = new OpenMeteoWeatherService(Number.parseInt(process.env.WEATHER_TIMEOUT_MS ?? "8000", 10));

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    writeJson(response, 403, { ok: false, code: "ORIGIN_DENIED", message: "Origin не е разрешен." } satisfies SearchApiError);
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

  if (request.url !== "/api/search" && request.url !== "/api/weather") {
    writeJson(response, 404, { ok: false, code: "NOT_FOUND", message: "Endpoint не е намерен." } satisfies SearchApiError, origin);
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    writeJson(response, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "Използвай POST /api/search." } satisfies SearchApiError, origin);
    return;
  }

  if (!allowRequest(clientKey(request))) {
    writeJson(response, 429, { ok: false, code: "RATE_LIMITED", message: "Твърде много search заявки." } satisfies SearchApiError, origin);
    return;
  }

  const controller = new AbortController();
  request.once("aborted", () => controller.abort());

  try {
    const body = await readJsonBody(request);
    const result = request.url === "/api/weather"
      ? await weatherService.handle(body, controller.signal)
      : await service.handle(body, controller.signal);
    writeJson(response, 200, result, origin);
  } catch (error) {
    if (error instanceof SearchApiRequestError) {
      writeJson(response, error.status, { ok: false, code: error.code, message: error.message } satisfies SearchApiError, origin);
      return;
    }

    if (controller.signal.aborted) {
      if (!response.headersSent) writeJson(response, 499, { ok: false, code: "CLIENT_ABORTED", message: "Search заявката е отменена." } satisfies SearchApiError, origin);
      return;
    }

    console.error("Web backend error:", error instanceof Error ? error.message : error);
    writeJson(response, 502, request.url === "/api/weather"
      ? { ok: false, code: "WEATHER_PROVIDER_ERROR", message: "Weather provider не върна използваем резултат." }
      : { ok: false, code: "SEARCH_PROVIDER_ERROR", message: "Live search provider не върна използваем резултат." }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Alpha search backend: http://${HOST}:${PORT}/api/search`);
  console.log(`Alpha weather backend: http://${HOST}:${PORT}/api/weather`);
  if (!process.env.ALPHA_SOURCE_TOKEN_SECRET?.trim()) {
    console.warn("ALPHA_SOURCE_TOKEN_SECRET липсва: search резултатите няма да могат да се използват за content retrieval.");
  }
});
