from __future__ import annotations
from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field, field_validator

class PolicyDecision(str, Enum):
    FREE_ALLOWED = "FREE_ALLOWED"
    DENY = "DENY"

class ModelAvailability(str, Enum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    UNKNOWN = "UNKNOWN"

class ModelDescriptor(BaseModel):
    model_id: str
    free_allowed: bool
    availability: ModelAvailability = ModelAvailability.UNKNOWN
    provider: str
    last_probe_at: str | None = None

class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    backend_version: str
    free_only: Literal[True] = True
    provider: str
    provider_available: bool

class ChatRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    system_prompt: str = Field(default="", max_length=100_000)
    user_prompt: str = Field(min_length=1, max_length=200_000)
    requested_model: str = Field(min_length=1, max_length=128)
    max_tokens: int = Field(default=2048, ge=1, le=65536)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)

    @field_validator("request_id", "requested_model")
    @classmethod
    def no_control_chars(cls, value: str) -> str:
        if any(ord(ch) < 32 for ch in value):
            raise ValueError("control characters are not allowed")
        return value

class StreamEvent(BaseModel):
    event: Literal["start", "model_selected", "token", "metadata", "done", "error"]
    request_id: str
    data: dict
