import httpx, sys, time
payload={"request_id":"real-api-003","system_prompt":"Отговаряй точно и кратко.","user_prompt":"Отговори само с текста ALPHA2_API_OK","requested_model":"gemini-3.6-flash","max_tokens":64}
with httpx.stream("POST","http://127.0.0.1:5177/v1/chat/stream",json=payload,timeout=httpx.Timeout(60.0,read=45.0)) as r:
    print("HTTP",r.status_code,flush=True)
    for line in r.iter_lines():
        if line:
            print(line,flush=True)
