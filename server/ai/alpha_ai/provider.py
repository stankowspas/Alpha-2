from __future__ import annotations
from dataclasses import dataclass
from typing import AsyncIterator, Protocol
from .schemas import ModelAvailability

class ProviderError(RuntimeError):
    code = "AI_BACKEND_UNAVAILABLE"

class ModelUnavailableError(ProviderError):
    code = "FREE_MODEL_UNAVAILABLE"

class ModelEmptyResponseError(ProviderError):
    code = "MODEL_EMPTY_RESPONSE"

@dataclass(frozen=True)
class ProviderGeneration:
    actual_model: str
    tokens: AsyncIterator[str]

class FreeAIProvider(Protocol):
    provider_id: str

    async def health(self) -> bool: ...
    async def probe_model(self, model_id: str) -> ModelAvailability: ...
    async def stream(
        self,
        *,
        request_id: str,
        model_id: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float | None,
    ) -> AsyncIterator[str]: ...

    async def cancel(self, request_id: str) -> None: ...
