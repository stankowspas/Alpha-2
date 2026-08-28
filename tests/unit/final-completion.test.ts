import { describe, expect, it } from "vitest";
import {
  ExecutionGoalCoverageAdapter,
  FinalCompletionChecker,
  type GoalCoverageAdapter
} from "@alpha/completion";
import type { TaskPlan } from "@alpha/task-engine";

function completedPlan(): TaskPlan {
  return {
    taskId: "T1",
    originalGoal: "Сравни вариантите и дай заключение.",
    status: "COMPLETE",
    createdAtUtc: new Date(0).toISOString(),
    steps: [
      {
        id: "S1",
        kind: "MODEL",
        goal: "Сравни вариантите и дай заключение.",
        dependsOn: [],
        status: "COMPLETE",
        retryCount: 0,
        result: "Проверен резултат"
      }
    ]
  };
}

function multiTargetPlan(): TaskPlan {
  return {
    taskId: "T-MULTI",
    originalGoal: "Напиши първа идея и след това напиши втора идея.",
    status: "COMPLETE",
    createdAtUtc: new Date(0).toISOString(),
    steps: [
      {
        id: "S1",
        kind: "MODEL",
        goal: "Напиши първа идея",
        dependsOn: [],
        status: "COMPLETE",
        retryCount: 0,
        result: "Първа идея"
      },
      {
        id: "S2",
        kind: "MODEL",
        goal: "напиши втора идея.",
        dependsOn: ["S1"],
        status: "COMPLETE",
        retryCount: 0,
        result: "Втора идея"
      }
    ]
  };
}

const coveredAdapter: GoalCoverageAdapter = {
  id: "fake-goal-coverage",
  async evaluate() {
    return { status: "COVERED", score: 1 };
  }
};

describe("FinalCompletionChecker", () => {
  it("does not pass a structurally complete plan without goal coverage verification", async () => {
    const report = await new FinalCompletionChecker().check(completedPlan());

    expect(report.structuralComplete).toBe(true);
    expect(report.complete).toBe(false);
    expect(report.status).toBe("BLOCKED");
    expect(report.issues[0]?.code).toBe("GOAL_COVERAGE_UNAVAILABLE");
  });

  it("passes the completion gate after structural and goal coverage checks pass", async () => {
    const report = await new FinalCompletionChecker(coveredAdapter).check(completedPlan());

    expect(report.complete).toBe(true);
    expect(report.status).toBe("COMPLETION_PASSED");
    expect(report.goalCoverageStatus).toBe("COVERED");
  });

  it("passes with the concrete Alpha adapter when the user-facing step targets the full Original Goal", async () => {
    const report = await new FinalCompletionChecker(new ExecutionGoalCoverageAdapter()).check(completedPlan());

    expect(report.complete).toBe(true);
    expect(report.goalCoverageAdapterId).toBe("execution-goal-coverage-v1");
  });

  it("covers all explicit sequential Original Goal targets before Final Synthesis", async () => {
    const report = await new FinalCompletionChecker(new ExecutionGoalCoverageAdapter()).check(multiTargetPlan());

    expect(report.complete).toBe(true);
    expect(report.goalCoverageStatus).toBe("COVERED");
  });

  it("rejects a structurally complete plan when one Original Goal target was not executed", async () => {
    const plan = multiTargetPlan();
    plan.steps[1].goal = "Напиши трета, несвързана идея.";
    const report = await new FinalCompletionChecker(new ExecutionGoalCoverageAdapter()).check(plan);

    expect(report.complete).toBe(false);
    expect(report.status).toBe("INCOMPLETE");
    expect(report.goalCoverageStatus).toBe("NOT_COVERED");
    expect(report.issues[0]?.code).toBe("GOAL_NOT_COVERED");
  });

  it("fails before goal coverage when a step is not complete", async () => {
    let calls = 0;
    const adapter: GoalCoverageAdapter = {
      id: "should-not-run",
      async evaluate() {
        calls += 1;
        return { status: "COVERED" };
      }
    };
    const plan = completedPlan();
    plan.steps[0].status = "UNVERIFIED";

    const report = await new FinalCompletionChecker(adapter).check(plan);

    expect(report.complete).toBe(false);
    expect(report.structuralComplete).toBe(false);
    expect(calls).toBe(0);
  });

  it("keeps the task incomplete when goal coverage is explicitly missing", async () => {
    const adapter: GoalCoverageAdapter = {
      id: "fake-negative",
      async evaluate() {
        return { status: "NOT_COVERED", reason: "Липсва поисканото заключение." };
      }
    };

    const report = await new FinalCompletionChecker(adapter).check(completedPlan());

    expect(report.complete).toBe(false);
    expect(report.status).toBe("INCOMPLETE");
    expect(report.issues[0]?.code).toBe("GOAL_NOT_COVERED");
  });
});
