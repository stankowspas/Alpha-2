# Alpha 2 Free AI Backend

This service provides the public inference transport for Alpha 2.

## Production provider

Alpha 2 uses the official Gemini Developer API over HTTPS. No Gemini API key is exposed to the browser.

Required server-side environment variables:

```text
ALPHA_AI_PROVIDER=gemini-api
GEMINI_API_KEY=<server-side secret>
ALPHA_ALLOWED_ORIGINS=https://stankowspas.github.io
```

Optional timeout settings:

```text
ALPHA_AI_FIRST_TOKEN_TIMEOUT=60
ALPHA_AI_IDLE_TIMEOUT=20
```

The free-model allowlist is currently:

- `gemini-3.6-flash`
- `gemini-3.5-flash`

## Local tests

```powershell
python -m pip install -e ".[test]"
python -m pytest -q
python -m compileall -q alpha_ai
```

## Development server

Set `GEMINI_API_KEY`, then run:

```powershell
$env:ALPHA_AI_PROVIDER="gemini-api"
python -m uvicorn alpha_ai.app:app --host 127.0.0.1 --port 5177
```

Endpoints:

- `GET /health` — provider status for the frontend
- `GET /ready` — deployment readiness; returns 503 when the provider is not configured
- `GET /v1/models` — free-model allowlist and availability
- `POST /v1/chat/stream` — SSE generation stream
- `POST /v1/cancel/{request_id}` — cancellation
