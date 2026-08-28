import asyncio
import httpx

async def main():
    rid='real-cancel-001'
    payload={'request_id':rid,'system_prompt':'Write continuously until stopped.','user_prompt':'Write a long numbered list from 1 to 200 with a short sentence for every item.','requested_model':'gemini-3.6-flash','max_tokens':4096}
    saw_token=False; saw_done=False; cancel_result=None
    timeout=httpx.Timeout(90.0,read=70.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            async with client.stream('POST','http://127.0.0.1:5177/v1/chat/stream',json=payload) as response:
                print('STREAM_HTTP',response.status_code,flush=True)
                event=None
                async for line in response.aiter_lines():
                    if line.startswith('event: '): event=line[7:]
                    elif line.startswith('data: ') and event:
                        print(event,line[:180],flush=True)
                        if event=='token' and not saw_token:
                            saw_token=True
                            cr=await client.post(f'http://127.0.0.1:5177/v1/cancel/{rid}')
                            cancel_result=(cr.status_code,cr.json())
                            print('CANCEL',cancel_result,flush=True)
                        if event=='done': saw_done=True
        except Exception as exc:
            print('STREAM_END_EXCEPTION',type(exc).__name__,str(exc)[:180],flush=True)
    print('RESULT',{'saw_token':saw_token,'saw_done':saw_done,'cancel':cancel_result},flush=True)
    if not saw_token or not cancel_result or cancel_result[0]!=200 or saw_done: raise SystemExit(2)

asyncio.run(main())
