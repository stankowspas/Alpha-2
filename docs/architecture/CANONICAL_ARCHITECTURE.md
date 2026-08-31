# Alpha Chat 2.0 — Canonical Architecture

This document describes the active architecture only.

## Core flow

```text
User
  -> Alpha 2 PWA
  -> local browser model adapter
  -> local inference
  -> user-visible answer
```

## Mandatory invariants

1. Production is static and runs from GitHub Pages.
2. No production AI HTTP/Python backend is part of the architecture.
3. No remote AI provider is configured in the current build.
4. No API key is required in the current build.
5. The model runtime must execute in the user's browser.
6. `packages/models` exposes provider-neutral model contracts.

## Active components

- `apps/web` — user interface and PWA shell.
- `packages/models` — provider-neutral model contracts and temporary unconfigured adapter.
- Browser storage — local conversation history.

## Current model state

No model is installed in the current build. The next model integration must remain browser-only and must not reintroduce a production backend or remote AI credential.
