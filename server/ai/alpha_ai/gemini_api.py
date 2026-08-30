from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from urllib.parse import quote

import aiohttp

from .provider import ProviderError
from .schemas import ModelAvailability

SUPPORTED_MODELS = ("gemini-3.6-flash", "gemini-3.5-flash")
API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiApiProvider:
    provider_id = "gemini-api"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        first_token_timeout: float | None = None,
        idle_timeout: float | None = None,
    ) -> None:
        configured_key = os.getenv("GEMINI_API_KEY", "") if api_key is None else api_key
        self._api_key = configured_key.strip()
        self._first_token_timeout = first_token_timeout or float(os.getenv("ALPHA_AI_FIRST_TOKEN_TIMEOUT", "60"))
        self._idle_timeout = idle_timeout or float(os.getenv("ALPHA_AI_IDLE_TIMEOUT", "20"))
        self._active: dict[str, asyncio.Task] = {}
        self._generation_metadata: dict[str, dict] = {}

    async def health(self) -> bool:
        return bool(self._api_key)

    async def probe_model(self, model_id: str) -> ModelAvailability:
        if not self._api_key:
            return ModelAvailability.UNAVAILABLE
        return ModelAvailability.AVAILABLE if model_id in SUPPORTED_MODELS else ModelAvailability.UNAVAILABLE

    def take_generation_metadata(self, request_id: str) -> dict:
        return self._generation_metadata.pop(request_id, {})

    @staticmethod
    def _payload(*, system_prompt: str, user_prompt: str, max_tokens: int) -> dict:
        payload: dict = {
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }
        if system_prompt.strip():
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        return payload

    @staticmethod
    def _text_chunks(event: dict) -> list[str]:
        result: list[str] = []
        for candidate in event.get("candidates", []):
            content = candidate.get("content") or {}
            for part in content.get("parts", []):
                if part.get("thought"):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text:
                    result.append(text)
        return result

    @staticmethod
    def _grounding_urls(event: dict) -> list[str]:
        result: list[str] = []
        for candidate in event.get("candidates", []):
            metadata = candidate.get("groundingMetadata") or {}
            for chunk in metadata.get("groundingChunks", []):
                web = chunk.get("web") or {}
                uri = web.get("uri")
                if isinstance(uri, str) and uri.startswith(("http://", "https://")) and uri not in result:
                    result.append(uri)
        return result

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
        del temperature  # Deprecated for the current Gemini 3.x Flash models.
        if not self._api_key:
            raise ProviderError("GEMINI_API_KEY is not configured")
        if model_id not in SUPPORTED_MODELS:
            raise ProviderError(f"Unsupported Gemini model: {model_id}")

        task = asyncio.current_task()
        if task is not None:
            self._active[request_id] = task

        url = f"{API_BASE_URL}/models/{quote(model_id, safe='')}:streamGenerateContent?alt=sse"
        headers = {
            "x-goog-api-key": self._api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        payload = self._payload(system_prompt=system_prompt, user_prompt=user_prompt, max_tokens=max_tokens)
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=self._first_token_timeout)
        source_urls: list[str] = []
        emitted = False

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers, json=payload) as response:
                    if response.status != 200:
                        detail = (await response.text())[:400]
                        raise ProviderError(f"GEMINI_API_HTTP_{response.status}: {detail}")

                    while True:
                        read_timeout = self._idle_timeout if emitted else self._first_token_timeout
                        try:
                            raw_line = await asyncio.wait_for(response.content.readline(), timeout=read_timeout)
                        except TimeoutError as exc:
                            if emitted:
                                break
                            raise TimeoutError("MODEL_TIMEOUT: no first token from Gemini API") from exc
                        if not raw_line:
                            break

                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        for source_url in self._grounding_urls(event):
                            if source_url not in source_urls:
                                source_urls.append(source_url)
                        for text in self._text_chunks(event):
                            emitted = True
                            yield text
        finally:
            self._generation_metadata[request_id] = {"providerSources": source_urls[:12]}
            self._active.pop(request_id, None)

    async def cancel(self, request_id: str) -> None:
        task = self._active.get(request_id)
        if task is not None and not task.done():
            task.cancel()
