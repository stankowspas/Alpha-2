from __future__ import annotations
import asyncio
from collections.abc import AsyncIterator
from .policy import FreeModelPolicy
from .provider import FreeAIProvider, ModelUnavailableError, ModelEmptyResponseError, ProviderError
from .schemas import ChatRequest, ModelAvailability, StreamEvent

class GenerationService:
    def __init__(self, provider: FreeAIProvider, policy: FreeModelPolicy) -> None:
        self.provider = provider
        self.policy = policy
        self._active: set[str] = set()

    async def cancel(self, request_id: str) -> None:
        if request_id in self._active:
            await self.provider.cancel(request_id)

    async def events(self, request: ChatRequest) -> AsyncIterator[StreamEvent]:
        candidates = self.policy.ordered_candidates(request.requested_model)
        if not candidates:
            yield StreamEvent(
                event="error",
                request_id=request.request_id,
                data={
                    "code": "FREE_POLICY_VIOLATION",
                    "message": "Requested model is not on the free allowlist.",
                },
            )
            return

        self._active.add(request.request_id)
        last_failure_code = ModelUnavailableError.code
        last_failure_detail: str | None = None
        fallback_reason: str | None = None

        try:
            yield StreamEvent(
                event="start",
                request_id=request.request_id,
                data={"freeOnly": True},
            )

            for model_id in candidates:
                availability = await self.provider.probe_model(model_id)
                if availability is not ModelAvailability.AVAILABLE:
                    last_failure_code = ModelUnavailableError.code
                    last_failure_detail = f"{model_id}:{availability.value}"
                    if model_id == request.requested_model:
                        fallback_reason = "requested_model_unavailable"
                    continue

                fallback_used = model_id != request.requested_model
                yield StreamEvent(
                    event="model_selected",
                    request_id=request.request_id,
                    data={
                        "requestedModel": request.requested_model,
                        "actualModel": model_id,
                        "fallbackUsed": fallback_used,
                        "fallbackReason": fallback_reason if fallback_used else None,
                    },
                )

                emitted = False
                try:
                    async for token in self.provider.stream(
                        request_id=request.request_id,
                        model_id=model_id,
                        system_prompt=request.system_prompt,
                        user_prompt=request.user_prompt,
                        max_tokens=request.max_tokens,
                        temperature=request.temperature,
                    ):
                        if token:
                            emitted = True
                            yield StreamEvent(
                                event="token",
                                request_id=request.request_id,
                                data={"text": token},
                            )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    last_failure_code = ProviderError.code
                    last_failure_detail = f"{model_id}:{type(exc).__name__}"
                    if model_id == request.requested_model:
                        fallback_reason = "requested_model_provider_error"
                    continue

                if not emitted:
                    last_failure_code = ModelEmptyResponseError.code
                    last_failure_detail = f"{model_id}:empty"
                    if model_id == request.requested_model:
                        fallback_reason = "requested_model_empty_response"
                    continue

                provider_metadata = {}
                take_metadata = getattr(self.provider, "take_generation_metadata", None)
                if callable(take_metadata):
                    provider_metadata = take_metadata(request.request_id) or {}
                yield StreamEvent(
                    event="metadata",
                    request_id=request.request_id,
                    data={
                        "provider": self.provider.provider_id,
                        "generationComplete": True,
                        **provider_metadata,
                    },
                )
                yield StreamEvent(
                    event="done",
                    request_id=request.request_id,
                    data={"actualModel": model_id},
                )
                return

            messages = {
                ModelUnavailableError.code: "No allowed free model is currently available.",
                ModelEmptyResponseError.code: "Allowed free models returned empty responses.",
                ProviderError.code: "The free AI provider failed during generation.",
            }
            yield StreamEvent(
                event="error",
                request_id=request.request_id,
                data={
                    "code": last_failure_code,
                    "message": messages.get(last_failure_code, "Free AI generation failed."),
                    "detail": last_failure_detail,
                },
            )
        finally:
            self._active.discard(request.request_id)
