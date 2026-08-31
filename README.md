# Alpha Chat 2.0

**Official name:** Изкуствен интелект – олекотен езиков модел  
**Developed by:** Spas Stankov  
**Status:** internal Alpha development

Alpha Chat 2.0 is a local-first PWA with a lightweight Smol-family runtime and controlled web retrieval.

## Current runtime

- Web UI: React + TypeScript + Vite.
- Browser inference: Transformers.js + WebGPU.
- Primary model: `onnx-community/SmolLM2-360M-Instruct-ONNX` using `q4f16`.
- No production remote AI provider or remote AI API key is required by the current Pages build.
- Conversation history is stored locally.

## Selected model stack

Primary lightweight text model:

- `onnx-community/SmolLM2-360M-Instruct-ONNX`

Optional multimodal workers:

- `HuggingFaceTB/SmolVLM2-2.2B-Instruct`
- `HuggingFaceTB/SmolVLM2-500M-Video-Instruct`
- `HuggingFaceTB/SmolVLM2-256M-Video-Instruct`

The 3B browser runtime was removed because its download and memory requirements were too heavy for reliable client-side loading.

## Web search target

The first web-search backend is SearXNG.

```text
User -> SmolLM2-360M -> Alpha 2 search controller -> search_web -> SearXNG
     -> selected page extraction -> evidence -> answer + sources
```

Search orchestration is handled by Alpha 2 rather than relying on native model tool calling.

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
