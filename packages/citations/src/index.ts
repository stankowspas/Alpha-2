import {
  isRetrievalExecutionOutput,
  isSearchExecutionOutput,
  type EvidenceDocument,
  type SearchResult
} from "@alpha/retrieval";
import type { TaskPlan } from "@alpha/task-engine";
import type { ClaimVerificationReport, VerifiedClaim } from "@alpha/verification";

export interface CitationRecord {
  citationId: string;
  taskId: string;
  modelStepId: string;
  claimId: string;
  claimText: string;
  evidenceId: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  canonicalUrl: string;
  providerId: string;
  contentHash: string;
  location?: string;
  publishedAt?: string;
  updatedAt?: string;
  retrievedAtUtc: string;
  checkedAtUtc: string;
}

export interface CitationBundle {
  taskId: string;
  checkedAtUtc: string;
  citations: CitationRecord[];
}

function assertIsoTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} трябва да е валиден ISO timestamp.`);
}

function isVerifiedClaim(value: unknown): value is VerifiedClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<VerifiedClaim>;
  return typeof claim.claimId === "string"
    && typeof claim.text === "string"
    && ["VERIFIED", "UNVERIFIED", "CONFLICTING", "CONTRADICTED"].includes(String(claim.status))
    && Array.isArray(claim.evidence);
}

function isClaimVerificationReport(value: unknown): value is ClaimVerificationReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ClaimVerificationReport>;
  return typeof report.extractorId === "string"
    && typeof report.verifierId === "string"
    && Array.isArray(report.claims)
    && report.claims.every(isVerifiedClaim);
}

function collectSources(plan: TaskPlan): Map<string, SearchResult> {
  const sources = new Map<string, SearchResult>();

  for (const step of plan.steps) {
    if (step.kind !== "WEB_SEARCH" || step.status !== "COMPLETE" || !isSearchExecutionOutput(step.result)) continue;

    for (const source of step.result.results) {
      const existing = sources.get(source.sourceId);
      if (existing && (existing.url !== source.url || existing.providerId !== source.providerId)) {
        throw new Error(`Conflicting SearchResult provenance за sourceId ${source.sourceId}.`);
      }
      sources.set(source.sourceId, source);
    }
  }

  return sources;
}

function collectEvidence(plan: TaskPlan): Map<string, EvidenceDocument> {
  const evidence = new Map<string, EvidenceDocument>();

  for (const step of plan.steps) {
    if (step.kind !== "RETRIEVAL" || step.status !== "COMPLETE" || !isRetrievalExecutionOutput(step.result)) continue;

    for (const document of step.result.documents) {
      const existing = evidence.get(document.evidenceId);
      if (existing && (existing.sourceId !== document.sourceId || existing.contentHash !== document.contentHash)) {
        throw new Error(`Conflicting EvidenceDocument provenance за evidenceId ${document.evidenceId}.`);
      }
      evidence.set(document.evidenceId, document);
    }
  }

  return evidence;
}

export function buildCitationBundle(plan: TaskPlan, checkedAtUtc: string): CitationBundle {
  assertIsoTimestamp(checkedAtUtc, "checkedAtUtc");
  const sources = collectSources(plan);
  const evidenceById = collectEvidence(plan);
  const citations: CitationRecord[] = [];
  const seen = new Set<string>();

  for (const step of plan.steps) {
    if (step.kind !== "MODEL" || step.status !== "COMPLETE") continue;

    const report = step.verificationMetadata?.claimVerification;
    if (report === undefined) continue;
    if (!isClaimVerificationReport(report)) {
      throw new Error(`MODEL step ${step.id} има невалиден claimVerification report.`);
    }

    for (const claim of report.claims) {
      if (claim.status !== "VERIFIED") {
        throw new Error(`COMPLETE MODEL step ${step.id} съдържа claim ${claim.claimId} със status ${claim.status}.`);
      }
      if (claim.evidence.length === 0) {
        throw new Error(`VERIFIED claim ${claim.claimId} няма evidence refs.`);
      }

      for (const ref of claim.evidence) {
        const document = evidenceById.get(ref.evidenceId);
        if (!document) throw new Error(`Липсва EvidenceDocument за ${ref.evidenceId}.`);
        if (document.sourceId !== ref.sourceId) {
          throw new Error(`sourceId mismatch за evidence ${ref.evidenceId}.`);
        }
        if (document.contentHash !== ref.contentHash) {
          throw new Error(`contentHash mismatch за evidence ${ref.evidenceId}.`);
        }

        const source = sources.get(ref.sourceId);
        if (!source) throw new Error(`Липсва SearchResult provenance за sourceId ${ref.sourceId}.`);

        const key = `${step.id}:${claim.claimId}:${ref.evidenceId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        citations.push({
          citationId: `CIT-${citations.length + 1}`,
          taskId: plan.taskId,
          modelStepId: step.id,
          claimId: claim.claimId,
          claimText: claim.text,
          evidenceId: document.evidenceId,
          sourceId: source.sourceId,
          sourceTitle: document.title ?? source.title,
          sourceUrl: source.url,
          canonicalUrl: document.canonicalUrl,
          providerId: source.providerId,
          contentHash: document.contentHash,
          location: document.location,
          publishedAt: document.publishedAt ?? source.publishedAt,
          updatedAt: document.updatedAt ?? source.updatedAt,
          retrievedAtUtc: document.retrievedAtUtc,
          checkedAtUtc
        });
      }
    }
  }

  return { taskId: plan.taskId, checkedAtUtc, citations };
}
