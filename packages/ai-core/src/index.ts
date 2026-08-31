import {
  FinalCompletionChecker,
  type GoalCoverageAdapter,
  type GoalCoverageContext,
  type GoalCoverageEvaluation
} from "@alpha/completion";
import { AlphaStepContextAssembler } from "@alpha/context";
import {
  TaskFinalizer,
  type TaskFinalizationReport,
  type TaskFinalizationStatus
} from "@alpha/finalization";
import type { ModelAdapter } from "@alpha/models";
import type { ChatMode, ResponseDepth } from "@alpha/reasoning";
import { ApplicationStateManager } from "@alpha/state";
import {
  DEFAULT_EXECUTION_LIMITS,
  ExecutionController,
  createSingleStepPlan,
  normalizeRequest,
  type TaskPlan,
  type TaskStep
} from "@alpha/task-engine";
import { StepExecutorRegistry, TaskExecutionService } from "@alpha/task-execution";
import { ModelStepExecutor } from "@alpha/task-executors";
import { FailClosedStepVerifier } from "@alpha/task-verification";

export type { ChatMode, ResponseDepth } from "@alpha/reasoning";
export type { TaskPlan } from "@alpha/task-engine";

export interface ApplicationCoreOptions {
  goalCoverageAdapter?: GoalCoverageAdapter;
}

export interface GenerateRequest {
  text: string;
  mode: ChatMode;
  depth: ResponseDepth;
  signal?: AbortSignal;
  onAnswerToken?: (token: string) => void;
  onThinkingToken?: (token: string) => void;
}

export interface GenerateResult {
  answer: string;
  thinking: string;
  taskPlan: TaskPlan;
  publishable: boolean;
  finalizationStatus?: TaskFinalizationStatus;
  citations?: TaskFinalizationReport["citations"];
  providerSources?: string[];
  failureReason?: string;
}

function isUserFacingStep(step: TaskStep): boolean {
  return step.kind === "MODEL";
}

function renderFinalAnswer(plan: TaskPlan): string {
  const step = [...plan.steps].reverse().find(isUserFacingStep);
  if (!step) return "";
  if (typeof step.result === "string") return step.result.trim();
  if (step.result && typeof step.result === "object") {
    const candidate = step.result as { formatted?: unknown };
    if (typeof candidate.formatted === "string" && candidate.formatted.trim()) return candidate.formatted.trim();
    try {
      return JSON.stringify(step.result);
    } catch {
      return "";
    }
  }
  return step.result === undefined || step.result === null ? "" : String(step.result);
}

function sanitizeModelOutput(value: string): string {
  return value.replace(/<FollowUp\b[^>]*\/>/giu, "").trim();
}

function providerSources(plan: TaskPlan): string[] {
  const values: string[] = [];
  for (const step of plan.steps) {
    const candidates = step.resultMetadata?.providerSources;
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim() && !values.includes(candidate.trim())) {
        values.push(candidate.trim());
      }
    }
  }
  return values.slice(0, 12);
}

class LocalOutputGoalCoverageAdapter implements GoalCoverageAdapter {
  readonly id = "local-output-presence-v1";

  async evaluate(context: GoalCoverageContext): Promise<GoalCoverageEvaluation> {
    const answerStep = [...context.completedSteps].reverse().find(
      (step) => step.kind === "MODEL" && step.status === "COMPLETE" && typeof step.result === "string"
    );
    const answer = typeof answerStep?.result === "string" ? answerStep.result.trim() : "";
    return answer
      ? { status: "COVERED", score: 1 }
      : { status: "NOT_COVERED", reason: "MODEL answer липсва." };
  }
}

export class ApplicationCore {
  readonly state = new ApplicationStateManager();
  lastTaskPlan: TaskPlan | null = null;

  readonly #goalCoverage: GoalCoverageAdapter;

  constructor(
    private readonly model: ModelAdapter,
    options: ApplicationCoreOptions = {}
  ) {
    this.#goalCoverage = options.goalCoverageAdapter ?? new LocalOutputGoalCoverageAdapter();
    this.state.set({ phase: "READY" });
  }

  get modelLoaded(): boolean {
    return this.model.loaded;
  }

  async loadModel(onProgress?: (progress: number, text: string) => void): Promise<void> {
    await this.model.load(onProgress);
  }

  analyzeTask(text: string): TaskPlan {
    const normalized = normalizeRequest(text);
    const plan = createSingleStepPlan(normalized);

    new ExecutionController(DEFAULT_EXECUTION_LIMITS).validatePlan(plan);
    this.lastTaskPlan = plan;
    return plan;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const plan = this.analyzeTask(request.text);
    this.state.set({ phase: "GENERATING", activeRequestId: plan.taskId });

    const streamModelStepId = [...plan.steps].reverse().find((step) => step.kind === "MODEL")?.id;
    let finalThinking = "";

    try {
      const contextAssembler = new AlphaStepContextAssembler({
        mode: request.mode,
        depth: request.depth,
        maxContextTokens: this.model.capabilities.maxContext
      });

      const executors = new StepExecutorRegistry();
      executors.register(new ModelStepExecutor(this.model, contextAssembler, {
        onThinkingToken: (context, token) => {
          if (context.currentStep.id !== streamModelStepId) return;
          finalThinking += token;
          request.onThinkingToken?.(token);
        }
      }));

      const stepVerifier = new FailClosedStepVerifier(undefined, true);
      const executionService = new TaskExecutionService(executors, stepVerifier);
      const execution = await executionService.execute(plan, request.signal);
      this.lastTaskPlan = execution.plan;

      if (!execution.completed) {
        this.state.set({ phase: "READY" });
        return {
          answer: "",
          thinking: "",
          taskPlan: execution.plan,
          publishable: false,
          failureReason: execution.failureReason ?? "TASK_EXECUTION_BLOCKED"
        };
      }

      for (const step of execution.plan.steps) {
        if (step.kind === "MODEL" && typeof step.result === "string") {
          step.result = sanitizeModelOutput(step.result);
        }
      }

      const completionChecker = new FinalCompletionChecker(this.#goalCoverage);
      const finalizer = new TaskFinalizer(completionChecker);
      const finalization = await finalizer.finalize(
        execution.plan,
        { requiresVap: false },
        new Date().toISOString(),
        request.signal
      );

      if (!finalization.publishable) {
        this.state.set({ phase: "READY" });
        return {
          answer: "",
          thinking: "",
          taskPlan: execution.plan,
          publishable: false,
          finalizationStatus: finalization.status,
          failureReason: finalization.reason ?? "FINALIZATION_BLOCKED"
        };
      }

      const answer = renderFinalAnswer(execution.plan);
      if (!answer) {
        this.state.set({ phase: "READY" });
        return {
          answer: "",
          thinking: "",
          taskPlan: execution.plan,
          publishable: false,
          finalizationStatus: "BLOCKED",
          failureReason: "FINAL_ANSWER_EMPTY"
        };
      }

      const sources = providerSources(execution.plan);
      request.onAnswerToken?.(answer);
      this.state.set({ phase: "READY" });
      return {
        answer,
        thinking: finalThinking,
        taskPlan: execution.plan,
        publishable: true,
        finalizationStatus: finalization.status,
        citations: finalization.citations,
        providerSources: sources
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестна execution грешка.";
      this.state.set({ phase: request.signal?.aborted ? "READY" : "ERROR", lastError: request.signal?.aborted ? undefined : message });
      throw error;
    }
  }
}
