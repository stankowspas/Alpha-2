from __future__ import annotations
from dataclasses import dataclass
from .schemas import PolicyDecision

@dataclass(frozen=True)
class FreeModelPolicy:
    allowed_models: tuple[str, ...]

    def decide(self, model_id: str) -> PolicyDecision:
        return (
            PolicyDecision.FREE_ALLOWED
            if model_id in self.allowed_models
            else PolicyDecision.DENY
        )

    def ordered_candidates(self, requested_model: str) -> tuple[str, ...]:
        if self.decide(requested_model) is PolicyDecision.DENY:
            return ()
        return (requested_model,) + tuple(
            model for model in self.allowed_models if model != requested_model
        )
