# Alpha Chat 2.0

**Official name:** Изкуствен интелект – олекотен езиков модел  
**Developed by:** Spas Stankov  
**Status:** internal Alpha development

Alpha Chat 2.0 is a local web application that uses a local Alpha AI backend as a gateway to approved free-only Gemini-compatible models.

## Current runtime

- Web UI: React + TypeScript + Vite.
- AI backend: local HTTP service on `127.0.0.1:5177`.
- Provider policy: `g4f-gemini`, `free_only=true`.
- Primary runtime model is reported dynamically by the backend.
- Conversation history is stored locally.
- FAST / THINKING modes and LOW / MEDIUM / HIGH response depth are supported.

## Current ApplicationCore invariant

Every user request becomes exactly one `MODEL` step.

```text
User request
  -> normalize
  -> one MODEL step
  -> execution verification
  -> completion
  -> finalization
  -> user-visible answer
```

There is no automatic request Router, no SIMPLE/COMPLEX classifier, no regex capability selector, and no automatic choice of Search, Weather, Time or Calculator inside `ApplicationCore`.

The repository still contains lower-level tool, search, retrieval, weather and verification modules. They are libraries/services only; the current `ApplicationCore` does not select or execute them automatically.

## Execution invariants

- `GENERATION_COMPLETE` is not treated as `STEP_COMPLETE`.
- A user-visible answer is published only after execution, completion and finalization pass.
- The immutable Original Goal remains attached to the task plan.
- Hard constraints are preserved by request normalization.
- The active core does not infer a route category from user wording.
- The active core does not make outbound Search/Fetch/Weather calls.
- Current `requiresVap` policy in `ApplicationCore` is `false` because no evidence route is active.

## Local services

The repository contains Search (`5174`) and Fetch (`5175`) services from earlier development. They may be run independently for development/testing, but they are not part of the active automatic chat path.

## Start

```bash
npm install
npm run dev:web
```

AI backend is started separately from `server/ai` on port `5177`.

## Validation

Use:

```bash
npm run typecheck
npm test
npm run build
```

## PWA / GitHub Pages

The web client is PWA-ready. Production builds register `apps/web/public/sw.js`,
use `manifest.webmanifest`, and cache only the same-origin application shell/static assets.
AI/API traffic is not cached by the service worker.

For GitHub Pages project hosting, build with:

```bash
VITE_BASE_PATH=/Alpha-2/ npm run build
```

The Pages workflow reads the public AI backend URL from the repository variable
`VITE_AI_ENDPOINT`. Local development still defaults to `http://127.0.0.1:5177`.
Production intentionally has no localhost fallback; without `VITE_AI_ENDPOINT`,
the UI reports that the hosted AI backend is not configured.

GitHub Pages hosts only the PWA frontend. The Python/Gemini backend must be deployed
separately behind HTTPS and configured to allow the Pages origin via CORS.
