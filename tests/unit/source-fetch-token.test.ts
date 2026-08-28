import { describe, expect, it } from "vitest";
import { createSourceFetchToken, verifySourceFetchToken } from "../../server/source-token/src/index";

const SECRET = "alpha-test-secret-0123456789abcdef";
const SOURCE = "SRC-aaaaaaaaaaaaaaaaaaaa";
const URL = "https://example.com/article";

describe("source fetch capability token", () => {
  it("binds a token to sourceId, URL and expiry", () => {
    const token = createSourceFetchToken(SECRET, SOURCE, URL, { nowMs: 1_000_000, ttlMs: 60_000 });
    const payload = verifySourceFetchToken(SECRET, token, SOURCE, URL, 1_030_000);

    expect(payload.sourceId).toBe(SOURCE);
    expect(payload.url).toBe("https://example.com/article");
    expect(payload.exp).toBe(1_060_000);
  });

  it("rejects URL substitution and expired capabilities", () => {
    const token = createSourceFetchToken(SECRET, SOURCE, URL, { nowMs: 1_000_000, ttlMs: 60_000 });

    expect(() => verifySourceFetchToken(SECRET, token, SOURCE, "https://example.com/other", 1_010_000))
      .toThrow(/URL/u);
    expect(() => verifySourceFetchToken(SECRET, token, SOURCE, URL, 1_070_000))
      .toThrow(/изтекъл/u);
  });

  it("rejects tampered signatures", () => {
    const token = createSourceFetchToken(SECRET, SOURCE, URL);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(() => verifySourceFetchToken(SECRET, tampered, SOURCE, URL))
      .toThrow(/signature/u);
  });
});
