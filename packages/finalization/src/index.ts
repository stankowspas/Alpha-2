import { buildCitationBundle, type CitationBundle } from "@alpha/citations";
import { FinalCompletionChecker, type FinalCompletionReport } from "@alpha/completion";
import type { TaskPlan } from "@alpha/task-engine";
import { runFinalGate, type ClaimVerificationReport, type FinalGateResult, type VerifiedClaim } from "@alpha/verification";

export type TaskFinalizationStatus = "TASK_COMPLETE" | "INCOMPLETE" | "BLOCKED";

export interface TaskFinalizationPolicy {
  requiresVap: boolean;
}

export interface TaskFinalizationReport {
  status: TaskFinalizationStatus;
  publishable: boolean;
  completion: FinalCompletionReport;
  finalGate?: FinalGateResult;
  citations?: CitationBundle;
  reason?: string;
}

function isClaimVerificationReport(value: unknown): value is ClaimVerificationReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ClaimVerificationReport>;
  return typeof report.extractorId === "string"
    && typeof report.verifierId === "string"
    && Array.isArray(report.claims);
}

function collectModelClaims(plan: TaskPlan): { claims: VerifiedClaim[]; missingReportStepIds: string[] } {
  const claims: VerifiedClaim[] = [];
  const missingReportStepIds: string[] = [];

  for (const step of plan.steps) {
    if (step.kind !== "MODEL" || step.status !== "COMPLETE") continue;
    const report = step.verificationMetadata?.claimVerification;
    if (!isClaimVerificationReport(report)) {
      missingReportStepIds.push(step.id);
      continue;
    }
    claims.push(...report.claims);
  }

  return { claims, missingReportStepIds };
}

export class TaskFinalizer {
  constructor(private readonly completionChecker: FinalCompletionChecker) {}

  async finalize(
    plan: TaskPlan,
    policy: TaskFinalizationPolicy,
    checkedAtUtc: string,
    signal?: AbortSignal
  ): Promise<TaskFinalizationReport> {
    const completion = await this.completionChecker.check(plan, signal);

    if (!completion.complete) {
      return {
        status: completion.status === "INCOMPLETE" ? "INCOMPLETE" : "BLOCKED",
        publishable: false,
        completion,
        reason: completion.issues[0]?.message ?? "Final completion check не е преминал."
      };
    }

    if (signal?.aborted) {
      return {
        status: "BLOCKED",
        publishable: false,
        completion,
        reason: "Finalization е отменена."
      };
    }

    if (!policy.requiresVap) {
      let citations: CitationBundle;
      try {
        citations = buildCitationBundle(plan, checkedAtUtc);
      } catch (error) {
        return {
          status: "BLOCKED",
          publishable: false,
          completion,
          reason: error instanceof Error ? error.message : "Citation integrity check failed."
        };
      }

      return {
        status: "TASK_COMPLETE",
        publishable: true,
        completion,
        citations
      };
    }

    const { claims, missingReportStepIds } = collectModelClaims(plan);
    if (missingReportStepIds.length > 0) {
      return {
        status: "BLOCKED",
        publishable: false,
        completion,
        reason: `Липсва claimVerification report за MODEL step(s): ${missingReportStepIds.join(", ")}.`
      };
    }

    if (claims.length === 0) {
      return {
        status: "BLOCKED",
        publishable: false,
        completion,
        reason: "VAP е задължителен, но няма проверими MODEL claims."
      };
    }

    const finalGate = runFinalGate(claims);
    if (!finalGate.publishable) {
      return {
        status: "BLOCKED",
        publishable: false,
        completion,
        finalGate,
        reason: finalGate.reason ?? "VAP Final Gate не е преминал."
      };
    }

    let citations: CitationBundle;
    try {
      citations = buildCitationBundle(plan, checkedAtUtc);
    } catch (error) {
      return {
        status: "BLOCKED",
        publishable: false,
        completion,
        finalGate,
        reason: error instanceof Error ? error.message : "Citation integrity check failed."
      };
    }

    const citedClaims = new Set(citations.citations.map((citation) => `${citation.modelStepId}:${citation.claimId}`));
    const expectedClaims = new Set<string>();
    for (const step of plan.steps) {
      if (step.kind !== "MODEL" || step.status !== "COMPLETE") continue;
      const report = step.verificationMetadata?.claimVerification;
      if (!isClaimVerificationReport(report)) continue;
      for (const claim of report.claims) expectedClaims.add(`${step.id}:${claim.claimId}`);
    }

    for (const claimKey of expectedClaims) {
      if (!citedClaims.has(claimKey)) {
        return {
          status: "BLOCKED",
          publishable: false,
          completion,
          finalGate,
          citations,
          reason: `VERIFIED claim няма citation provenance: ${claimKey}.`
        };
      }
    }

    return {
      status: "TASK_COMPLETE",
      publishable: true,
      completion,
      finalGate,
      citations
    };
  }
}
