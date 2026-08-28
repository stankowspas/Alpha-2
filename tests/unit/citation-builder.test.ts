import { describe, expect, it } from "vitest";
import { buildCitationBundle } from "@alpha/citations";
import type { TaskPlan } from "@alpha/task-engine";

function verifiedPlan(): TaskPlan {
  return {
    taskId: "T-CIT",
    originalGoal: "Дай проверения факт.",
    status: "COMPLETE",
    createdAtUtc: "2026-08-24T15:00:00.000Z",
    steps: [
      {
        id: "S1",
        kind: "WEB_SEARCH",
        goal: "проверен факт",
        dependsOn: [],
        status: "COMPLETE",
        retryCount: 0,
        result: {
          query: "проверен факт",
          results: [{
            sourceId: "SRC-1",
            title: "Официален източник",
            url: "https://example.com/source",
            retrievedAtUtc: "2026-08-24T15:01:00.000Z",
            providerId: "fake-search"
          }]
        }
      },
      {
        id: "S2",
        kind: "RETRIEVAL",
        goal: "Извлечи източника",
        dependsOn: ["S1"],
        status: "COMPLETE",
        retryCount: 0,
        result: {
          query: "проверен факт",
          documents: [{
            evidenceId: "E-1",
            sourceId: "SRC-1",
            canonicalUrl: "https://example.com/source",
            title: "Официален източник",
            mimeType: "text/html",
            text: "Провереният факт е 42.",
            contentHash: "sha256:abc",
            retrievedAtUtc: "2026-08-24T15:02:00.000Z",
            location: "paragraph:1",
            untrusted: true
          }]
        }
      },
      {
        id: "S3",
        kind: "MODEL",
        goal: "Формулирай отговора",
        dependsOn: ["S2"],
        status: "COMPLETE",
        retryCount: 0,
        result: "Провереният факт е 42.",
        verificationMetadata: {
          claimVerification: {
            extractorId: "test-extractor",
            verifierId: "test-verifier",
            claims: [{
              claimId: "C1",
              text: "Провереният факт е 42.",
              status: "VERIFIED",
              evidence: [{ evidenceId: "E-1", sourceId: "SRC-1", contentHash: "sha256:abc" }]
            }]
          }
        }
      }
    ]
  };
}

describe("Citation Builder", () => {
  it("builds claim → evidence → source provenance", () => {
    const bundle = buildCitationBundle(verifiedPlan(), "2026-08-24T15:03:00.000Z");

    expect(bundle.citations).toHaveLength(1);
    expect(bundle.citations[0]).toMatchObject({
      claimId: "C1",
      evidenceId: "E-1",
      sourceId: "SRC-1",
      sourceTitle: "Официален източник",
      canonicalUrl: "https://example.com/source",
      contentHash: "sha256:abc",
      checkedAtUtc: "2026-08-24T15:03:00.000Z"
    });
  });

  it("fails closed on a tampered evidence hash", () => {
    const plan = verifiedPlan();
    const model = plan.steps.find((step) => step.kind === "MODEL")!;
    const report = model.verificationMetadata!.claimVerification as {
      claims: Array<{ evidence: Array<{ contentHash: string }> }>;
    };
    report.claims[0].evidence[0].contentHash = "sha256:tampered";

    expect(() => buildCitationBundle(plan, "2026-08-24T15:03:00.000Z"))
      .toThrow(/contentHash mismatch/u);
  });

  it("fails closed when the source provenance record is missing", () => {
    const plan = verifiedPlan();
    plan.steps = plan.steps.filter((step) => step.kind !== "WEB_SEARCH");

    expect(() => buildCitationBundle(plan, "2026-08-24T15:03:00.000Z"))
      .toThrow(/SearchResult provenance/u);
  });

  it("rejects a COMPLETE model step containing an unverified claim", () => {
    const plan = verifiedPlan();
    const model = plan.steps.find((step) => step.kind === "MODEL")!;
    const report = model.verificationMetadata!.claimVerification as {
      claims: Array<{ status: string }>;
    };
    report.claims[0].status = "UNVERIFIED";

    expect(() => buildCitationBundle(plan, "2026-08-24T15:03:00.000Z"))
      .toThrow(/UNVERIFIED/u);
  });
});
