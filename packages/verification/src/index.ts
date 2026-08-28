import { validateEvidenceDocument, type EvidenceDocument } from "@alpha/retrieval";

export type ClaimStatus = "VERIFIED" | "UNVERIFIED" | "CONFLICTING" | "CONTRADICTED";

export interface EvidenceRef {
  evidenceId: string;
  sourceId: string;
  contentHash: string;
}

export interface VerifiedClaim {
  claimId: string;
  text: string;
  status: ClaimStatus;
  evidence: EvidenceRef[];
}

export interface FinalGateResult {
  publishable: boolean;
  blockedClaimIds: string[];
  reason?: string;
}

export function runFinalGate(claims: VerifiedClaim[]): FinalGateResult {
  const blocked = claims.filter((claim) => claim.status !== "VERIFIED").map((claim) => claim.claimId);

  if (blocked.length > 0) {
    return {
      publishable: false,
      blockedClaimIds: blocked,
      reason: "Има непотвърдени, противоречиви или опровергани фактологични твърдения."
    };
  }

  return { publishable: true, blockedClaimIds: [] };
}

export interface ExtractedClaim {
  claimId: string;
  text: string;
}

export interface ClaimExtractorAdapter {
  readonly id: string;
  extract(text: string, signal?: AbortSignal): Promise<ExtractedClaim[]>;
}

export type EntailmentLabel = "ENTAILED" | "CONTRADICTED" | "CONFLICTING" | "UNKNOWN";

export interface EntailmentEvaluation {
  label: EntailmentLabel;
  evidenceIds: string[];
  score?: number;
  reason?: string;
}

export interface ClaimEntailmentAdapter {
  readonly id: string;
  evaluate(
    claim: ExtractedClaim,
    evidence: EvidenceDocument[],
    signal?: AbortSignal
  ): Promise<EntailmentEvaluation>;
}

export interface ClaimVerificationReport {
  extractorId: string;
  verifierId: string;
  claims: VerifiedClaim[];
}

export function normalizeComparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/(?<=\d),(?=\d)/gu, ".")
    .replace(/[^\p{L}\p{N}%+\-./]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function extractCriticalLiterals(text: string): string[] {
  const matches = text.match(/[-+]?\d+(?:[.,]\d+)?%?/gu) ?? [];
  return [...new Set(matches.map((value) => normalizeComparableText(value)).filter(Boolean))];
}

export class ConservativeSentenceClaimExtractor implements ClaimExtractorAdapter {
  readonly id = "conservative-sentence-v1";

  async extract(text: string, signal?: AbortSignal): Promise<ExtractedClaim[]> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const normalized = text.replace(/\r\n?/gu, "\n").trim();
    if (!normalized) return [];

    // A plain `(?<=[.!?])\\s+` splits Bulgarian abbreviations such as
    // "млн. лв." into fake claims. A period is therefore treated as a
    // sentence boundary only when the next token starts with an uppercase
    // letter or a digit. Newlines and !/? remain explicit boundaries.
    const rawSentences = normalized
      .split(/(?<=[!?])\s+|(?<=\.)\s+(?=[\p{Lu}\d])|\n+/gu)
      .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/u, "").trim())
      .filter((part) => part.length >= 3 && !part.endsWith("?"));

    return rawSentences.map((sentence, index) => ({
      claimId: `C${index + 1}`,
      text: sentence
    }));
  }
}

export class ExactTextEntailmentAdapter implements ClaimEntailmentAdapter {
  readonly id = "exact-text-v1";

  async evaluate(
    claim: ExtractedClaim,
    evidence: EvidenceDocument[],
    signal?: AbortSignal
  ): Promise<EntailmentEvaluation> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const normalizedClaim = normalizeComparableText(claim.text);
    if (!normalizedClaim) return { label: "UNKNOWN", evidenceIds: [], reason: "Empty normalized claim." };

    const matches: string[] = [];
    for (const document of evidence) {
      const normalizedEvidence = normalizeComparableText(document.text);
      if (normalizedEvidence.includes(normalizedClaim)) matches.push(document.evidenceId);
    }

    if (matches.length > 0) {
      return { label: "ENTAILED", evidenceIds: matches, score: 1 };
    }

    return { label: "UNKNOWN", evidenceIds: [], reason: "No exact evidence support." };
  }
}

const COMMON_WORDS = new Set([
  "това", "тази", "този", "която", "който", "както", "има", "няма", "със", "във", "the", "that", "this", "with", "from", "have", "has", "are", "was", "were"
]);

export class EvidenceLiteralEntailmentAdapter implements ClaimEntailmentAdapter {
  readonly id = "evidence-literal-v1";

