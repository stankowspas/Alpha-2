import {
  isStandaloneHardConstraint,
  type TaskPlan,
  type TaskStep
} from "@alpha/task-engine";

export type GoalCoverageStatus = "COVERED" | "NOT_COVERED" | "UNKNOWN";
export type FinalCompletionStatus = "COMPLETION_PASSED" | "INCOMPLETE" | "BLOCKED";

export interface GoalCoverageEvaluation {
  status: GoalCoverageStatus;
  reason?: string;
  score?: number;
}

export interface GoalCoverageContext {
  taskId: string;
  originalGoal: string;
  constraints?: readonly string[];
  completedSteps: TaskStep[];
}

export interface GoalCoverageAdapter {
  readonly id: string;
  evaluate(context: GoalCoverageContext, signal?: AbortSignal): Promise<GoalCoverageEvaluation>;
}

export interface CompletionIssue {
  code:
    | "EMPTY_GOAL"
    | "NO_STEPS"
    | "PLAN_NOT_EXECUTION_COMPLETE"
    | "STEP_NOT_COMPLETE"
    | "MISSING_STEP_RESULT"
    | "DEPENDENCY_NOT_COMPLETE"
    | "GOAL_COVERAGE_UNAVAILABLE"
    | "GOAL_NOT_COVERED"
    | "GOAL_COVERAGE_UNKNOWN"
    | "CANCELLED";
  message: string;
  stepId?: string;
}

export interface FinalCompletionReport {
  status: FinalCompletionStatus;
  complete: boolean;
  structuralComplete: boolean;
  goalCoverageStatus: GoalCoverageStatus | "NOT_CHECKED";
  goalCoverageAdapterId?: string;
  issues: CompletionIssue[];
}

function structuralIssues(plan: TaskPlan): CompletionIssue[] {
  const issues: CompletionIssue[] = [];

  if (!plan.originalGoal.trim()) {
    issues.push({ code: "EMPTY_GOAL", message: "Task plan няма Original Goal." });
  }

  if (plan.steps.length === 0) {
    issues.push({ code: "NO_STEPS", message: "Task plan няма изпълними стъпки." });
  }

  // `TaskPlan.status === COMPLETE` currently means the execution loop finished.
  // Final user-visible TASK_COMPLETE is reserved for the finalization layer.
  if (plan.status !== "COMPLETE") {
    issues.push({
      code: "PLAN_NOT_EXECUTION_COMPLETE",
      message: `Execution plan status е ${plan.status}, а не COMPLETE.`
    });
  }

  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  for (const step of plan.steps) {
    if (step.status !== "COMPLETE") {
      issues.push({
        code: "STEP_NOT_COMPLETE",
        stepId: step.id,
        message: `Стъпка ${step.id} е ${step.status}, а не COMPLETE.`
      });
      continue;
    }

    if (step.result === undefined) {
      issues.push({
        code: "MISSING_STEP_RESULT",
        stepId: step.id,
        message: `Стъпка ${step.id} е COMPLETE, но няма result.`
      });
    }

    for (const dependencyId of step.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (!dependency || dependency.status !== "COMPLETE") {
        issues.push({
          code: "DEPENDENCY_NOT_COMPLETE",
          stepId: step.id,
          message: `Dependency ${dependencyId} за ${step.id} не е COMPLETE.`
        });
      }
    }
  }

  return issues;
}

function normalizeCoverageText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[.!?;:,]+$/gu, "")
    .trim();
}

function extractCoverageTargets(originalGoal: string): string[] {
  const normalized = originalGoal.trim().replace(/\s+/gu, " ");
  if (!normalized) return [];

  const numbered = normalized
    .split(/(?:^|\s)(?:\d+[.)]|[-*])\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 8);
  if (numbered.length >= 2) return numbered;

  const sequential = normalized
    .split(/(?:и след това|след което|накрая|[.;])/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 8);
  return sequential.length >= 2 ? sequential : [normalized];
}

function hasUsableResult(step: TaskStep): boolean {
  if (step.result === undefined || step.result === null) return false;
  if (typeof step.result === "string") return step.result.trim().length > 0;
  return true;
}

function isUserFacingStep(step: TaskStep): boolean {
  return step.kind === "MODEL" || step.kind === "CALCULATOR" || step.kind === "WEATHER" || step.kind === "TIME" || step.kind === "TOOL";
}

