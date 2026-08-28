import { createRequestId } from "@alpha/shared";

export type TaskStatus = "PLANNED" | "RUNNING" | "COMPLETE" | "FAILED" | "BLOCKED" | "CANCELLED";
export type StepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETE"
  | "FAILED"
  | "BLOCKED"
  | "NEEDS_REPAIR"
  | "UNVERIFIED"
  | "CANCELLED";

export type StepKind = "MODEL" | "WEB_SEARCH" | "RETRIEVAL" | "CALCULATOR" | "WEATHER" | "TIME" | "MEMORY" | "TOOL";

export interface NormalizedRequest {
  requestId: string;
  originalText: string;
  normalizedGoal: string;
  constraints: string[];
}

export interface TaskStep {
  id: string;
  kind: StepKind;
  goal: string;
  dependsOn: string[];
  status: StepStatus;
  retryCount: number;
  result?: unknown;
  resultMetadata?: Record<string, unknown>;
  verificationMetadata?: Record<string, unknown>;
  error?: string;
}

export interface TaskPlan {
  taskId: string;
  originalGoal: string;
  /** Explicit user constraints extracted deterministically from the request. */
  constraints?: string[];
  status: TaskStatus;
  steps: TaskStep[];
  createdAtUtc: string;
}

export interface ExecutionLimits {
  maxSteps: number;
  maxRetriesPerStep: number;
  maxModelGenerations: number;
  maxToolCalls: number;
  maxWebRequests: number;
}

export interface ExecutionCounters {
  modelGenerations: number;
  toolCalls: number;
  webRequests: number;
}

export interface StepVerification {
  status: "COMPLETE" | "NEEDS_REPAIR" | "FAILED" | "BLOCKED" | "UNVERIFIED";
  reason?: string;
  metadata?: Record<string, unknown>;
}

export class ExecutionBudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "ExecutionBudgetExceededError";
  }
}

