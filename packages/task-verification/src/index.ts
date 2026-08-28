import {
  isRetrievalExecutionOutput,
  isSearchExecutionOutput,
  type EvidenceDocument
} from "@alpha/retrieval";
import type { StepVerification } from "@alpha/task-engine";
import type { StepExecutionContext, StepExecutionResult, StepVerifier } from "@alpha/task-execution";
import { calculateFromText, type CalculatorResult } from "@alpha/tools";
import {
  ClaimEvidenceVerifier,
  runFinalGate
} from "@alpha/verification";

function isCalculatorResult(value: unknown): value is CalculatorResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalculatorResult>;
  return typeof candidate.expression === "string"
    && typeof candidate.value === "number"
    && Number.isFinite(candidate.value)
    && typeof candidate.formatted === "string";
}

function isFormattedObject(value: unknown): value is { formatted: string } {
  return !!value && typeof value === "object"
    && typeof (value as { formatted?: unknown }).formatted === "string"
    && (value as { formatted: string }).formatted.trim().length > 0;
}

function nearlyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-12;
}

function includedEvidenceIds(result: StepExecutionResult): Set<string> {
  const audit = result.metadata?.contextAudit;
  if (!audit || typeof audit !== "object") return new Set();
  const included = (audit as { includedBlockIds?: unknown }).includedBlockIds;
  if (!Array.isArray(included)) return new Set();

  return new Set(included
    .filter((value): value is string => typeof value === "string" && value.startsWith("evidence:"))
    .map((value) => value.slice("evidence:".length))
    .filter(Boolean));
}

export interface ModelStepVerificationAdapter {
  verify(context: StepExecutionContext, result: StepExecutionResult): Promise<StepVerification>;
}

export class ClaimEvidenceModelStepVerifier implements ModelStepVerificationAdapter {
  constructor(private readonly verifier: ClaimEvidenceVerifier) {}

  async verify(context: StepExecutionContext, result: StepExecutionResult): Promise<StepVerification> {
    if (typeof result.output !== "string" || !result.output.trim()) {
      return { status: "FAILED", reason: "MODEL executor не върна текст за verification." };
    }

    const allowedEvidenceIds = includedEvidenceIds(result);
    if (allowedEvidenceIds.size === 0) {
      return {
        status: "UNVERIFIED",
        reason: "MODEL context няма включено retrieved evidence за claim verification."
      };
    }

    const evidence: EvidenceDocument[] = [];
    const requiredIds = new Set(context.currentStep.dependsOn);
    for (const step of context.completedSteps) {
      if (!requiredIds.has(step.id)) continue;
      if (step.kind !== "RETRIEVAL" || step.status !== "COMPLETE" || !isRetrievalExecutionOutput(step.result)) continue;
      for (const document of step.result.documents) {
        if (allowedEvidenceIds.has(document.evidenceId)) evidence.push(document);
      }
    }

    if (evidence.length === 0) {
      return {
        status: "UNVERIFIED",
        reason: "MODEL output няма required evidence, което едновременно е част от текущия Evidence Pack."
      };
    }

    const report = await this.verifier.verify(result.output, evidence, context.signal);
    const metadata: Record<string, unknown> = {
      claimVerification: report,
      evidencePackIds: [...allowedEvidenceIds]
    };

    if (report.claims.length === 0) {
      return {
        status: "UNVERIFIED",
        reason: "Claim extractor не откри проверими твърдения в MODEL output.",
        metadata
      };
    }

    const gate = runFinalGate(report.claims);
    if (gate.publishable) {
      return { status: "COMPLETE", metadata };
    }

    if (report.claims.some((claim) => claim.status === "CONTRADICTED")) {
      return {
        status: "FAILED",
        reason: "MODEL output съдържа claim, който е contradicted от evidence.",
        metadata
      };
    }

    if (report.claims.some((claim) => claim.status === "CONFLICTING")) {
      return {
        status: "BLOCKED",
        reason: "Evidence за MODEL output е conflicting.",
        metadata
      };
    }

    return {
      status: "UNVERIFIED",
      reason: gate.reason ?? "MODEL output съдържа unsupported claims.",
      metadata
    };
  }
}