  async evaluate(claim: ExtractedClaim, evidence: EvidenceDocument[], signal?: AbortSignal): Promise<EntailmentEvaluation> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const normalizedClaim = normalizeComparableText(claim.text);
    if (!normalizedClaim) return { label: "UNKNOWN", evidenceIds: [] };
    const literals = extractCriticalLiterals(claim.text);
    const tokens = [...new Set(normalizedClaim.split(" ").filter((token) => token.length >= 4 && !COMMON_WORDS.has(token)))];

    for (const document of evidence) {
      const normalizedEvidence = normalizeComparableText(document.text);
      if (normalizedEvidence.includes(normalizedClaim)) {
        return { label: "ENTAILED", evidenceIds: [document.evidenceId], score: 1 };
      }
      if (literals.length > 0 && literals.every((literal) => normalizedEvidence.includes(literal))) {
        return { label: "ENTAILED", evidenceIds: [document.evidenceId], score: 0.9 };
      }
      if (tokens.length >= 3) {
        const matched = tokens.filter((token) => normalizedEvidence.includes(token)).length;
        if (matched / tokens.length >= 0.75) {
          return { label: "ENTAILED", evidenceIds: [document.evidenceId], score: matched / tokens.length };
        }
      }
    }
    return { label: "UNKNOWN", evidenceIds: [], reason: "Evidence does not sufficiently cover the claim." };
  }
}

export class ChainedEntailmentAdapter implements ClaimEntailmentAdapter {
  readonly id: string;

  constructor(private readonly adapters: readonly ClaimEntailmentAdapter[]) {
    if (adapters.length === 0) throw new Error("ChainedEntailmentAdapter изисква поне един verifier adapter.");
    this.id = adapters.map((adapter) => adapter.id).join("+");
  }

  async evaluate(
    claim: ExtractedClaim,
    evidence: EvidenceDocument[],
    signal?: AbortSignal
  ): Promise<EntailmentEvaluation> {
    let lastUnknown: EntailmentEvaluation = { label: "UNKNOWN", evidenceIds: [] };
    for (const adapter of this.adapters) {
      const evaluation = await adapter.evaluate(claim, evidence, signal);
      if (evaluation.label !== "UNKNOWN") return evaluation;
      lastUnknown = evaluation;
    }
    return lastUnknown;
  }
}

function mapEvidenceRefs(ids: string[], evidenceById: Map<string, EvidenceDocument>): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const document = evidenceById.get(id);
    if (!document) continue;
    seen.add(id);
    refs.push({
      evidenceId: document.evidenceId,
      sourceId: document.sourceId,
      contentHash: document.contentHash
    });
  }
  return refs;
}

export class ClaimEvidenceVerifier {
  constructor(
    private readonly extractor: ClaimExtractorAdapter,
    private readonly entailment: ClaimEntailmentAdapter
  ) {}

  async verify(
    text: string,
    evidence: EvidenceDocument[],
    signal?: AbortSignal
  ): Promise<ClaimVerificationReport> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");

    const evidenceById = new Map<string, EvidenceDocument>();
    for (const document of evidence) {
      validateEvidenceDocument(document);
      if (evidenceById.has(document.evidenceId)) {
        throw new Error(`Duplicate evidenceId: ${document.evidenceId}`);
      }
      evidenceById.set(document.evidenceId, document);
    }

    const extracted = await this.extractor.extract(text, signal);
    const claims: VerifiedClaim[] = [];

    for (const claim of extracted) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const literals = extractCriticalLiterals(claim.text);
      const candidates = literals.length === 0
        ? evidence
        : evidence.filter((document) => {
            const normalizedEvidence = normalizeComparableText(document.text);
            return literals.every((literal) => normalizedEvidence.includes(literal));
          });

      if (candidates.length === 0) {
        claims.push({ claimId: claim.claimId, text: claim.text, status: "UNVERIFIED", evidence: [] });
        continue;
      }

      const evaluation = await this.entailment.evaluate(claim, candidates, signal);
      const refs = mapEvidenceRefs(evaluation.evidenceIds, evidenceById);

      let status: ClaimStatus;
      if (evaluation.label === "ENTAILED" && refs.length > 0) status = "VERIFIED";
      else if (evaluation.label === "CONTRADICTED") status = "CONTRADICTED";
      else if (evaluation.label === "CONFLICTING") status = "CONFLICTING";
      else status = "UNVERIFIED";

      claims.push({ claimId: claim.claimId, text: claim.text, status, evidence: refs });
    }

    return {
      extractorId: this.extractor.id,
      verifierId: this.entailment.id,
      claims
    };
  }
}
