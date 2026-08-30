import asyncio

from alpha_ai.gemini_api import GeminiApiProvider
from alpha_ai.schemas import ModelAvailability


def test_health_requires_api_key():
    provider = GeminiApiProvider(api_key="")
    assert asyncio.run(provider.health()) is False
    assert asyncio.run(provider.probe_model("gemini-3.6-flash")) is ModelAvailability.UNAVAILABLE


def test_registry_exposes_only_supported_free_models():
    provider = GeminiApiProvider(api_key="test-key")
    assert asyncio.run(provider.probe_model("gemini-3.6-flash")) is ModelAvailability.AVAILABLE
    assert asyncio.run(provider.probe_model("gemini-3.5-flash")) is ModelAvailability.AVAILABLE
    assert asyncio.run(provider.probe_model("paid-model")) is ModelAvailability.UNAVAILABLE


def test_payload_keeps_secret_out_and_uses_system_instruction():
    payload = GeminiApiProvider._payload(
        system_prompt="system",
        user_prompt="hello",
        max_tokens=2048,
    )
    assert payload["contents"][0]["parts"][0]["text"] == "hello"
    assert payload["systemInstruction"]["parts"][0]["text"] == "system"
    assert payload["generationConfig"] == {"maxOutputTokens": 2048}


def test_text_chunks_skip_thought_parts():
    event = {
        "candidates": [{
            "content": {
                "parts": [
                    {"text": "private thought", "thought": True},
                    {"text": "Hello"},
                    {"text": " world"},
                ]
            }
        }]
    }
    assert GeminiApiProvider._text_chunks(event) == ["Hello", " world"]


def test_grounding_urls_extract_web_sources_only():
    event = {
        "candidates": [{
            "groundingMetadata": {
                "groundingChunks": [
                    {"web": {"uri": "https://example.com/a"}},
                    {"web": {"uri": "https://example.com/a"}},
                    {"web": {"uri": "https://example.org/b"}},
                ]
            }
        }]
    }
    assert GeminiApiProvider._grounding_urls(event) == [
        "https://example.com/a",
        "https://example.org/b",
    ]
