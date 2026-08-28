import {
  DEFAULT_EXECUTION_LIMITS,
  ExecutionBudgetExceededError,
  ExecutionController,
  TaskRegistry,
  type ExecutionLimits,
  type StepKind,
  type StepVerification,
  type TaskPlan,
  type TaskStep
} from "@alpha/task-engine";

export interface StepExecutionContext {
  taskId: string;
  originalGoal: string;
  constraints?: readonly string[];
  currentStep: TaskStep;
  completedSteps: TaskStep[];
  signal?: AbortSignal;
  recordWebRequest?: () => void;
}

export interface StepExecutionResult {
  output: unknown;
  metadata?: Record<string, unknown>;
}

export interface StepExecutor {
  readonly kinds: readonly StepKind[];
  execute(context: StepExecutionContext): Promise<StepExecutionResult>;
}

export interface StepVerifier {
  verify(
    context: StepExecutionContext,
    result: StepExecutionResult
  ): Promise<StepVerification>;
}

export class StepExecutorRegistry {
  readonly #executors = new Map<StepKind, StepExecutor>();

  register(executor: StepExecutor): void {
    for (const kind of executor.kinds) {
      if (this.#executors.has(kind)) {
        throw new Error(`Вече има StepExecutor за ${kind}.`);
      }
      this.#executors.set(kind, executor);
    }
  }

  get(kind: StepKind): StepExecutor | undefined {
    return this.#executors.get(kind);
  }
}

export interface TaskExecutionResult {
  plan: TaskPlan;
  completed: boolean;
  failureReason?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class TaskExecutionService {
  readonly controller: ExecutionController;

  constructor(
    private readonly executors: StepExecutorRegistry,
    private readonly verifier: StepVerifier,
    limits: ExecutionLimits = DEFAULT_EXECUTION_LIMITS
  ) {
    this.controller = new ExecutionController(limits);
  }

  async execute(inputPlan: TaskPlan, signal?: AbortSignal): Promise<TaskExecutionResult> {
    this.controller.validatePlan(inputPlan);
    const registry = new TaskRegistry(inputPlan);
    registry.plan.status = "RUNNING";

    while (!this.controller.allStepsComplete(registry.plan)) {
      if (signal?.aborted) {
        this.cancelPlan(registry.plan);
        return { plan: registry.snapshot(), completed: false, failureReason: "CANCELLED" };
      }

      if (this.controller.hasTerminalFailure(registry.plan)) {
        registry.plan.status = "FAILED";
        return { plan: registry.snapshot(), completed: false, failureReason: "TERMINAL_STEP_FAILURE" };
      }

      const step = this.controller.selectNextReadyStep(registry.plan);
      if (!step) {
        registry.plan.status = "BLOCKED";
        return { plan: registry.snapshot(), completed: false, failureReason: "NO_READY_STEP" };
      }

      const executor = this.executors.get(step.kind);
      if (!executor) {
        registry.updateStep(step.id, { status: "BLOCKED", error: `Липсва StepExecutor за ${step.kind}.` });
        registry.plan.status = "BLOCKED";
        return { plan: registry.snapshot(), completed: false, failureReason: "EXECUTOR_UNAVAILABLE" };
      }

      this.controller.beginStep(step);
      try {
        this.recordBudget(step.kind);
      } catch (error) {
        registry.updateStep(step.id, {
          status: "BLOCKED",
          error: errorMessage(error, "Execution budget exceeded.")
        });
        registry.plan.status = "BLOCKED";
        return { plan: registry.snapshot(), completed: false, failureReason: "BUDGET_EXCEEDED" };
      }

      const context: StepExecutionContext = {
        taskId: registry.plan.taskId,
        originalGoal: registry.plan.originalGoal,
        constraints: [...(registry.plan.constraints ?? [])],
        currentStep: structuredClone(step),
        completedSteps: registry.plan.steps
          .filter((candidate) => candidate.status === "COMPLETE")
          .map((candidate) => structuredClone(candidate)),
        signal,
        recordWebRequest: () => this.controller.recordWebRequest()
      };

      let execution: StepExecutionResult;
      try {
        execution = await executor.execute(context);
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          this.cancelPlan(registry.plan);
          return { plan: registry.snapshot(), completed: false, failureReason: "CANCELLED" };
        }

        if (error instanceof ExecutionBudgetExceededError) {
          registry.updateStep(step.id, { status: "BLOCKED", error: error.message });
          registry.plan.status = "BLOCKED";
          return { plan: registry.snapshot(), completed: false, failureReason: "BUDGET_EXCEEDED" };
        }

        const message = errorMessage(error, "Step execution failed.");
        registry.updateStep(step.id, { status: "NEEDS_REPAIR", error: message });
        this.controller.prepareRetry(step);
        if (step.status === "FAILED") {
          registry.plan.status = "FAILED";
          return { plan: registry.snapshot(), completed: false, failureReason: message };
        }
        continue;
      }

      registry.updateStep(step.id, { resultMetadata: execution.metadata });

      // GENERATION_COMPLETE / executor return is not STEP_COMPLETE.
      let verification: StepVerification;
      try {
        verification = await this.verifier.verify(context, execution);
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          this.cancelPlan(registry.plan);
          return { plan: registry.snapshot(), completed: false, failureReason: "CANCELLED" };
        }

        registry.updateStep(step.id, {
          status: "BLOCKED",
          error: errorMessage(error, "Step verification failed.")
        });
        registry.plan.status = "BLOCKED";
        return { plan: registry.snapshot(), completed: false, failureReason: "VERIFICATION_ERROR" };
      }

      this.controller.applyVerification(step, verification);

      if (verification.status === "COMPLETE") {
        registry.updateStep(step.id, { result: execution.output, error: undefined });
        continue;
      }

      if (verification.status === "NEEDS_REPAIR") {
        this.controller.prepareRetry(step);
        if (step.status === "FAILED") {
          registry.plan.status = "FAILED";
          return { plan: registry.snapshot(), completed: false, failureReason: verification.reason ?? "RETRY_LIMIT" };
        }
        continue;
      }

      if (["FAILED", "BLOCKED", "UNVERIFIED"].includes(verification.status)) {
        registry.plan.status = verification.status === "BLOCKED" ? "BLOCKED" : "FAILED";
        return { plan: registry.snapshot(), completed: false, failureReason: verification.reason ?? verification.status };
      }
    }

    registry.plan.status = "COMPLETE";
    return { plan: registry.snapshot(), completed: true };
  }

  private recordBudget(kind: StepKind): void {
    if (kind === "MODEL") {
      this.controller.recordModelGeneration();
    } else {
      this.controller.recordToolCall(kind);
    }
  }

  private cancelPlan(plan: TaskPlan): void {
    plan.status = "CANCELLED";
    for (const step of plan.steps) {
      if (step.status === "PENDING" || step.status === "RUNNING" || step.status === "NEEDS_REPAIR") {
        step.status = "CANCELLED";
      }
    }
  }
}
