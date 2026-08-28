# Alpha 2 Free AI Backend

This service is intentionally narrow: inference transport plus free-only model policy.

## Architecture invariants
- no paid provider or paid API fallback;
- only allowlisted free models may be selected;
- requested and actual model are reported separately;
- empty/invalid responses are failures;
- Task Engine, VAP and Memory remain outside this service.

## Local tests
```powershell
python -m pytest -q
python -m compileall -q alpha_ai
```

## Development server
```powershell
python -m uvicorn alpha_ai.app:app --host 127.0.0.1 --port 5176
```

The real g4f provider is enabled only after the skeleton passes local tests.
