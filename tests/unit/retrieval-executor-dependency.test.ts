import { describe, expect, it } from "vitest";
import type {
  ContentFetchExtractAdapter,
  EvidenceDocument,
  FetchExtractRequest,
  SearchExecutionOutput,
  SearchResult
} from "@alpha/retrieval";
import type { StepExecutionContext } from "@alpha/task-execution";
import { RetrievalStepExecutor } from "@alpha/task-executors";
import type { TaskStep } from "@alpha/task-engine";

function searchResult(sourceId: string, query: string): SearchResult {
  return {
    sourceId,
    title: `Source ${sourceId}`,
    url: `https://example.com/${sourceId.toLowerCase()}`,
    retrievedAtUtc: "2026-08-25T00:00:00.000Z",
    providerId: "fake-search",
    fetchToken: "x".repeat(64),
    snippet: query
  };
}

function searchStep(id: string, query: string, sourceId: string): TaskStep {
  const output: SearchExecutionOutput = {
    query,
    results: [searchResult(sourceId, query)]
  };
  return {
    id,
    kind: "WEB_SEARCH",
    goal: query,
    dependsOn: [],
    status: "COMPLETE",
    retryCount: 0,
    result: output
  };
}

class RecordingFetcher implements ContentFetchExtractAdapter {
  readonly id = "recording-fetcher";
  readonly sourceIds: string[] = [];

  async fetchExtract(request: FetchExtractRequest): Promise<EvidenceDocument> {
    this.sourceIds.push(request.source.sourceId);
    return {
      evidenceId: `E-${request.source.sourceId}`,
      sourceId: request.source.sourceId,
      canonicalUrl: request.source.url,
      mimeType: "text/html",
      text: `Evidence for ${request.source.sourceId}`,
      contentHash: `sha256:${request.source.sourceId}`,
      retrievedAtUtc: "2026-08-25T00:01:00.000Z",
      untrusted: true
    };
  }
}

function context(dependsOn: string[], completedSteps: TaskStep[]): StepExecutionContext {
  return {
    taskId: "T-RET",
    originalGoal: "Използвай правилния източник.",
    currentStep: {
      id: "R1",
      kind: "RETRIEVAL",
      goal: "Извлечи доказателства",
      dependsOn,
      status: "RUNNING",
      retryCount: 0
    },
    completedSteps
  };
}

describe("RetrievalStepExecutor dependency provenance", () => {
  it("uses the declared WEB_SEARCH dependency, not the last completed search", async () => {
    const fetcher = new RecordingFetcher();
    const executor = new RetrievalStepExecutor(fetcher, { maxDocuments: 1 });
    const first = searchStep("S1", "първа тема", "SRC-FIRST");
    const unrelatedLater = searchStep("S2", "друга тема", "SRC-LATER");

    const result = await executor.execute(context(["S1"], [first, unrelatedLater]));

    expect(fetcher.sourceIds).toEqual(["SRC-FIRST"]);
    expect((result.output as { query: string }).query).toBe("първа тема");
  });

  it("fails closed when no declared WEB_SEARCH dependency is complete", async () => {
    const fetcher = new RecordingFetcher();
    const executor = new RetrievalStepExecutor(fetcher);
    const unrelated = searchStep("S2", "друга тема", "SRC-LATER");

    await expect(executor.execute(context(["S1"], [unrelated])))
      .rejects.toThrow(/деклариран COMPLETE WEB_SEARCH dependency/iu);
    expect(fetcher.sourceIds).toEqual([]);
  });

  it("fails closed when retrieval declares multiple WEB_SEARCH dependencies", async () => {
    const fetcher = new RecordingFetcher();
    const executor = new RetrievalStepExecutor(fetcher);
    const first = searchStep("S1", "първа тема", "SRC-FIRST");
    const second = searchStep("S2", "втора тема", "SRC-SECOND");

    await expect(executor.execute(context(["S1", "S2"], [first, second])))
      .rejects.toThrow(/повече от един WEB_SEARCH dependency/iu);
    expect(fetcher.sourceIds).toEqual([]);
  });
});
