import { describe, expect, it } from "vitest";
import type { StepContextAssembler } from "@alpha/context";
import type { GenerationInput, ModelAdapter, ModelCapabilities } from "@alpha/models";
import type { EvidenceDocument, RetrievalExecutionOutput } from "@alpha/retrieval";
import {
  StepExecutorRegistry,
  TaskExecutionService,
  type StepExecutionContext,
  type StepExecutionResult,
  type StepExecutor
} from "@alpha/task-execution";
import { ModelStepExecutor } from "@alpha/task-executors";
import {
  ClaimEvidenceModelStepVerifier,
  FailClosedStepVerifier
} from "@alpha/task-verification";
import type { TaskPlan, TaskStep } from "@alpha/task-engine";
import {
  ClaimEvidenceVerifier,
  ConservativeSentenceClaimExtractor,
  ExactTextEntailmentAdapter
} from "@alpha/verification";

const document: EvidenceDocument = {
  evidenceId: "E1",
  sourceId: "SRC1",
  canonicalUrl: "https://example.com/report",
  mimeType: "text/html",
  text: "Компания X отчита приходи от 42 млн. лв. през 2025 г.",
  contentHash: "sha256:e1",
  retrievedAtUtc: "2026-08-24T15:45:00Z",
  untrusted: true
};

class FixtureRetrievalExecutor implements StepExecutor {
  readonly kinds = ["RETRIEVAL"] as const;

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const output: RetrievalExecutionOutput = {
      query: context.currentStep.goal,
      documents: [document]
    };
    return { output, metadata: { fixture: true } };
  }
}

class FixtureModel implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 4096,
    thinkingSupport: true,
    structuredOutputSupport: true,
    toolCallSupport: false,
    stopTokens: [],
    modelId: "fixture-model"
  };
  readonly loaded = true;

  constructor(private readonly output: string) {}
  async load(): Promise<void> {}
  async unload(): Promise<void> {}
  async *generate(_input: GenerationInput): AsyncIterable<string> {
    yield this.output;
  }
}

const assembler: StepContextAssembler = {
  assemble(context) {
    return {
      systemPrompt: "Fixture system prompt",
      userPrompt: context.currentStep.goal,
      maxTokens: 128,
      thinking: false,
      audit: {
        inputTokenBudget: 1000,
        estimatedInputTokens: 50,
        includedBlockIds: ["original-goal", `current-step:${context.currentStep.id}`, "evidence:E1"],
        droppedBlockIds: []
      }
    };
  }
};

function plan(): TaskPlan {
  return {
    taskId: "T-MODEL-VAP",
    originalGoal: "Извлечи данните и дай само провереното твърдение.",
    status: "PLANNED",
    createdAtUtc: "2026-08-24T15:45:00Z",
    steps: [
      {
        id: "S1",
        kind: "RETRIEVAL",
        goal: "fixture evidence",
        dependsOn: [],
        status: "PENDING",
        retryCount: 0
      },
      {
        id: "S2",
        kind: "MODEL",
        goal: "Формулирай проверения факт.",
        dependsOn: ["S1"],
        status: "PENDING",
        retryCount: 0
      }
    ]
  };
}

function createVerifier() {
  const claims = new ClaimEvidenceVerifier(
    new ConservativeSentenceClaimExtractor(),
    new ExactTextEntailmentAdapter()
  );
  return new FailClosedStepVerifier(new ClaimEvidenceModelStepVerifier(claims));
}

function completeRetrievalStep(id: string, evidence: EvidenceDocument): TaskStep {
  return {
    id,
    kind: "RETRIEVAL",
    goal: `retrieval ${id}`,
    dependsOn: [],
    status: "COMPLETE",
    retryCount: 0,
    result: { query: id, documents: [evidence] }
  };
}

describe("MODEL claim/evidence step verification", () => {
  it("completes a MODEL step only when every claim is supported", async () => {
    const executors = new StepExecutorRegistry();
    executors.register(new FixtureRetrievalExecutor());
    executors.register(new ModelStepExecutor(
      new FixtureModel("Компания X отчита приходи от 42 млн. лв. през 2025 г."),
      assembler
    ));

    const service = new TaskExecutionService(executors, createVerifier());
    const result = await service.execute(plan());

    expect(result.completed).toBe(true);
    expect(result.plan.status).toBe("COMPLETE");
    expect(result.plan.steps[1].status).toBe("COMPLETE");
    expect(result.plan.steps[1].resultMetadata?.modelId).toBe("fixture-model");
    const verification = result.plan.steps[1].verificationMetadata?.claimVerification as {
      claims: Array<{ status: string; evidence: Array<{ evidenceId: string }> }>;
    };
    expect(verification.claims[0].status).toBe("VERIFIED");
    expect(verification.claims[0].evidence[0].evidenceId).toBe("E1");
    expect(result.plan.steps[1].verificationMetadata?.evidencePackIds).toEqual(["E1"]);
  });

  it("fails closed when the model invents a numeric fact", async () => {
    const executors = new StepExecutorRegistry();
    executors.register(new FixtureRetrievalExecutor());
    executors.register(new ModelStepExecutor(
      new FixtureModel("Компания X отчита приходи от 43 млн. лв. през 2025 г."),
      assembler
    ));

    const service = new TaskExecutionService(executors, createVerifier());
    const result = await service.execute(plan());

    expect(result.completed).toBe(false);
    expect(result.plan.status).toBe("FAILED");
    expect(result.plan.steps[1].status).toBe("UNVERIFIED");
    const verification = result.plan.steps[1].verificationMetadata?.claimVerification as {
      claims: Array<{ status: string }>;
    };
    expect(verification.claims[0].status).toBe("UNVERIFIED");
  });

  it("does not verify a claim with evidence outside the current dependency/context Evidence Pack", async () => {
    const requiredEvidence: EvidenceDocument = {
      ...document,
      evidenceId: "E-required",
      sourceId: "SRC-required",
      canonicalUrl: "https://example.com/required",
      text: "Required evidence says something else.",
      contentHash: "sha256:required"
    };
    const unrelatedSupportingEvidence: EvidenceDocument = {
      ...document,
      evidenceId: "E-unrelated",
      sourceId: "SRC-unrelated",
      canonicalUrl: "https://example.com/unrelated",
      contentHash: "sha256:unrelated"
    };

    const currentStep: TaskStep = {
      id: "S3",
      kind: "MODEL",
      goal: "Формулирай текущия факт.",
      dependsOn: ["S1"],
      status: "RUNNING",
      retryCount: 0
    };
    const context: StepExecutionContext = {
      taskId: "T-SCOPED-EVIDENCE",
      originalGoal: "Дай проверен факт.",
      currentStep,
      completedSteps: [
        completeRetrievalStep("S1", requiredEvidence),
        completeRetrievalStep("S2", unrelatedSupportingEvidence)
      ]
    };
    const result: StepExecutionResult = {
      output: document.text,
      metadata: {
        contextAudit: {
          includedBlockIds: ["original-goal", "current-step:S3", "evidence:E-required"]
        }
      }
    };

    const claims = new ClaimEvidenceVerifier(
      new ConservativeSentenceClaimExtractor(),
      new ExactTextEntailmentAdapter()
    );
    const verification = await new ClaimEvidenceModelStepVerifier(claims).verify(context, result);

    expect(verification.status).toBe("UNVERIFIED");
  });
});
