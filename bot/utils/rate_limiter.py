from aiohttp import web

@web.middleware
async def rate_limit_middleware(request, handler):
    return await handler(request)
