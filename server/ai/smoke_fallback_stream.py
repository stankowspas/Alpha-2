import asyncio
from alpha_ai.g4f_gemini import G4FGeminiProvider
from alpha_ai.policy import FreeModelPolicy
from alpha_ai.schemas import ChatRequest, ModelAvailability
from alpha_ai.service import GenerationService

real = G4FGeminiProvider(idle_timeout=5, first_token_timeout=60)

class ForcePrimaryUnavailable:
    provider_id = real.provider_id
    async def health(self): return await real.health()
    async def probe_model(self, model_id):
        if model_id == "gemini-3.6-flash": return ModelAvailability.UNAVAILABLE
        return await real.probe_model(model_id)
    async def stream(self, **kwargs):
        async for chunk in real.stream(**kwargs): yield chunk
    async def cancel(self, request_id): await real.cancel(request_id)

async def main():
    service = GenerationService(ForcePrimaryUnavailable(), FreeModelPolicy(("gemini-3.6-flash", "gemini-3.5-flash")))
    request = ChatRequest(request_id="real-fallback-002", system_prompt="Reply exactly.", user_prompt="Reply only ALPHA2_FALLBACK_OK", requested_model="gemini-3.6-flash", max_tokens=64)
    async for event in service.events(request): print(event.model_dump_json(), flush=True)

asyncio.run(main())
