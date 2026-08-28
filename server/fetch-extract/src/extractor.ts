const ALLOWED_MIME = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain"
]);

export interface ExtractedText {
  text: string;
  title?: string;
  truncated: boolean;
}

export class ExtractionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export function normalizeMimeType(value: string | undefined): string {
  return (value ?? "").split(";", 1)[0].trim().toLocaleLowerCase();
}

export function assertSupportedMime(value: string | undefined): string {
  const mime = normalizeMimeType(value);
  if (!ALLOWED_MIME.has(mime)) {
    throw new ExtractionError("MIME_DENIED", `Неподдържан evidence MIME type: ${mime || "missing"}.`);
  }
  return mime;
}

export function assertSupportedCharset(contentType: string | undefined): void {
  if (!contentType) return;
  const match = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType);
  if (!match) return;
  const charset = match[1].toLocaleLowerCase();
  if (!["utf-8", "utf8", "us-ascii", "ascii"].includes(charset)) {
    throw new ExtractionError("CHARSET_DENIED", `Неподдържан charset: ${charset}.`);
  }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (full, entity: string) => {
    const lower = entity.toLocaleLowerCase();
    if (lower.startsWith("#x")) {
      const value = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : full;
    }
    if (lower.startsWith("#")) {
      const value = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : full;
    }
    return named[lower] ?? full;
  });
}

function normalizeVisibleText(text: string): string {
  return decodeEntities(text)
    .replace(/\u0000/gu, "")
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function extractHtmlTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  if (!match) return undefined;
  const value = normalizeVisibleText(match[1].replace(/<[^>]+>/gu, " "));
  return value ? value.slice(0, 300) : undefined;
}

function htmlToText(html: string): string {
  return normalizeVisibleText(
    html
      .replace(/<!--([\s\S]*?)-->/gu, " ")
      .replace(/<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(/<(br|hr)\b[^>]*\/?>/giu, "\n")
      .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|h[1-6]|tr|table|blockquote)>/giu, "\n")
      .replace(/<[^>]+>/gu, " ")
  );
}

export function extractEvidenceText(
  bytes: Uint8Array,
  contentType: string | undefined,
  maxChars: number
): ExtractedText {
  const mime = assertSupportedMime(contentType);
  assertSupportedCharset(contentType);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  const title = mime === "text/html" || mime === "application/xhtml+xml"
    ? extractHtmlTitle(decoded)
    : undefined;
  const fullText = mime === "text/html" || mime === "application/xhtml+xml"
    ? htmlToText(decoded)
    : normalizeVisibleText(decoded);

  if (!fullText) {
    throw new ExtractionError("EMPTY_TEXT", "Evidence page няма използваем текст след extraction.");
  }

  const bounded = Math.max(1_000, Math.min(50_000, Math.trunc(maxChars)));
  return {
    text: fullText.slice(0, bounded),
    title,
    truncated: fullText.length > bounded
  };
}
