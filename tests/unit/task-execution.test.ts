import { describe, expect, it } from "vitest";
import {
  StepExecutorRegistry,
  TaskExecutionService,
  type StepExecutionContext,
  type StepExecutionResult,
  type StepExecutor,
  type StepVerifier
} from "../../packages/task-execution/src/index";
import { createSingleStepPlan, normalizeRequest, type StepVerification } from "../../packages/task-engine/src/index";

class ModelExecutor implements StepExecutor {
  readonly kinds = ["MODEL"] as const;
  calls = 0;

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    this.calls += 1;
    return { output: `draft:${context.currentStep.goal}` };
  }
}

class CompleteVerifier implements StepVerifier {
  async verify(): Promise<StepVerification> {
    return { status: "COMPLETE" };
  }
}

describe("TaskExecutionService", () => {
  it("requires verification before a returned generation becomes COMPLETE", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new ModelExecutor();
    registry.register(executor);

    const verifier: StepVerifier = {
      async verify() { return { status: "UNVERIFIED", reason: "no evidence" }; }
    };

    const service = new TaskExecutionService(registry, verifier);
    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тестова задача")));

    expect(executor.calls).toBe(1);
    expect(result.completed).toBe(false);
    expect(result.plan.steps[0].status).toBe("UNVERIFIED");
  });

  it("marks a verified step and task COMPLETE", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ModelExecutor());
    const service = new TaskExecutionService(registry, new CompleteVerifier());

    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тестова задача")));

    expect(result.completed).toBe(true);
    expect(result.plan.status).toBe("COMPLETE");
    expect(result.plan.steps[0].status).toBe("COMPLETE");
    expect(result.plan.steps[0].result).toBe("draft:Тестова задача");
  });

  it("fails closed when an executor is unavailable", async () => {
    const service = new TaskExecutionService(new StepExecutorRegistry(), new CompleteVerifier());
    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тест")));

    expect(result.completed).toBe(false);
    expect(result.failureReason).toBe("EXECUTOR_UNAVAILABLE");
    expect(result.plan.steps[0].status).toBe("BLOCKED");
  });

  it("uses bounded retries for NEEDS_REPAIR", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new ModelExecutor();
    registry.register(executor);
    const verifier: StepVerifier = {
      async verify() { return { status: "NEEDS_REPAIR", reason: "repair" }; }
    };
    const service = new TaskExecutionService(registry, verifier, {
      maxSteps: 4,
      maxRetriesPerStep: 1,
      maxModelGenerations: 4,
      maxToolCalls: 4,
      maxWebRequests: 2
    });

    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тест")));

    expect(result.completed).toBe(false);
    expect(result.plan.steps[0].status).toBe("FAILED");
    expect(executor.calls).toBe(2);
  });

  it("turns budget exhaustion into a controlled BLOCKED task state", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new ModelExecutor();
    registry.register(executor);
    const service = new TaskExecutionService(registry, new CompleteVerifier(), {
      maxSteps: 4,
      maxRetriesPerStep: 1,
      maxModelGenerations: 0,
      maxToolCalls: 4,
      maxWebRequests: 2
    });

    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тест")));

    expect(result.completed).toBe(false);
    expect(result.failureReason).toBe("BUDGET_EXCEEDED");
    expect(result.plan.status).toBe("BLOCKED");
    expect(result.plan.steps[0].status).toBe("BLOCKED");
    expect(executor.calls).toBe(0);
  });

  it("blocks before sending a network request that would exceed maxWebRequests", async () => {
    let networkCalls = 0;
    const executor: StepExecutor = {
      kinds: ["WEB_SEARCH"] as const,
      async execute(context) {
        context.recordWebRequest?.();
        networkCalls += 1;
        context.recordWebRequest?.();
        networkCalls += 1;
        return { output: { query: "q", results: [] } };
      }
    };
    const registry = new StepExecutorRegistry();
    registry.register(executor);
    const plan = createSingleStepPlan(normalizeRequest("Тест web budget"));
    plan.steps[0].kind = "WEB_SEARCH";
    const service = new TaskExecutionService(registry, new CompleteVerifier(), {
      maxSteps: 4,
      maxRetriesPerStep: 1,
      maxModelGenerations: 4,
      maxToolCalls: 4,
      maxWebRequests: 1
    });

    const result = await service.execute(plan);

    expect(result.completed).toBe(false);
    expect(result.failureReason).toBe("BUDGET_EXCEEDED");
    expect(result.plan.status).toBe("BLOCKED");
    expect(result.plan.steps[0].status).toBe("BLOCKED");
    expect(networkCalls).toBe(1);
    expect(service.controller.counters.webRequests).toBe(1);
  });

  it("turns verifier exceptions into a controlled BLOCKED task state", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ModelExecutor());
    const verifier: StepVerifier = {
      async verify() { throw new Error("verifier crashed"); }
    };
    const service = new TaskExecutionService(registry, verifier);

    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тест")));

    expect(result.completed).toBe(false);
    expect(result.failureReason).toBe("VERIFICATION_ERROR");
    expect(result.plan.status).toBe("BLOCKED");
    expect(result.plan.steps[0].status).toBe("BLOCKED");
    expect(result.plan.steps[0].error).toBe("verifier crashed");
  });

  it("normalizes AbortError from an executor to CANCELLED without retrying", async () => {
    const registry = new StepExecutorRegistry();
    const executor: StepExecutor = {
      kinds: ["MODEL"] as const,
      async execute() { throw new DOMException("Cancelled", "AbortError"); }
    };
    registry.register(executor);
    const service = new TaskExecutionService(registry, new CompleteVerifier());

    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тест")));

    expect(result.completed).toBe(false);
    expect(result.failureReason).toBe("CANCELLED");
    expect(result.plan.status).toBe("CANCELLED");
    expect(result.plan.steps[0].status).toBe("CANCELLED");
  });

  it("cancels without marking pending work complete", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ModelExecutor());
    const controller = new AbortController();
    controller.abort();
    const service = new TaskExecutionService(registry, new CompleteVerifier());

    const result = await service.execute(createSingleStepPlan(normalizeRequest("Тест")), controller.signal);

    expect(result.completed).toBe(false);
    expect(result.plan.status).toBe("CANCELLED");
    expect(result.plan.steps[0].status).toBe("CANCELLED");
  });
});
