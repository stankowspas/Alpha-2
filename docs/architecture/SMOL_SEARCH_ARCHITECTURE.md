# Alpha 2 — Smol Search Architecture

## Goal

Alpha 2 is prepared around a small, local-first Hugging Face model stack with web retrieval.

## Selected models

### Primary text model

- `HuggingFaceTB/SmolLM3-3B`
- Purpose: chat, reasoning, query planning and tool calling.
- Reasoning modes: `think` / `no_think`.
- Tool calling: supported by the model chat template.
- Long-context target: up to 128k tokens when the runtime supports the required configuration.

### Optional multimodal models

- `HuggingFaceTB/SmolVLM2-2.2B-Instruct`
- `HuggingFaceTB/SmolVLM2-500M-Video-Instruct`
- `HuggingFaceTB/SmolVLM2-256M-Video-Instruct`

These are optional workers for image/video understanding. They are not required for the first web-search milestone.

## Retrieval

The first search provider is SearXNG.

Flow:

```text
User
  -> Alpha 2 UI
  -> SmolLM3-3B
  -> tool request: search_web(query)
  -> SearXNG provider
  -> normalized SearchResult[]
  -> optional page fetch/extraction
  -> evidence documents
  -> SmolLM3-3B synthesis
  -> answer + provenance/citations
```

## Separation of responsibilities

### Model layer

`@alpha/models`

- owns generic model contracts;
- exposes the selected Smol catalog;
- does not own network search.

### Retrieval layer

`@alpha/retrieval`

- owns search result and evidence contracts;
- exposes a SearXNG JSON API adapter;
- keeps web content marked as untrusted evidence;
- does not let search snippets become model facts automatically.

### Runtime/orchestration layer

To be implemented next.

Responsibilities:

1. load SmolLM3-3B in the chosen local runtime;
2. expose `search_web` to the model as a tool;
3. execute tool calls safely;
4. optionally fetch selected result pages;
5. return tool results to the model;
6. attach source provenance to the final answer.

## SearXNG configuration requirement

The SearXNG instance must enable JSON search responses (`format=json`).

For a browser-hosted Alpha 2 UI, either:

- SearXNG must allow the Alpha 2 origin through CORS; or
- Alpha 2 must use a same-origin/local proxy.

The repository does not assume that public SearXNG instances are stable or suitable for production use. A controlled/self-hosted instance is the target.

## Cleanup state

No previous concrete remote LLM is part of the current model package. The generic `ModelAdapter` and `UnconfiguredModelAdapter` remain intentionally because they are architecture contracts, not legacy models.

The selected concrete model list for the new architecture lives only in `packages/models/src/smol.ts`.

## Implementation milestones

1. Smol model catalog — prepared.
2. SearXNG search adapter — prepared.
3. Local SmolLM3 runtime adapter — next.
4. Tool-call execution loop (`search_web`) — next.
5. Page fetch/extract integration — next.
6. UI search/source rendering — next.
7. Optional SmolVLM2 routing for images/video — later.
