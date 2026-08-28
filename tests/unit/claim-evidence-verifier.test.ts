import { describe, expect, it } from "vitest";
import type { EvidenceDocument } from "@alpha/retrieval";
import {
  ClaimEvidenceVerifier,
  ConservativeSentenceClaimExtractor,
  ExactTextEntailmentAdapter,
  runFinalGate,
  type ClaimEntailmentAdapter
} from "@alpha/verification";

const evidence: EvidenceDocument = {
  evidenceId: "E1",
  sourceId: "SRC1",
  canonicalUrl: "https://example.com/report",
  mimeType: "text/html",
  text: "Компания X отчита приходи от 42 млн. лв. през 2025 г.",
  contentHash: "sha256:e1",
  retrievedAtUtc: "2026-08-24T15:45:00Z",
  untrusted: true
};

describe("ClaimEvidenceVerifier", () => {
  it("verifies an exactly supported claim and preserves evidence provenance", async () => {
    const verifier = new ClaimEvidenceVerifier(
      new ConservativeSentenceClaimExtractor(),
      new ExactTextEntailmentAdapter()
    );

    const report = await verifier.verify(
      "Компания X отчита приходи от 42 млн. лв. през 2025 г.",
      [evidence]
    );

    expect(report.claims).toHaveLength(1);
    expect(report.claims[0].status).toBe("VERIFIED");
    expect(report.claims[0].evidence).toEqual([
      { evidenceId: "E1", sourceId: "SRC1", contentHash: "sha256:e1" }
    ]);
    expect(runFinalGate(report.claims).publishable).toBe(true);
  });

  it("blocks a fabricated numeric literal before entailment can approve it", async () => {
    let calls = 0;
    const permissive: ClaimEntailmentAdapter = {
      id: "permissive-test",
      async evaluate() {
        calls += 1;
        return { label: "ENTAILED", evidenceIds: ["E1"] };
      }
    };
    const verifier = new ClaimEvidenceVerifier(
      new ConservativeSentenceClaimExtractor(),
      permissive
    );

    const report = await verifier.verify(
      "Компания X отчита приходи от 43 млн. лв. през 2025 г.",
      [evidence]
    );

    expect(report.claims[0].status).toBe("UNVERIFIED");
    expect(report.claims[0].evidence).toEqual([]);
    expect(calls).toBe(0);
    expect(runFinalGate(report.claims).publishable).toBe(false);
  });

  it("does not accept an entailment result that references unknown evidence IDs", async () => {
    const invalidRefAdapter: ClaimEntailmentAdapter = {
      id: "invalid-ref-test",
      async evaluate() {
        return { label: "ENTAILED", evidenceIds: ["NOT-IN-PACK"] };
      }
    };
    const verifier = new ClaimEvidenceVerifier(
      new ConservativeSentenceClaimExtractor(),
      invalidRefAdapter
    );

    const report = await verifier.verify(
      "Компания X отчита приходи от 42 млн. лв. през 2025 г.",
      [evidence]
    );

    expect(report.claims[0].status).toBe("UNVERIFIED");
  });

  it("blocks the final gate when only one of multiple claims lacks support", async () => {
    const verifier = new ClaimEvidenceVerifier(
      new ConservativeSentenceClaimExtractor(),
      new ExactTextEntailmentAdapter()
    );

    const report = await verifier.verify(
      "Компания X отчита приходи от 42 млн. лв. през 2025 г. Компания X има 900 служители.",
      [evidence]
    );

    expect(report.claims.map((claim) => claim.status)).toEqual(["VERIFIED", "UNVERIFIED"]);
    expect(runFinalGate(report.claims).publishable).toBe(false);
  });
});