export class FailClosedStepVerifier implements StepVerifier {
  constructor(
    private readonly modelVerifier?: ModelStepVerificationAdapter,
    private readonly allowStructuralModelVerification = false
  ) {}

  async verify(context: StepExecutionContext, result: StepExecutionResult): Promise<StepVerification> {
    if (context.signal?.aborted) {
      return { status: "BLOCKED", reason: "Verification cancelled." };
    }

    switch (context.currentStep.kind) {
      case "CALCULATOR": {
        if (!isCalculatorResult(result.output)) {
          return { status: "FAILED", reason: "Calculator executor върна невалидна структура." };
        }

        let expected: CalculatorResult;
        try {
          expected = calculateFromText(context.currentStep.goal);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Calculator verification failed.";
          return { status: "FAILED", reason: message };
        }

        if (expected.expression !== result.output.expression || !nearlyEqual(expected.value, result.output.value)) {
          return {
            status: "FAILED",
            reason: "Calculator result не съвпада с независимо преизчисления резултат."
          };
        }

        return { status: "COMPLETE" };
      }

      case "WEATHER": {
        if (!isFormattedObject(result.output)) {
          return { status: "FAILED", reason: "WEATHER executor върна невалиден резултат." };
        }
        const candidate = result.output as { providerId?: unknown; retrievedAtUtc?: unknown };
        if (candidate.providerId !== "open-meteo") {
          return { status: "FAILED", reason: "WEATHER result не е от Open-Meteo." };
        }
        if (typeof candidate.retrievedAtUtc !== "string" || !Number.isFinite(Date.parse(candidate.retrievedAtUtc))) {
          return { status: "FAILED", reason: "WEATHER result няма валиден retrievedAtUtc." };
        }
        return { status: "COMPLETE" };
      }

      case "TIME": {
        if (!isFormattedObject(result.output)) {
          return { status: "FAILED", reason: "TIME executor върна невалиден резултат." };
        }
        const iso = (result.output as { iso?: unknown }).iso;
        if (typeof iso !== "string" || !Number.isFinite(Date.parse(iso))) {
          return { status: "FAILED", reason: "TIME executor върна невалиден timestamp." };
        }
        return { status: "COMPLETE" };
      }

      case "WEB_SEARCH": {
        if (!isSearchExecutionOutput(result.output)) {
          return { status: "FAILED", reason: "WEB_SEARCH върна невалидна provenance структура." };
        }
        if (result.output.results.length === 0) {
          return { status: "BLOCKED", reason: "WEB_SEARCH не върна source candidates." };
        }
        return { status: "COMPLETE" };
      }

      case "RETRIEVAL": {
        if (!isRetrievalExecutionOutput(result.output)) {
          return { status: "FAILED", reason: "RETRIEVAL върна невалидна evidence структура." };
        }
        if (result.output.documents.length === 0) {
          return { status: "BLOCKED", reason: "RETRIEVAL не извлече evidence documents." };
        }
        return { status: "COMPLETE" };
      }

      case "MODEL": {
        if (this.modelVerifier) return this.modelVerifier.verify(context, result);
        if (this.allowStructuralModelVerification) {
          if (typeof result.output !== "string" || !result.output.trim()) {
            return { status: "FAILED", reason: "MODEL executor не върна текстов резултат." };
          }
          return {
            status: "COMPLETE",
            metadata: { modelVerification: "STRUCTURAL_MODEL_OUTPUT" }
          };
        }
        return {
          status: "UNVERIFIED",
          reason: "MODEL output не се приема за проверен без независим claim/evidence verifier."
        };
      }

      case "MEMORY":
      case "TOOL":
      default:
        return {
          status: "UNVERIFIED",
          reason: `Няма concrete verifier за ${context.currentStep.kind}.`
        };
    }
  }
}
