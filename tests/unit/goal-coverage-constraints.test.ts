import { describe, expect, it } from "vitest";
import {
  ExecutionGoalCoverageAdapter,
  FinalCompletionChecker
} from "@alpha/completion";
import type { TaskPlan } from "@alpha/task-engine";

function constrainedPlan(): TaskPlan {
  return {
    taskId: "T-CONSTRAINT-COVERAGE",
    originalGoal: "Напиши кратък анализ. Без таблици. Максимум 200 думи. Само на български.",
    constraints: ["Без таблици.", "Максимум 200 думи.", "Само на български."],
    status: "COMPLETE",
    createdAtUtc: new Date(0).toISOString(),
    steps: [{
      id: "S1",
      kind: "MODEL",
      goal: "Напиши кратък анализ",
      dependsOn: [],
      status: "COMPLETE",
      retryCount: 0,
      result: "Кратък анализ на български без таблица."
    }]
  };
}

describe("GoalCoverage with hard constraints", () => {
  it("does not treat standalone hard constraints as independent execution goals", async () => {
    const report = await new FinalCompletionChecker(
      new ExecutionGoalCoverageAdapter()
    ).check(constrainedPlan());

    expect(report.complete).toBe(true);
    expect(report.status).toBe("COMPLETION_PASSED");
    expect(report.goalCoverageStatus).toBe("COVERED");
  });

  it("does not pass a request that contains only standalone constraints and no executable goal", async () => {
    const plan = constrainedPlan();
    plan.originalGoal = "Без таблици. Максимум 200 думи.";
    plan.constraints = ["Без таблици.", "Максимум 200 думи."];
    plan.steps[0].goal = "Без таблици";

    const report = await new FinalCompletionChecker(
      new ExecutionGoalCoverageAdapter()
    ).check(plan);

    expect(report.complete).toBe(false);
    expect(report.status).toBe("INCOMPLETE");
    expect(report.issues[0]?.code).toBe("GOAL_NOT_COVERED");
  });
});
