from alpha_ai.policy import FreeModelPolicy
from alpha_ai.schemas import PolicyDecision

def test_denies_unknown_model():
    policy = FreeModelPolicy(("gemini-3.6-flash", "gemini-3.5-flash"))
    assert policy.decide("paid-model") is PolicyDecision.DENY
    assert policy.ordered_candidates("paid-model") == ()

def test_requested_model_is_first_then_only_allowlisted_fallbacks():
    policy = FreeModelPolicy(("gemini-3.6-flash", "gemini-3.5-flash"))
    assert policy.ordered_candidates("gemini-3.6-flash") == (
        "gemini-3.6-flash",
        "gemini-3.5-flash",
    )
