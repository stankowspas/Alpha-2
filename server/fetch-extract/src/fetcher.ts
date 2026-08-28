import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { EvidenceDocument } from "@alpha/retrieval";
import { extractEvidenceText, normalizeMimeType } from "./extractor";
import {
  FetchSecurityError,
  resolvePublicTarget,
  systemResolver,
  type ResolveHost,
  type ValidatedTarget
} from "./security";

export interface TransportResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Uint8Array;
}

export interface PinnedTransport {
  request(target: ValidatedTarget, signal?: AbortSignal): Promise<TransportResponse>;
}

export interface NodePinnedTransportOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

export class RemoteFetchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RemoteFetchError";
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export class NodePinnedTransport implements PinnedTransport {
  readonly #maxBytes: number;
  readonly #timeoutMs: number;

  constructor(options: NodePinnedTransportOptions = {}) {
    this.#maxBytes = Math.max(64 * 1024, Math.min(5 * 1024 * 1024, options.maxBytes ?? 2 * 1024 * 1024));
    this.#timeoutMs = Math.max(1_000, Math.min(20_000, options.timeoutMs ?? 8_000));
  }

  request(target: ValidatedTarget, signal?: AbortSignal): Promise<TransportResponse> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new RemoteFetchError("CANCELLED", "Fetch е отменен."));
        return;
      }

      const isHttps = target.url.protocol === "https:";
      const options: RequestOptions & { servername?: string; rejectUnauthorized?: boolean } = {
        protocol: target.url.protocol,
        hostname: target.address.address,
        family: target.address.family,
        port: isHttps ? 443 : 80,
        method: "GET",
        path: `${target.url.pathname}${target.url.search}`,
        headers: {
          Host: target.url.host,
          "User-Agent": "AlphaChat-EvidenceFetcher/1.0",
          Accept: "text/html, application/xhtml+xml, text/plain;q=0.9",
          "Accept-Encoding": "identity",
          Connection: "close"
        },
        agent: false
      };

      if (isHttps) {
        options.rejectUnauthorized = true;
        if (isIP(target.hostname) === 0) options.servername = target.hostname;
      }

      const request = (isHttps ? httpsRequest : httpRequest)(options, (response) => {
        const declaredLength = Number.parseInt(firstHeader(response.headers["content-length"]) ?? "0", 10);
        if (Number.isFinite(declaredLength) && declaredLength > this.#maxBytes) {
          response.destroy();
          reject(new RemoteFetchError("BODY_TOO_LARGE", "Remote document надвишава максималния размер."));
          return;
        }

        const encoding = (firstHeader(response.headers["content-encoding"]) ?? "identity").trim().toLocaleLowerCase();
        if (encoding && encoding !== "identity") {
          response.destroy();
          reject(new RemoteFetchError("ENCODING_DENIED", "Compressed/encoded remote body не е разрешен в Alpha fetcher."));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > this.#maxBytes) {
            response.destroy(new RemoteFetchError("BODY_TOO_LARGE", "Remote document надвишава максималния размер."));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks)
          });
        });
        response.on("error", reject);
      });

      const abort = () => request.destroy(new RemoteFetchError("CANCELLED", "Fetch е отменен."));
      signal?.addEventListener("abort", abort, { once: true });

      request.setTimeout(this.#timeoutMs, () => {
        request.destroy(new RemoteFetchError("FETCH_TIMEOUT", `Remote fetch timeout след ${this.#timeoutMs} ms.`));
      });
      request.once("error", (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      request.once("close", () => signal?.removeEventListener("abort", abort));
      request.end();
    });
  }
}

export interface SafeEvidenceFetcherOptions {
  resolver?: ResolveHost;
  transport?: PinnedTransport;
  maxRedirects?: number;
  overallTimeoutMs?: number;
}

export interface FetchEvidenceRequest {
  sourceId: string;
  url: string;
  maxChars: number;
}

function redirectLocation(headers: IncomingHttpHeaders): string | undefined {
  return firstHeader(headers.location)?.trim() || undefined;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class SafeEvidenceFetcher {
  readonly #resolver: ResolveHost;
  readonly #transport: PinnedTransport;
  readonly #maxRedirects: number;
  readonly #overallTimeoutMs: number;

  constructor(options: SafeEvidenceFetcherOptions = {}) {
    this.#resolver = options.resolver ?? systemResolver;
    this.#transport = options.transport ?? new NodePinnedTransport();
    this.#maxRedirects = Math.max(0, Math.min(5, options.maxRedirects ?? 3));
    this.#overallTimeoutMs = Math.max(2_000, Math.min(30_000, options.overallTimeoutMs ?? 12_000));
  }

  async fetch(request: FetchEvidenceRequest, signal?: AbortSignal): Promise<EvidenceDocument & {
    fetchedBytes: number;
    truncated: boolean;
    extractorId: string;
  }> {
    const sourceId = request.sourceId.trim();
    if (!/^SRC-[a-f0-9]{20}$/u.test(sourceId)) {
      throw new RemoteFetchError("SOURCE_ID_INVALID", "sourceId не отговаря на search provenance формата.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#overallTimeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      let current = new URL(request.url);
      let finalTarget: ValidatedTarget | undefined;
      let response: TransportResponse | undefined;

      for (let redirectCount = 0; redirectCount <= this.#maxRedirects; redirectCount += 1) {
        const target = await resolvePublicTarget(current, this.#resolver);
        finalTarget = target;
        response = await this.#transport.request(target, controller.signal);

        if (!isRedirect(response.statusCode)) break;
        if (redirectCount === this.#maxRedirects) {
          throw new RemoteFetchError("TOO_MANY_REDIRECTS", "Remote document надвиши redirect limit.");
        }

        const location = redirectLocation(response.headers);
        if (!location) throw new RemoteFetchError("REDIRECT_WITHOUT_LOCATION", "Redirect response липсва Location.");
        const next = new URL(location, target.url);

        // Re-resolve and re-validate every hop. HTTPS downgrade is not allowed.
        if (target.url.protocol === "https:" && next.protocol === "http:") {
          throw new FetchSecurityError("HTTPS_DOWNGRADE_DENIED", "HTTPS към HTTP redirect не е разрешен.");
        }
        current = next;
      }

      if (!response || !finalTarget) throw new RemoteFetchError("NO_RESPONSE", "Remote fetch не върна response.");
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new RemoteFetchError("REMOTE_HTTP_ERROR", `Remote document върна HTTP ${response.statusCode}.`);
      }

      const contentType = firstHeader(response.headers["content-type"]);
      const extracted = extractEvidenceText(response.body, contentType, request.maxChars);
      const contentHash = hashText(extracted.text);
      const canonicalUrl = finalTarget.url.toString();

      return {
        evidenceId: `EVD-${createHash("sha256").update(`${sourceId}\n${canonicalUrl}\n${contentHash}`).digest("hex").slice(0, 20)}`,
        sourceId,
        canonicalUrl,
        title: extracted.title,
        mimeType: normalizeMimeType(contentType),
        text: extracted.text,
        contentHash,
        retrievedAtUtc: new Date().toISOString(),
        untrusted: true,
        fetchedBytes: response.body.byteLength,
        truncated: extracted.truncated,
        extractorId: "alpha-basic-text-v1"
      };
    } catch (error) {
      if (controller.signal.aborted) {
        if (signal?.aborted) throw new RemoteFetchError("CANCELLED", "Fetch е отменен.");
        throw new RemoteFetchError("OVERALL_TIMEOUT", `Evidence fetch timeout след ${this.#overallTimeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
