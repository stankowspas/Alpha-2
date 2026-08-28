import { describe, expect, it } from "vitest";
import { runFinalGate } from "../../packages/verification/src/index";

describe("VAP Final Gate", () => {
  it("publishes only when all factual claims are verified", () => {
    expect(runFinalGate([
      { claimId: "c1", text: "verified", status: "VERIFIED", evidence: [] }
    ]).publishable).toBe(true);

    expect(runFinalGate([
      { claimId: "c2", text: "not verified", status: "UNVERIFIED", evidence: [] }
    ])).toMatchObject({ publishable: false, blockedClaimIds: ["c2"] });
  });
});
