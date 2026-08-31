# Alpha Chat 2.0

**Official name:** Изкуствен интелект – олекотен езиков модел  
**Developed by:** Spas Stankov  
**Status:** internal Alpha development

Alpha Chat 2.0 is a local-first PWA being prepared for a Smol-family runtime and controlled web retrieval.

## Current runtime

- Web UI: React + TypeScript + Vite.
- No production remote AI provider is configured.
- No remote AI API key is required by the current Pages build.
- Conversation history is stored locally.
- Concrete legacy remote models are not part of the current model package.

## Selected model stack

Primary text/reasoning model:

- `HuggingFaceTB/SmolLM3-3B`

Optional multimodal workers:

- `HuggingFaceTB/SmolVLM2-2.2B-Instruct`
- `HuggingFaceTB/SmolVLM2-500M-Video-Instruct`
- `HuggingFaceTB/SmolVLM2-256M-Video-Instruct`

The repository now contains the selected catalog, but the actual local inference runtime is not wired into the Pages UI yet.

## Web search target

The first web-search backend is SearXNG.

```text
User -> SmolLM3-3B -> search_web -> SearXNG -> results
     -> selected page extraction -> evidence -> answer + sources
```

`@alpha/retrieval/searxng` contains the SearXNG JSON API provider. A controlled/self-hosted SearXNG instance is the intended deployment target.

See `docs/architecture/SMOL_SEARCH_ARCHITECTURE.md` for the implementation plan and separation of responsibilities.

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

The current GitHub Pages deployment remains static. The Smol runtime/tool execution layer is the next implementation milestone; the UI must not claim that the model or web search is active until those components are actually connected.
