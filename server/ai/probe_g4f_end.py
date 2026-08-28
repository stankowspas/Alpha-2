import asyncio, ssl, aiohttp
from g4f.Provider.needs_auth.Gemini import Gemini

def ctx():
 c=ssl.create_default_context()
 if hasattr(ssl,'VERIFY_X509_STRICT'): c.verify_flags &= ~ssl.VERIFY_X509_STRICT
 return c
async def main():
 connector=aiohttp.TCPConnector(ssl=ctx())
 gen=Gemini.create_async_generator(model='gemini-3.6-flash',messages=[{'role':'user','content':'Reply only ALPHA2_END_OK'}],connector=connector,return_conversation=False)
 text=''
 async def run():
  nonlocal text
  async for item in gen:
   if isinstance(item,str):
    text += item
    print('STR',repr(item),flush=True)
  print('GEN_DONE',repr(text),flush=True)
 await asyncio.wait_for(run(),timeout=45)
asyncio.run(main())
