# Alpha Chat 2.0

**Official name:** Изкуствен интелект – олекотен езиков модел  
**Developed by:** Spas Stankov  
**Status:** internal Alpha development

Alpha Chat 2.0 is a browser-first PWA with no production backend.

## Current runtime

- Web UI: React + TypeScript + Vite.
- AI runtime target: local browser inference.
- No remote AI provider is configured in the current build.
- No API key is required by the current build.
- Conversation history is stored locally.

## Current model state

The previous remote model integration has been removed. `packages/models` now contains only the generic model contracts and an unconfigured placeholder adapter. A local browser model can be integrated next without reintroducing a backend.

## Local development

```bash
npm install
npm run dev:web
```

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## PWA / GitHub Pages

Production deployment is static:

```text
GitHub Pages -> Alpha 2 PWA -> local browser runtime
```

There is no production Python/HTTP AI backend and no remote AI credential in the Pages build.
