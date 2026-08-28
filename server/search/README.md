# Search backend

Server-side no-key search and weather service for Alpha Chat 2.0.

## Search provider

`POST /api/search` uses `NoKeyWebSearchClient` with public web search pages. No paid search API, subscription token, or provider API key is required.

Current fallback sources are public Yahoo Search, Brave Search web, DuckDuckGo HTML, and Bing Search pages. Individual sources may rate-limit, block automation, or change markup; the client falls through to the next source.

Accepted JSON fields:

```json
{
  "query": "актуални данни за ...",
  "maxResults": 5,
  "freshnessHint": "CURRENT"
}
```

The endpoint rejects conversation history, memory, messages, and arbitrary tool state.

## Signed fetch capability

When `ALPHA_SOURCE_TOKEN_SECRET` is configured, normalized search results receive a short-lived `fetchToken` bound to `sourceId + URL + expiry`. `server/fetch-extract` validates that token before retrieval.

Without the secret, search can still return source candidates, but they cannot authorize content retrieval.

## Weather

`POST /api/weather` uses Open-Meteo and is separate from search.

## Local development

1. Copy `.env.example` to `.env` only if local overrides are needed.
2. No search API key is required.
3. Run `START.bat` or `npm run dev:search`.
4. Search endpoint: `http://127.0.0.1:5174/api/search`.
5. Weather endpoint: `http://127.0.0.1:5174/api/weather`.

`START.bat` can generate a temporary source-token secret shared with the fetch service.