// Deliberately narrow: extract only explicit, high-confidence user constraints.
// The full immutable Original Goal is still preserved independently, so an
// unrecognized constraint is never deleted from the request.
const HARD_CONSTRAINT_MARKERS = [
  /^(?:задължително|само)(?!\s+ли(?:\s|$))(?:\s|$)/iu,
  /^без\s+/iu,
  /^(?:максимум|минимум|поне)\s+\d+(?:\s|$)/iu,
  /^до\s+\d+(?:\s|$)/iu,
  /^(?:не използвай|не добавяй|не променяй|не премахвай|не включвай|не повече от|не по-малко от)(?:\s|$)/iu,
  /^(?:отговори|пиши|напиши|използвай|включи|направи|ограничи)(?:\s|$).*?(?:само|без|максимум|минимум|поне|до\s+\d+)/iu,
  /^(?:отговорът|резултатът|текстът|изходът)(?:\s|$).*?трябва\s+да(?:\s|$)/iu,
  /^(?:only|without|maximum|minimum|at least|at most|no more than|no less than)\b/iu,
  /^(?:do not|don't)\s+(?:use|add|change|remove|include)\b/iu,
  /^(?:answer|write|use|include|keep)\b.*\b(?:only|without|at most|at least|maximum|minimum)\b/iu,
  /^(?:you\s+must|the\s+(?:answer|response|result|output)\s+must)\b/iu
];

const STANDALONE_CONSTRAINT_MARKERS = [
  /^(?:задължително|само)(?!\s+ли(?:\s|$))(?:\s|$)/iu,
  /^без\s+/iu,
  /^(?:максимум|минимум|поне)\s+\d+(?:\s|$)/iu,
  /^до\s+\d+(?:\s|$)/iu,
  /^(?:не използвай|не добавяй|не променяй|не премахвай|не включвай|не повече от|не по-малко от)(?:\s|$)/iu,
  /^(?:отговори|пиши|използвай|включи|ограничи)(?:\s|$).*?(?:само|без|максимум|минимум|поне|до\s+\d+)/iu,
  /^(?:отговорът|резултатът|текстът|изходът)(?:\s|$).*?трябва\s+да(?:\s|$)/iu,
  /^(?:only|without|maximum|minimum|at least|at most|no more than|no less than)\b/iu,
  /^(?:do not|don't)\s+(?:use|add|change|remove|include)\b/iu,
  /^(?:answer|use|include|keep)\b.*\b(?:only|without|at most|at least|maximum|minimum)\b/iu,
  /^(?:you\s+must|the\s+(?:answer|response|result|output)\s+must)\b/iu
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function extractHardConstraints(text: string): string[] {
  const candidates = text
    .split(/\n+|(?<=[.!?;])\s+/u)
    .map((part) => part.replace(/^\s*(?:\d+[.)]|[-*])\s*/u, "").trim())
    .filter((part) => part.length >= 3 && matchesAny(part, HARD_CONSTRAINT_MARKERS));

  const seen = new Set<string>();
  const constraints: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    constraints.push(candidate);
  }
  return constraints;
}

export function isStandaloneHardConstraint(text: string): boolean {
  return matchesAny(text.trim(), STANDALONE_CONSTRAINT_MARKERS);
}

export function normalizeRequest(text: string): NormalizedRequest {
  const normalizedGoal = text.trim().replace(/\s+/g, " ");
  return {
    requestId: createRequestId(),
    originalText: text,
    normalizedGoal,
    constraints: extractHardConstraints(text)
  };
}

function createStep(id: string, kind: StepKind, goal: string, dependsOn: string[] = []): TaskStep {
  return {
    id,
    kind,
    goal,
    dependsOn,
    status: "PENDING",
    retryCount: 0
  };
}

function createPlan(request: NormalizedRequest, steps: TaskStep[]): TaskPlan {
  return {
    taskId: request.requestId,
    originalGoal: request.normalizedGoal,
    constraints: [...request.constraints],
    status: "PLANNED",
    createdAtUtc: new Date().toISOString(),
    steps
  };
}

function primaryExecutableGoal(request: NormalizedRequest): string {
  let executable = request.originalText;

  for (const constraint of request.constraints) {
    if (!isStandaloneHardConstraint(constraint)) continue;
    const index = executable.indexOf(constraint);
    if (index < 0) continue;
    executable = `${executable.slice(0, index)} ${executable.slice(index + constraint.length)}`;
  }

  const cleaned = executable
    .replace(/\s+/gu, " ")
    .replace(/\s+([.!?;])/gu, "$1")
    .replace(/(?:[.;]\s*){2,}/gu, ". ")
    .replace(/^[\s.;,]+|[\s;,]+$/gu, "")
    .trim();

  return cleaned || request.normalizedGoal;
}

export function createSingleStepPlan(request: NormalizedRequest): TaskPlan {
  return createPlan(request, [createStep("S1", "MODEL", primaryExecutableGoal(request))]);
}

export class TaskRegistry {
  readonly plan: TaskPlan;

  constructor(plan: TaskPlan) {
    this.plan = structuredClone(plan);
  }

  getStep(stepId: string): TaskStep | undefined {
    return this.plan.steps.find((step) => step.id === stepId);
  }

  updateStep(stepId: string, patch: Partial<TaskStep>): TaskStep {
    const step = this.getStep(stepId);
    if (!step) throw new Error(`Непозната стъпка: ${stepId}`);
    Object.assign(step, patch);
    return step;
  }

  snapshot(): TaskPlan {
    return structuredClone(this.plan);
  }
}

export class ExecutionController {
  readonly counters: ExecutionCounters = { modelGenerations: 0, toolCalls: 0, webRequests: 0 };

  constructor(readonly limits: ExecutionLimits) {}

  validatePlan(plan: TaskPlan): void {
    if (plan.steps.length === 0) throw new Error("Task plan няма стъпки.");
    if (plan.steps.length > this.limits.maxSteps) throw new Error("Task plan надвишава maxSteps.");

    const ids = new Set(plan.steps.map((step) => step.id));
    if (ids.size !== plan.steps.length) throw new Error("Task plan съдържа дублирани step id.");

    for (const step of plan.steps) {
      for (const dependency of step.dependsOn) {
        if (!ids.has(dependency)) throw new Error(`Липсва dependency ${dependency} за ${step.id}.`);
        if (dependency === step.id) throw new Error(`Стъпка ${step.id} не може да зависи от себе си.`);
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error("Task plan съдържа циклична dependency.");
      if (visited.has(id)) return;
      visiting.add(id);
      const step = plan.steps.find((candidate) => candidate.id === id)!;
      for (const dependency of step.dependsOn) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of ids) visit(id);
  }

  selectNextReadyStep(plan: TaskPlan): TaskStep | undefined {
    return plan.steps.find((step) => {
      if (step.status !== "PENDING" && step.status !== "NEEDS_REPAIR") return false;
      return step.dependsOn.every((id) => plan.steps.find((candidate) => candidate.id === id)?.status === "COMPLETE");
    });
  }

  beginStep(step: TaskStep): void {
    if (step.status !== "PENDING" && step.status !== "NEEDS_REPAIR") {
      throw new Error(`Стъпка ${step.id} не е готова за изпълнение.`);
    }
    step.status = "RUNNING";
  }

  applyVerification(step: TaskStep, verification: StepVerification): void {
    step.status = verification.status;
    step.error = verification.reason;
    step.verificationMetadata = verification.metadata;
  }

  canRetry(step: TaskStep): boolean {
    return step.retryCount < this.limits.maxRetriesPerStep;
  }

  prepareRetry(step: TaskStep): void {
    if (!this.canRetry(step)) {
      step.status = "FAILED";
      return;
    }
    step.retryCount += 1;
    step.status = "NEEDS_REPAIR";
  }

  recordModelGeneration(): void {
    if (this.counters.modelGenerations >= this.limits.maxModelGenerations) {
      throw new ExecutionBudgetExceededError("Надвишен е maxModelGenerations budget.");
    }
    this.counters.modelGenerations += 1;
  }

  recordToolCall(_kind: StepKind): void {
    if (this.counters.toolCalls >= this.limits.maxToolCalls) {
      throw new ExecutionBudgetExceededError("Надвишен е maxToolCalls budget.");
    }
    this.counters.toolCalls += 1;
  }

  recordWebRequest(): void {
    if (this.counters.webRequests >= this.limits.maxWebRequests) {
      throw new ExecutionBudgetExceededError("Надвишен е maxWebRequests budget.");
    }
    this.counters.webRequests += 1;
  }

  allStepsComplete(plan: TaskPlan): boolean {
    return plan.steps.every((step) => step.status === "COMPLETE");
  }

  hasTerminalFailure(plan: TaskPlan): boolean {
    return plan.steps.some((step) => ["FAILED", "BLOCKED", "CANCELLED"].includes(step.status));
  }
}

export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = Object.freeze({
  maxSteps: 12,
  maxRetriesPerStep: 2,
  maxModelGenerations: 16,
  maxToolCalls: 20,
  maxWebRequests: 8
});
