import { describe, expect, it } from "vitest";
import { FinalCompletionChecker, type GoalCoverageAdapter } from "@alpha/completion";
import { TaskFinalizer } from "@alpha/finalization";
import type { TaskPlan } from "@alpha/task-engine";

const covered: GoalCoverageAdapter = {
  id: "fake-covered",
  async evaluate() {
    return { status: "COVERED" };
  }
};

function factualPlan(): TaskPlan {
  return {
    taskId: "T-FINAL",
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
        goal: "Извлечи evidence",
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

describe("TaskFinalizer", () => {
  it("emits TASK_COMPLETE only after completion, VAP and citation integrity pass", async () => {
    const finalizer = new TaskFinalizer(new FinalCompletionChecker(covered));
    const report = await finalizer.finalize(
      factualPlan(),
      { requiresVap: true },
      "2026-08-24T15:03:00.000Z"
    );

    expect(report.status).toBe("TASK_COMPLETE");
    expect(report.publishable).toBe(true);
    expect(report.finalGate?.publishable).toBe(true);
    expect(report.citations?.citations).toHaveLength(1);
  });

  it("blocks a factual task when MODEL claim verification metadata is missing", async () => {
    const plan = factualPlan();
    const model = plan.steps.find((step) => step.kind === "MODEL")!;
    model.verificationMetadata = undefined;

    const finalizer = new TaskFinalizer(new FinalCompletionChecker(covered));
    const report = await finalizer.finalize(
      plan,
      { requiresVap: true },
      "2026-08-24T15:03:00.000Z"
    );

    expect(report.status).toBe("BLOCKED");
    expect(report.publishable).toBe(false);
    expect(report.reason).toMatch(/claimVerification/u);
  });

  it("stops before VAP when Original Goal is not covered", async () => {
    const notCovered: GoalCoverageAdapter = {
      id: "fake-not-covered",
      async evaluate() {
        return { status: "NOT_COVERED", reason: "Липсва част от задачата." };
      }
    };
    const finalizer = new TaskFinalizer(new FinalCompletionChecker(notCovered));
    const report = await finalizer.finalize(
      factualPlan(),
      { requiresVap: true },
      "2026-08-24T15:03:00.000Z"
    );

    expect(report.status).toBe("INCOMPLETE");
    expect(report.publishable).toBe(false);
    expect(report.finalGate).toBeUndefined();
  });

  it("allows a non-factual task to finish without VAP when completion passes", async () => {
    const plan: TaskPlan = {
      taskId: "T-CREATIVE",
      originalGoal: "Напиши кратко заглавие.",
      status: "COMPLETE",
      createdAtUtc: "2026-08-24T15:00:00.000Z",
      steps: [{
        id: "S1",
        kind: "MODEL",
        goal: "Напиши кратко заглавие.",
        dependsOn: [],
        status: "COMPLETE",
        retryCount: 0,
        result: "Ново начало"
      }]
    };

    const finalizer = new TaskFinalizer(new FinalCompletionChecker(covered));
    const report = await finalizer.finalize(
      plan,
      { requiresVap: false },
      "2026-08-24T15:03:00.000Z"
    );

    expect(report.status).toBe("TASK_COMPLETE");
    expect(report.publishable).toBe(true);
    expect(report.citations?.citations).toEqual([]);
  });
});
