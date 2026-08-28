from __future__ import annotations
import asyncio
from fastapi.testclient import TestClient
from alpha_ai.app import create_app
from alpha_ai.schemas import ModelAvailability

class FakeProvider:
    provider_id = "fake-free"

    def __init__(self, availability=None, outputs=None):
        self.availability = availability or {}
        self.outputs = outputs or {}
        self.cancelled = []
        self.calls = []

    async def health(self):
        return True

    async def probe_model(self, model_id):
        return self.availability.get(model_id, ModelAvailability.UNAVAILABLE)

    async def stream(self, **kwargs):
        self.calls.append(kwargs["model_id"])
        for token in self.outputs.get(kwargs["model_id"], []):
            await asyncio.sleep(0)
            yield token

    async def cancel(self, request_id):
        self.cancelled.append(request_id)

def body(model="gemini-3.6-flash"):
    return {
        "request_id": "r1",
        "system_prompt": "system",
        "user_prompt": "hello",
        "requested_model": model,
        "max_tokens": 128,
    }

def test_health_is_free_only():
    client = TestClient(create_app(FakeProvider()))
    data = client.get("/health").json()
    assert data["free_only"] is True
    assert data["provider_available"] is True

def test_models_exposes_only_allowlist():
    provider = FakeProvider({
        "gemini-3.6-flash": ModelAvailability.AVAILABLE,
        "gemini-3.5-flash": ModelAvailability.AVAILABLE,
    })
    client = TestClient(create_app(provider))
    models = client.get("/v1/models").json()
    assert [m["model_id"] for m in models] == [
        "gemini-3.6-flash", "gemini-3.5-flash"
    ]
    assert all(m["free_allowed"] for m in models)

def test_primary_stream_success():
    provider = FakeProvider(
        {"gemini-3.6-flash": ModelAvailability.AVAILABLE},
        {"gemini-3.6-flash": ["Hello", " world"]},
    )
    client = TestClient(create_app(provider))
    text = client.post("/v1/chat/stream", json=body()).text
    assert "event: model_selected" in text
    assert '"actualModel":"gemini-3.6-flash"' in text
    assert '"fallbackUsed":false' in text
    assert "event: done" in text

def test_falls_back_only_to_allowed_free_model():
    provider = FakeProvider(
        {
            "gemini-3.6-flash": ModelAvailability.UNAVAILABLE,
            "gemini-3.5-flash": ModelAvailability.AVAILABLE,
        },
        {"gemini-3.5-flash": ["fallback"]},
    )
    client = TestClient(create_app(provider))
    text = client.post("/v1/chat/stream", json=body()).text
    assert '"actualModel":"gemini-3.5-flash"' in text
    assert '"fallbackUsed":true' in text
    assert '"fallbackReason":"requested_model_unavailable"' in text
    assert provider.calls == ["gemini-3.5-flash"]

def test_denies_non_allowlisted_requested_model_without_provider_call():
    provider = FakeProvider()
    client = TestClient(create_app(provider))
    text = client.post("/v1/chat/stream", json=body("paid-model")).text
    assert "FREE_POLICY_VIOLATION" in text
    assert provider.calls == []

def test_all_free_models_unavailable_returns_explicit_error():
    provider = FakeProvider()
    client = TestClient(create_app(provider))
    text = client.post("/v1/chat/stream", json=body()).text
    assert "FREE_MODEL_UNAVAILABLE" in text
    assert "event: done" not in text

def test_provider_error_on_primary_uses_free_fallback_with_reason():
    class ErrorProvider(FakeProvider):
        async def stream(self, **kwargs):
            self.calls.append(kwargs["model_id"])
            if kwargs["model_id"] == "gemini-3.6-flash":
                raise RuntimeError("provider failed")
            yield "fallback-ok"

    provider = ErrorProvider({
        "gemini-3.6-flash": ModelAvailability.AVAILABLE,
        "gemini-3.5-flash": ModelAvailability.AVAILABLE,
    })
    client = TestClient(create_app(provider))
    text = client.post("/v1/chat/stream", json=body()).text
    assert provider.calls == ["gemini-3.6-flash", "gemini-3.5-flash"]
    assert '"fallbackReason":"requested_model_provider_error"' in text
    assert "event: done" in text

def test_empty_response_is_not_success_and_tries_next_free_candidate():
    provider = FakeProvider(
        {
            "gemini-3.6-flash": ModelAvailability.AVAILABLE,
            "gemini-3.5-flash": ModelAvailability.AVAILABLE,
        },
        {
            "gemini-3.6-flash": [],
            "gemini-3.5-flash": ["ok"],
        },
    )
    client = TestClient(create_app(provider))
    text = client.post("/v1/chat/stream", json=body()).text
    assert provider.calls == ["gemini-3.6-flash", "gemini-3.5-flash"]
    assert '"actualModel":"gemini-3.5-flash"' in text
    assert '"fallbackReason":"requested_model_empty_response"' in text
    assert "event: done" in text
