import { describe, expect, it } from "vitest";
import type {
  ContentFetchExtractAdapter,
  FetchExtractRequest,
  SearchProviderAdapter,
  SearchRequest
} from "@alpha/retrieval";
import { isSafeHttpUrl } from "@alpha/retrieval";
import { TaskExecutionService, StepExecutorRegistry } from "@alpha/task-execution";
import { RetrievalStepExecutor, SearchStepExecutor } from "@alpha/task-executors";
import { FailClosedStepVerifier } from "@alpha/task-verification";
import type { TaskPlan } from "@alpha/task-engine";

class FakeSearchProvider implements SearchProviderAdapter {
  readonly id = "fake-search";

  async search(request: SearchRequest): Promise<Awaited<ReturnType<SearchProviderAdapter["search"]>>> {
    return [
      {
        sourceId: "SRC-1",
        title: `Result for ${request.query}`,
        url: "https://example.com/source-1",
        snippet: "Example snippet",
        retrievedAtUtc: "2026-08-24T15:30:00Z",
        providerId: this.id
      }
    ];
  }
}

class FakeFetcher implements ContentFetchExtractAdapter {
  readonly id = "fake-fetcher";

  async fetchExtract(request: FetchExtractRequest): Promise<Awaited<ReturnType<ContentFetchExtractAdapter["fetchExtract"]>>> {
    return {
      evidenceId: "E-1",
      sourceId: request.source.sourceId,
      canonicalUrl: request.source.url,
      title: request.source.title,
      mimeType: "text/html",
      text: "Verified extraction fixture text.",
      contentHash: "sha256:fixture",
      retrievedAtUtc: "2026-08-24T15:30:01Z",
      untrusted: true
    };
  }
}

function searchRetrievalPlan(): TaskPlan {
  return {
    taskId: "T-SEARCH",
    originalGoal: "Намери и извлечи актуален източник.",
    status: "PLANNED",
    createdAtUtc: "2026-08-24T15:30:00Z",
    steps: [
      {
        id: "S1",
        kind: "WEB_SEARCH",
        goal: "актуален тестов източник",
        dependsOn: [],
        status: "PENDING",
        retryCount: 0
      },
      {
        id: "S2",
        kind: "RETRIEVAL",
        goal: "извлечи съдържанието от намерените източници",
        dependsOn: ["S1"],
        status: "PENDING",
        retryCount: 0
      }
    ]
  };
}

describe("retrieval adapters and executors", () => {
  it("runs WEB_SEARCH -> RETRIEVAL with provenance preserved", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new SearchStepExecutor(new FakeSearchProvider()));
    registry.register(new RetrievalStepExecutor(new FakeFetcher()));
    const service = new TaskExecutionService(registry, new FailClosedStepVerifier());

    const result = await service.execute(searchRetrievalPlan());

    expect(result.completed).toBe(true);
    expect(result.plan.status).toBe("COMPLETE");
    expect(result.plan.steps[0].status).toBe("COMPLETE");
    expect(result.plan.steps[1].status).toBe("COMPLETE");
    const retrieval = result.plan.steps[1].result as { documents: Array<{ sourceId: string; untrusted: boolean }> };
    expect(retrieval.documents[0].sourceId).toBe("SRC-1");
    expect(retrieval.documents[0].untrusted).toBe(true);
  });

  it("rejects non-http URL schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("https://example.com/path")).toBe(true);
  });

  it("blocks search steps that return zero candidates", async () => {
    const emptyProvider: SearchProviderAdapter = {
      id: "empty",
      async search() { return []; }
    };
    const registry = new StepExecutorRegistry();
    registry.register(new SearchStepExecutor(emptyProvider));
    const service = new TaskExecutionService(registry, new FailClosedStepVerifier());
    const plan = searchRetrievalPlan();
    plan.steps = [plan.steps[0]];

    const result = await service.execute(plan);

    expect(result.completed).toBe(false);
    expect(result.plan.status).toBe("BLOCKED");
    expect(result.plan.steps[0].status).toBe("BLOCKED");
  });

  it("rejects evidence with a mismatched sourceId", async () => {
    const badFetcher: ContentFetchExtractAdapter = {
      id: "bad-fetcher",
      async fetchExtract(request) {
        return {
          evidenceId: "E-BAD",
          sourceId: "OTHER-SOURCE",
          canonicalUrl: request.source.url,
          mimeType: "text/html",
          text: "Bad linkage",
          contentHash: "sha256:bad",
          retrievedAtUtc: "2026-08-24T15:30:01Z",
          untrusted: true
        };
      }
    };

    const registry = new StepExecutorRegistry();
    registry.register(new SearchStepExecutor(new FakeSearchProvider()));
    registry.register(new RetrievalStepExecutor(badFetcher));
    const service = new TaskExecutionService(registry, new FailClosedStepVerifier(), {
      maxSteps: 12,
      maxRetriesPerStep: 0,
      maxModelGenerations: 16,
      maxToolCalls: 20,
      maxWebRequests: 8
    });

    const result = await service.execute(searchRetrievalPlan());

    expect(result.completed).toBe(false);
    expect(result.plan.status).toBe("FAILED");
    expect(result.plan.steps[1].status).toBe("FAILED");
  });
});
