from aiohttp import web
from bot.api.router import routes

@routes.get("/health")
async def health_check(request: web.Request):
    import time
    return web.json_response({"status": "ok", "timestamp": int(time.time())})
