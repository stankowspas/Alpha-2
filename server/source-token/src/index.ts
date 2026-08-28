import { createHmac, timingSafeEqual } from "node:crypto";

export interface SourceFetchTokenPayload {
  v: 1;
  sourceId: string;
  url: string;
  exp: number;
}

export interface SourceTokenOptions {
  ttlMs?: number;
  nowMs?: number;
}

export class SourceTokenError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SourceTokenError";
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSourceFetchToken(
  secret: string,
  sourceId: string,
  url: string,
  options: SourceTokenOptions = {}
): string {
  if (secret.length < 24) throw new SourceTokenError("SECRET_TOO_SHORT", "Source token secret трябва да е поне 24 символа.");
  const ttlMs = Math.max(30_000, Math.min(30 * 60_000, options.ttlMs ?? 10 * 60_000));
  const now = options.nowMs ?? Date.now();
  const payload: SourceFetchTokenPayload = {
    v: 1,
    sourceId,
    url: normalizeUrl(url),
    exp: now + ttlMs
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function verifySourceFetchToken(
  secret: string,
  token: string,
  expectedSourceId: string,
  expectedUrl: string,
  nowMs = Date.now()
): SourceFetchTokenPayload {
  if (secret.length < 24) throw new SourceTokenError("SECRET_TOO_SHORT", "Source token secret трябва да е поне 24 символа.");
  if (!token || token.length > 2_048) throw new SourceTokenError("TOKEN_INVALID", "Source fetch token е невалиден.");

  const parts = token.split(".");
  if (parts.length !== 2) throw new SourceTokenError("TOKEN_INVALID", "Source fetch token е невалиден.");
  const [body, signature] = parts;
  const expectedSignature = sign(secret, body);
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    throw new SourceTokenError("TOKEN_SIGNATURE_INVALID", "Source fetch token signature е невалиден.");
  }

  let payload: SourceFetchTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SourceFetchTokenPayload;
  } catch {
    throw new SourceTokenError("TOKEN_PAYLOAD_INVALID", "Source fetch token payload е невалиден.");
  }

  if (payload.v !== 1 || typeof payload.sourceId !== "string" || typeof payload.url !== "string" || typeof payload.exp !== "number") {
    throw new SourceTokenError("TOKEN_PAYLOAD_INVALID", "Source fetch token payload е невалиден.");
  }
  if (payload.exp < nowMs) throw new SourceTokenError("TOKEN_EXPIRED", "Source fetch token е изтекъл.");
  if (payload.exp > nowMs + 31 * 60_000) throw new SourceTokenError("TOKEN_EXP_INVALID", "Source fetch token expiry е извън допустимия прозорец.");
  if (payload.sourceId !== expectedSourceId) throw new SourceTokenError("TOKEN_SOURCE_MISMATCH", "Source token не съвпада със sourceId.");
  if (normalizeUrl(payload.url) !== normalizeUrl(expectedUrl)) throw new SourceTokenError("TOKEN_URL_MISMATCH", "Source token не съвпада с URL.");

  return payload;
}
