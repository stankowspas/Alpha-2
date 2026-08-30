from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import __version__
from .policy import FreeModelPolicy
from .provider import FreeAIProvider
from .schemas import ChatRequest, HealthResponse, ModelDescriptor, ModelAvailability
from .service import GenerationService
from .sse import encode_sse

DEFAULT_FREE_MODELS = (
    "gemini-3.6-flash",
    "gemini-3.5-flash",
)
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://127.0.0.10:5173",
)
MAX_REQUEST_BYTES = 400_000


class UnconfiguredProvider:
    provider_id = "unconfigured"

    async def health(self) -> bool:
        return False

    async def probe_model(self, model_id: str) -> ModelAvailability:
        return ModelAvailability.UNKNOWN

    async def stream(self, **kwargs):
        if False:
            yield ""
        raise RuntimeError("Provider is not configured")

    async def cancel(self, request_id: str) -> None:
        return None


def resolve_provider() -> FreeAIProvider:
    default_mode = "gemini-api" if os.getenv("GEMINI_API_KEY", "").strip() else "unconfigured"
    mode = os.getenv("ALPHA_AI_PROVIDER", default_mode).strip().lower()
    if mode in {"", "unconfigured"}:
        return UnconfiguredProvider()
    if mode == "gemini-api":
        from .gemini_api import GeminiApiProvider
        return GeminiApiProvider()
    raise RuntimeError(f"Unsupported ALPHA_AI_PROVIDER: {mode}")


def allowed_origins() -> tuple[str, ...]:
    raw = os.getenv("ALPHA_ALLOWED_ORIGINS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def create_app(provider: FreeAIProvider | None = None) -> FastAPI:
    provider = provider or resolve_provider()
    policy = FreeModelPolicy(DEFAULT_FREE_MODELS)
    generation = GenerationService(provider, policy)

    app = FastAPI(title="Alpha 2 Free AI Backend", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins()),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def request_size_limit(request: Request, call_next):
        value = request.headers.get("content-length")
        if value:
            try:
                size = int(value)
            except ValueError:
                return JSONResponse(status_code=400, content={"code": "INVALID_CONTENT_LENGTH"})
            if size > MAX_REQUEST_BYTES:
                return JSONResponse(status_code=413, content={"code": "REQUEST_TOO_LARGE"})
        return await call_next(request)

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        available = await provider.health()
        return HealthResponse(
            status="ok" if available else "degraded",
            backend_version=__version__,
            provider=provider.provider_id,
            provider_available=available,
        )

    @app.get("/ready")
    async def ready() -> dict:
        if not await provider.health():
            raise HTTPException(status_code=503, detail="AI provider is not configured")
        return {"status": "ok", "provider": provider.provider_id}

    @app.get("/v1/models", response_model=list[ModelDescriptor])
    async def models() -> list[ModelDescriptor]:
        result = []
        for model_id in policy.allowed_models:
            availability = await provider.probe_model(model_id)
            result.append(
                ModelDescriptor(
                    model_id=model_id,
                    free_allowed=True,
                    availability=availability,
                    provider=provider.provider_id,
                )
            )
        return result

    @app.post("/v1/chat/stream")
    async def chat_stream(request: ChatRequest) -> StreamingResponse:
        async def body():
            async for event in generation.events(request):
                yield encode_sse(event)

        return StreamingResponse(
            body(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/v1/cancel/{request_id}")
    async def cancel(request_id: str) -> dict:
        if not request_id:
            raise HTTPException(status_code=400, detail="request_id is required")
        await generation.cancel(request_id)
        return {"requestId": request_id, "cancelRequested": True}

    return app


app = create_app()
