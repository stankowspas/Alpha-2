import asyncio
import ssl
import sys

import pytest

pytest.importorskip("g4f")

from alpha_ai.g4f_gemini import G4FGeminiProvider
from alpha_ai.schemas import ModelAvailability


def test_tls_profile_keeps_verification_enabled():
    context = G4FGeminiProvider._tls_context()
    assert context.verify_mode is ssl.CERT_REQUIRED
    assert context.check_hostname is True
    if sys.version_info >= (3, 13) and hasattr(ssl, "VERIFY_X509_STRICT"):
        assert not (context.verify_flags & ssl.VERIFY_X509_STRICT)


def test_registry_exposes_primary_and_fallback_models():
    provider = G4FGeminiProvider()
    assert asyncio.run(provider.probe_model("gemini-3.6-flash")) is ModelAvailability.AVAILABLE
    assert asyncio.run(provider.probe_model("gemini-3.5-flash")) is ModelAvailability.AVAILABLE
    assert asyncio.run(provider.probe_model("paid-model")) is ModelAvailability.UNAVAILABLE


def test_idle_timeout_after_text_finishes_stream(monkeypatch):
    from alpha_ai import g4f_gemini as provider_module

    async def fake_stream():
        yield "OK"
        await asyncio.sleep(3600)

    def fake_factory(cls, **kwargs):
        return fake_stream()

    monkeypatch.setattr(provider_module.Gemini, "create_async_generator", classmethod(fake_factory))
    provider = G4FGeminiProvider(first_token_timeout=0.1, idle_timeout=0.02)

    async def collect():
        output = []
        async for chunk in provider.stream(
            request_id="idle-test", model_id="gemini-3.6-flash",
            system_prompt="", user_prompt="test", max_tokens=10, temperature=None,
        ):
            output.append(chunk)
        return output

    assert asyncio.run(collect()) == ["OK"]


def test_first_token_timeout_is_failure(monkeypatch):
    from alpha_ai import g4f_gemini as provider_module

    async def fake_stream():
        await asyncio.sleep(3600)
        yield "late"

    def fake_factory(cls, **kwargs):
        return fake_stream()

    monkeypatch.setattr(provider_module.Gemini, "create_async_generator", classmethod(fake_factory))
    provider = G4FGeminiProvider(first_token_timeout=0.02, idle_timeout=0.02)

    async def collect():
        return [chunk async for chunk in provider.stream(
            request_id="first-token-test", model_id="gemini-3.6-flash",
            system_prompt="", user_prompt="test", max_tokens=10, temperature=None,
        )]

    with pytest.raises(TimeoutError, match="MODEL_TIMEOUT"):
        asyncio.run(collect())
