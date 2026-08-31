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

interface ModelOutputAudit {
  taskId: string;
  covered: boolean;
  requiresExternalProvenance: boolean;
  reason: string;
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

function urlKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host.toLocaleLowerCase()}${url.pathname.replace(/\/$/u, "") || "/"}`;
  } catch {
    return null;
  }
}

function answerHasGroundedSource(answer: string, sources: readonly string[]): boolean {
  const grounded = new Set(sources.map(urlKey).filter((value): value is string => Boolean(value)));
  if (grounded.size === 0) return false;
  const matches = answer.match(/https?:\/\/[^\s)\]}>"']+/giu) ?? [];
  return matches.some((value) => {
    const key = urlKey(value.replace(/[.,;]+$/u, ""));
    return key !== null && grounded.has(key);
  });
}

class ModelOutputAuditGoalCoverageAdapter implements GoalCoverageAdapter {
  readonly id = "model-output-audit-v1";
  readonly #audits = new Map<string, ModelOutputAudit>();

  constructor(private readonly model: ModelAdapter) {}

  getAudit(taskId: string): ModelOutputAudit | undefined {
    return this.#audits.get(taskId);
  }

  async evaluate(context: GoalCoverageContext, signal?: AbortSignal): Promise<GoalCoverageEvaluation> {
    const answerStep = [...context.completedSteps].reverse().find(
      (step) => step.kind === "MODEL" && step.status === "COMPLETE" && typeof step.result === "string"
    );
    const answer = typeof answerStep?.result === "string" ? answerStep.result.trim() : "";
    if (!answer) {
      return { status: "NOT_COVERED", reason: "MODEL answer липсва." };
    }

    const sources = Array.isArray(answerStep?.resultMetadata?.providerSources)
      ? answerStep.resultMetadata.providerSources.filter((value): value is string => typeof value === "string")
      : [];
    const auditPrompt = JSON.stringify({
      originalGoal: context.originalGoal,
      constraints: context.constraints ?? [],
      answer,
      providerSources: sources
    });
    let raw = "";
    for await (const token of this.model.generate({
      systemPrompt: [
        "You are a strict output auditor. Judge only the supplied goal, constraints, answer, and providerSources.",
        "Do not answer the user's task and do not use outside knowledge.",
        "Return exactly one JSON object with booleans covered, requiresExternalProvenance and string reason.",
        "covered=true only when every explicit requested item is actually answered; refusal, deferral, or saying data is unavailable for a requested item means covered=false.",
        "requiresExternalProvenance=true when the answer asserts concrete time-sensitive external facts such as weather, prices, FX, latest/current news, changing office-holders or live status.",
        "Current date or local clock time alone does not require external provenance because Alpha provides trusted runtime time.",
        "Stable facts, arithmetic, translation, explanation and reasoning do not require external provenance."
      ].join("\n"),
      userPrompt: auditPrompt,
      maxTokens: 160,
      thinking: false,
      temperature: 0,
      responseJsonSchema: {
        type: "object",
        properties: {
          covered: { type: "boolean" },
          requiresExternalProvenance: { type: "boolean" },
          reason: { type: "string" }
        },
        required: ["covered", "requiresExternalProvenance", "reason"],
        additionalProperties: false
      },
      signal
    })) raw += token;

    const jsonText = raw.trim();
    if (!jsonText) return { status: "UNKNOWN", reason: "Output audit не върна JSON verdict." };
    try {
      const parsed = JSON.parse(jsonText) as Partial<Omit<ModelOutputAudit, "taskId">>;
      if (typeof parsed.covered !== "boolean"
        || typeof parsed.requiresExternalProvenance !== "boolean") {
        return { status: "UNKNOWN", reason: "Output audit върна невалидна структура." };
      }
      const audit: ModelOutputAudit = {
        taskId: context.taskId,
        covered: parsed.covered,
        requiresExternalProvenance: parsed.requiresExternalProvenance,
        reason: typeof parsed.reason === "string" ? parsed.reason : ""
      };
      this.#audits.set(context.taskId, audit);
      return audit.covered
        ? { status: "COVERED", score: 1 }
        : { status: "NOT_COVERED", reason: audit.reason || "Отговорът не покрива целия Original Goal." };
    } catch {
      return { status: "UNKNOWN", reason: "Output audit JSON не може да бъде прочетен." };
    }
  }
}

export class ApplicationCore {
  readonly state = new ApplicationStateManager();
  lastTaskPlan: TaskPlan | null = null;

  readonly #goalCoverage: GoalCoverageAdapter;
  readonly #outputAudit?: ModelOutputAuditGoalCoverageAdapter;

  constructor(
    private readonly model: ModelAdapter,
    options: ApplicationCoreOptions = {}
  ) {
    if (options.goalCoverageAdapter) {
      this.#goalCoverage = options.goalCoverageAdapter;
    } else {
      this.#outputAudit = new ModelOutputAuditGoalCoverageAdapter(model);
      this.#goalCoverage = this.#outputAudit;
    }
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
        // User-visible answer tokens stay buffered until completion/audit/finalization pass.
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
      const audit = this.#outputAudit?.getAudit(execution.plan.taskId);
      if (audit?.requiresExternalProvenance && !answerHasGroundedSource(answer, sources)) {
        this.state.set({ phase: "READY" });
        return {
          answer: "",
          thinking: "",
          taskPlan: execution.plan,
          publishable: false,
          finalizationStatus: "BLOCKED",
          providerSources: sources,
          failureReason: "CURRENT_FACT_WITHOUT_GROUNDED_SOURCE"
        };
      }

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
