from __future__ import annotations
import json
from .schemas import StreamEvent

def encode_sse(event: StreamEvent) -> bytes:
    payload = json.dumps(event.data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event.event}\nid: {event.request_id}\ndata: {payload}\n\n".encode("utf-8")
