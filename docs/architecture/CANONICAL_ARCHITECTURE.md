# Alpha Chat 2.0 — Canonical Architecture

This document describes the active architecture only.

## Core flow

```text
User request
  -> normalizeRequest
  -> createSingleStepPlan
  -> MODEL
  -> TaskExecutionService
  -> FinalCompletionChecker
  -> TaskFinalizer
  -> publishable answer
```

## Mandatory invariants

1. `ApplicationCore` creates exactly one `MODEL` step for every request.
2. No request Router exists in the active core.
3. No request category such as factual/current/stable/ambiguous/deterministic is assigned.
4. No regex or heuristic capability selector chooses Search, Weather, Time or Calculator.
5. No automatic SIMPLE/COMPLEX analysis or sentence splitting is active.
6. No automatic final-synthesis step is appended.
7. Search/Retrieval/Weather/Time/Calculator modules are not automatically registered by `ApplicationCore`.
8. `ApplicationCore` currently finalizes with `requiresVap: false`.

## Active components

- `apps/web` — user interface.
- `packages/ai-core` — one-step model execution path.
- `packages/task-engine` — task/step state and execution limits.
- `packages/task-execution` — executor loop.
- `packages/task-executors` — contains the model executor plus lower-level executors that are not auto-selected.
- `packages/completion` — final goal coverage check.
- `packages/finalization` — final publication gate.
- `server/ai` — local AI backend.

## Non-active support modules

Search, retrieval, weather, calculator and related verification modules may remain in the repository for direct development/testing. Their presence does not mean the chat core routes requests to them.

## Documentation rule

Historical routing, WebGPU/Qwen and older provider architecture has been archived under the pre-removal snapshot and is not current architecture.
