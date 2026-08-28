from __future__ import annotations

import asyncio
import json
import os
import re
import ssl
import sys
from collections.abc import AsyncIterator
from urllib.parse import urlsplit, urlunsplit

import aiohttp
from g4f.Provider.needs_auth.Gemini import Gemini

from .schemas import ModelAvailability


class G4FGeminiProvider:
    provider_id = "g4f-gemini"

    def __init__(self, *, first_token_timeout: float | None = None, idle_timeout: float | None = None) -> None:
        self._active: dict[str, asyncio.Task] = {}
        self._generation_metadata: dict[str, dict] = {}
        self._models = tuple(dict.fromkeys(getattr(Gemini, "models", ())))
        self._first_token_timeout = first_token_timeout or float(os.getenv("ALPHA_AI_FIRST_TOKEN_TIMEOUT", "60"))
        self._idle_timeout = idle_timeout or float(os.getenv("ALPHA_AI_IDLE_TIMEOUT", "10"))

    @staticmethod
    def _source_urls(value: object) -> list[str]:
        try:
            serialized = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            return []
        result: list[str] = []
        for raw in re.findall(r'https?://[^"\\\s\]\[<>]+', serialized):
            candidate = raw.rstrip("),.;")
            try:
                parsed = urlsplit(candidate)
            except ValueError:
                continue
            host = (parsed.hostname or "").lower()
            if not host:
                continue
            if host.endswith(("gstatic.com", "googleusercontent.com", "google.com")):
                continue
            normalized = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
            if normalized not in result:
                result.append(normalized)
        return result[:12]

    def take_generation_metadata(self, request_id: str) -> dict:
        return self._generation_metadata.pop(request_id, {})

    @staticmethod
    def _tls_context() -> ssl.SSLContext:
        context = ssl.create_default_context()
        # Keep certificate + hostname verification enabled. Python 3.13 adds
        # VERIFY_X509_STRICT by default; some trusted legacy chains fail it.
        if sys.version_info >= (3, 13) and hasattr(ssl, "VERIFY_X509_STRICT"):
            context.verify_flags &= ~ssl.VERIFY_X509_STRICT
        return context

    async def health(self) -> bool:
        return bool(getattr(Gemini, "working", False) and self._models)

    async def probe_model(self, model_id: str) -> ModelAvailability:
        if not getattr(Gemini, "working", False):
            return ModelAvailability.UNAVAILABLE
        return ModelAvailability.AVAILABLE if model_id in self._models else ModelAvailability.UNAVAILABLE

    async def stream(
        self,
        *,
        request_id: str,
        model_id: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        temperature: float | None,
    ) -> AsyncIterator[str]:
        del max_tokens, temperature  # Provider does not expose stable controls here.
        task = asyncio.current_task()
        if task is not None:
            self._active[request_id] = task

        messages = []
        if system_prompt.strip():
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        connector = aiohttp.TCPConnector(ssl=self._tls_context())
        source_urls: list[str] = []
        try:
            generator = Gemini.create_async_generator(
                model=model_id,
                messages=messages,
                connector=connector,
                return_conversation=False,
            )
            iterator = generator.__aiter__()
            emitted = False
            while True:
                timeout = self._idle_timeout if emitted else self._first_token_timeout
                try:
                    item = await asyncio.wait_for(iterator.__anext__(), timeout=timeout)
                except StopAsyncIteration:
                    break
                except TimeoutError:
                    if emitted:
                        break
                    raise TimeoutError("MODEL_TIMEOUT: no first token from Gemini")
                source_value = getattr(item, "data", item)
                for source_url in self._source_urls(source_value):
                    if source_url not in source_urls:
                        source_urls.append(source_url)
                if isinstance(item, str) and item:
                    emitted = True
                    yield item
        finally:
            self._generation_metadata[request_id] = {
                "providerSources": source_urls[:12],
            }
            self._active.pop(request_id, None)
            if not connector.closed:
                await connector.close()

    async def cancel(self, request_id: str) -> None:
        task = self._active.get(request_id)
        if task is not None and not task.done():
            task.cancel()