/**
 * Alpha adapter: verifies deterministic plan/result coverage of the immutable
 * Original Goal before Final Synthesis. Standalone hard constraints are modeled
 * separately and are mandatory execution context, not independent task goals.
 * Factual correctness remains VAP's job.
 */
export class ExecutionGoalCoverageAdapter implements GoalCoverageAdapter {
  readonly id = "execution-goal-coverage-v1";

  async evaluate(context: GoalCoverageContext, signal?: AbortSignal): Promise<GoalCoverageEvaluation> {
    if (signal?.aborted) {
      return { status: "UNKNOWN", reason: "Goal coverage evaluation cancelled." };
    }

    const standaloneConstraints = new Set(
      (context.constraints ?? [])
        .filter(isStandaloneHardConstraint)
        .map(normalizeCoverageText)
    );
    const targets = extractCoverageTargets(context.originalGoal)
      .filter((target) => !standaloneConstraints.has(normalizeCoverageText(target)));

    if (targets.length === 0) {
      return { status: "NOT_COVERED", reason: "Original Goal няма изпълнима подцел извън standalone constraints." };
    }

    const userFacing = context.completedSteps.filter(isUserFacingStep);
    if (userFacing.length === 0) {
      return { status: "NOT_COVERED", reason: "Няма COMPLETE user-facing step result." };
    }
    if (userFacing.some((step) => !hasUsableResult(step))) {
      return { status: "NOT_COVERED", reason: "Поне един user-facing step няма използваем result." };
    }

    const stepGoals = userFacing.map((step) => normalizeCoverageText(step.goal));
    const uncovered = targets.filter((target) => {
      const normalizedTarget = normalizeCoverageText(target);
      return !stepGoals.some((goal) => goal.includes(normalizedTarget) || normalizedTarget.includes(goal));
    });

    if (uncovered.length === 0) {
      return { status: "COVERED", score: 1 };
    }

    return {
      status: "NOT_COVERED",
      reason: `Липсва изпълнена подцел от Original Goal: ${uncovered[0]}`
    };
  }
}

export class FinalCompletionChecker {
  constructor(private readonly goalCoverage?: GoalCoverageAdapter) {}

  async check(plan: TaskPlan, signal?: AbortSignal): Promise<FinalCompletionReport> {
    if (signal?.aborted) {
      return {
        status: "BLOCKED",
        complete: false,
        structuralComplete: false,
        goalCoverageStatus: "NOT_CHECKED",
        issues: [{ code: "CANCELLED", message: "Final completion check е отменен." }]
      };
    }

    const issues = structuralIssues(plan);
    if (issues.length > 0) {
      return {
        status: "INCOMPLETE",
        complete: false,
        structuralComplete: false,
        goalCoverageStatus: "NOT_CHECKED",
        issues
      };
    }

    if (!this.goalCoverage) {
      return {
        status: "BLOCKED",
        complete: false,
        structuralComplete: true,
        goalCoverageStatus: "NOT_CHECKED",
        issues: [{
          code: "GOAL_COVERAGE_UNAVAILABLE",
          message: "Няма независим GoalCoverageAdapter; completion gate не може да мине само по step statuses."
        }]
      };
    }

    const evaluation = await this.goalCoverage.evaluate({
      taskId: plan.taskId,
      originalGoal: plan.originalGoal,
      constraints: [...(plan.constraints ?? [])],
      completedSteps: plan.steps.map((step) => structuredClone(step))
    }, signal);

    if (evaluation.status === "COVERED") {
      return {
        status: "COMPLETION_PASSED",
        complete: true,
        structuralComplete: true,
        goalCoverageStatus: "COVERED",
        goalCoverageAdapterId: this.goalCoverage.id,
        issues: []
      };
    }

    if (evaluation.status === "NOT_COVERED") {
      return {
        status: "INCOMPLETE",
        complete: false,
        structuralComplete: true,
        goalCoverageStatus: "NOT_COVERED",
        goalCoverageAdapterId: this.goalCoverage.id,
        issues: [{
          code: "GOAL_NOT_COVERED",
          message: evaluation.reason ?? "Изпълнените стъпки не покриват изцяло Original Goal."
        }]
      };
    }

    return {
      status: "BLOCKED",
      complete: false,
      structuralComplete: true,
      goalCoverageStatus: "UNKNOWN",
      goalCoverageAdapterId: this.goalCoverage.id,
      issues: [{
        code: "GOAL_COVERAGE_UNKNOWN",
        message: evaluation.reason ?? "Goal coverage не може да бъде надеждно определен."
      }]
    };
  }
}
