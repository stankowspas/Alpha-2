import { describe, expect, it } from "vitest";
import type { GenerationInput, ModelAdapter, ModelCapabilities } from "@alpha/models";
import { TaskExecutionService, StepExecutorRegistry, type StepExecutionContext } from "@alpha/task-execution";
import { CalculatorStepExecutor, ModelStepExecutor, type StepContextAssembler } from "@alpha/task-executors";
import { FailClosedStepVerifier } from "@alpha/task-verification";
import type { TaskPlan, TaskStep } from "@alpha/task-engine";

function planFor(step: TaskStep): TaskPlan {
  return {
    taskId: "T1",
    originalGoal: step.goal,
    status: "PLANNED",
    createdAtUtc: new Date(0).toISOString(),
    steps: [step]
  };
}

function step(kind: TaskStep["kind"], goal: string): TaskStep {
  return { id: "S1", kind, goal, dependsOn: [], status: "PENDING", retryCount: 0 };
}

class FakeModel implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    maxContext: 4096,
    thinkingSupport: true,
    structuredOutputSupport: true,
    toolCallSupport: false,
    stopTokens: [],
    modelId: "fake-model"
  };
  readonly loaded = true;
  async load(): Promise<void> {}
  async unload(): Promise<void> {}
  async *generate(_input: GenerationInput): AsyncIterable<string> {
    yield "Моделен ";
    yield "резултат";
  }
}

class SplitThinkingModel extends FakeModel {
  override async *generate(_input: GenerationInput): AsyncIterable<string> {
    yield "<th";
    yield "ink>secret  ";
    yield "</th";
    yield "ink>  Answer";
  }
}

class RemoteMetadataModel extends FakeModel {
  readonly lastGenerationMetadata = {
    requestedModel: "gemini-3.6-flash",
    actualModel: "gemini-3.5-flash",
    fallbackUsed: true,
    fallbackReason: "requested_model_unavailable",
    provider: "g4f-gemini"
  };
  override async *generate(_input: GenerationInput): AsyncIterable<string> {
    yield "Remote ";
    yield "answer";
  }
}
const assembler: StepContextAssembler = {
  assemble(context) {
    return {
      systemPrompt: "Execute exactly one step.",
      userPrompt: context.currentStep.goal,
      maxTokens: 128,
      thinking: false,
      audit: {
        inputTokenBudget: 512,
        estimatedInputTokens: 32,
        includedBlockIds: ["original-goal", `current-step:${context.currentStep.id}`],
        droppedBlockIds: []
      }
    };
  }
};

describe("concrete step executors", () => {
  it("completes a deterministic calculator step through TaskExecutionService", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new CalculatorStepExecutor());
    const service = new TaskExecutionService(registry, new FailClosedStepVerifier());

    const result = await service.execute(planFor(step("CALCULATOR", "Изчисли 17.5% от 4382")));

    expect(result.completed).toBe(true);
    expect(result.plan.status).toBe("COMPLETE");
    expect(result.plan.steps[0].status).toBe("COMPLETE");
    expect((result.plan.steps[0].result as { value: number }).value).toBeCloseTo(766.85, 10);
  });

  it("rejects a tampered calculator result", async () => {
    const verifier = new FailClosedStepVerifier();
    const current = step("CALCULATOR", "2 + 2");
    const context: StepExecutionContext = {
      taskId: "T1",
      originalGoal: "2 + 2",
      currentStep: current,
      completedSteps: []
    };

    const result = await verifier.verify(context, {
      output: { expression: "2 + 2", value: 5, formatted: "5" }
    });

    expect(result.status).toBe("FAILED");
  });

  it("generates model output but keeps it UNVERIFIED", async () => {
    const modelExecutor = new ModelStepExecutor(new FakeModel(), assembler);
    const current = step("MODEL", "Обясни причината.");
    const context: StepExecutionContext = {
      taskId: "T2",
      originalGoal: current.goal,
      currentStep: current,
      completedSteps: []
    };

    const execution = await modelExecutor.execute(context);
    expect(execution.output).toBe("Моделен резултат");
    expect(execution.metadata?.generationComplete).toBe(true);
    expect(execution.metadata?.contextAudit).toBeDefined();

    const verification = await new FailClosedStepVerifier().verify(context, execution);
    expect(verification.status).toBe("UNVERIFIED");
  });

  it("streams model-independent remote output and records actual model metadata", async () => {
    const streamedAnswer: string[] = [];
    const streamedThinking: string[] = [];
    const modelExecutor = new ModelStepExecutor(new RemoteMetadataModel(), assembler, {
      onAnswerToken: (_context, token) => streamedAnswer.push(token),
      onThinkingToken: (_context, token) => streamedThinking.push(token)
    });
    const current = step("MODEL", "Тестов prompt");
    const context: StepExecutionContext = { taskId: "T-STREAM", originalGoal: current.goal, currentStep: current, completedSteps: [] };
    const execution = await modelExecutor.execute(context);
    expect(execution.output).toBe("Remote answer");
    expect(streamedAnswer.join("")).toBe("Remote answer");
    expect(streamedThinking).toEqual([]);
    expect(execution.metadata?.modelId).toBe("gemini-3.5-flash");
    expect(execution.metadata?.fallbackUsed).toBe(true);
    expect(execution.metadata?.provider).toBe("g4f-gemini");
  });
  it("prevents a model-only task from being marked complete", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ModelStepExecutor(new FakeModel(), assembler));
    const service = new TaskExecutionService(registry, new FailClosedStepVerifier());

    const result = await service.execute(planFor(step("MODEL", "Напиши фактологичен отговор.")));

    expect(result.completed).toBe(false);
    expect(result.plan.status).toBe("FAILED");
    expect(result.plan.steps[0].status).toBe("UNVERIFIED");
  });
});
