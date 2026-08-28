import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTION_LIMITS,
  ExecutionController,
  TaskRegistry,
  createSingleStepPlan,
  extractHardConstraints,
  normalizeRequest
} from "../../packages/task-engine/src/index";

describe("Task Engine — no heuristic routing", () => {
  it("creates exactly one MODEL step for a normal request", () => {
    const plan = createSingleStepPlan(normalizeRequest("Какво е инфлация?"));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].kind).toBe("MODEL");
  });

  it("does not route calculator-looking input to a tool", () => {
    const plan = createSingleStepPlan(normalizeRequest("17.5% от 4382"));
    expect(plan.steps.map((step) => step.kind)).toEqual(["MODEL"]);
  });

  it("does not route weather-looking input to a tool", () => {
    const plan = createSingleStepPlan(normalizeRequest("Какво е времето в София?"));
    expect(plan.steps.map((step) => step.kind)).toEqual(["MODEL"]);
  });

  it("does not route current-looking input to web", () => {
    const plan = createSingleStepPlan(normalizeRequest("Каква е днешната цена на KO?"));
    expect(plan.steps.map((step) => step.kind)).toEqual(["MODEL"]);
  });

  it("preserves explicit hard constraints", () => {
    const text = "Напиши кратък анализ. Без таблици. Максимум 200 думи.";
    const request = normalizeRequest(text);
    const plan = createSingleStepPlan(request);
    expect(request.constraints).toEqual(["Без таблици.", "Максимум 200 думи."]);
    expect(plan.constraints).toEqual(request.constraints);
    expect(plan.originalGoal).toBe(text);
  });

  it("does not misclassify ordinary wording as a hard constraint", () => {
    expect(extractHardConstraints("Трябва ли водата да кипи при 100 градуса?")).toEqual([]);
    expect(extractHardConstraints("Какво става с вода без сол?")).toEqual([]);
  });

  it("keeps standalone constraints out of the executable MODEL goal", () => {
    const plan = createSingleStepPlan(normalizeRequest(
      "Напиши кратък анализ. Без таблици. Максимум 200 думи. Само на български."
    ));
    expect(plan.steps[0].goal).toBe("Напиши кратък анализ.");
  });

  it("does not equate generation with step completion", () => {
    const plan = createSingleStepPlan(normalizeRequest("Тест"));
    const controller = new ExecutionController(DEFAULT_EXECUTION_LIMITS);
    const step = controller.selectNextReadyStep(plan)!;
    controller.beginStep(step);
    controller.applyVerification(step, { status: "UNVERIFIED" });
    expect(controller.allStepsComplete(plan)).toBe(false);
    expect(step.status).toBe("UNVERIFIED");
  });

  it("caps retries per step", () => {
    const plan = createSingleStepPlan(normalizeRequest("Тест"));
    const controller = new ExecutionController({ ...DEFAULT_EXECUTION_LIMITS, maxRetriesPerStep: 1 });
    const step = plan.steps[0];
    controller.prepareRetry(step);
    expect(step.retryCount).toBe(1);
    controller.prepareRetry(step);
    expect(step.status).toBe("FAILED");
  });

  it("rejects dependency cycles", () => {
    const plan = createSingleStepPlan(normalizeRequest("Тест"));
    plan.steps.push({ id: "S2", kind: "MODEL", goal: "Втора", dependsOn: ["S1"], status: "PENDING", retryCount: 0 });
    plan.steps[0].dependsOn = ["S2"];
    expect(() => new ExecutionController(DEFAULT_EXECUTION_LIMITS).validatePlan(plan)).toThrow(/циклична/iu);
  });

  it("registry snapshots do not expose mutable internal state", () => {
    const registry = new TaskRegistry(createSingleStepPlan(normalizeRequest("Тест")));
    const snapshot = registry.snapshot();
    snapshot.steps[0].status = "FAILED";
    expect(registry.getStep("S1")?.status).toBe("PENDING");
  });
});
