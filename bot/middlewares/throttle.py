from aiogram import BaseMiddleware
from aiogram.types import Update, Message
from cachetools import TTLCache
import logging

logger = logging.getLogger(__name__)

# Max 30 messages/minute
msg_cache = TTLCache(maxsize=10000, ttl=60)
# Max 3 orders/hour (handled manually in web_app_data if needed, but here we can track orders via another cache)

class ThrottleMiddleware(BaseMiddleware):
    async def __call__(self, handler, event: Update, data: dict):
        user = data.get("event_from_user")
        if not user:
            return await handler(event, data)
            
        # Message throttling
        if isinstance(event, Message):
            count = msg_cache.get(user.id, 0)
            if count >= 30:
                return # Block silently
            elif count == 25:
                # Optional: Send a warning message
                pass
            msg_cache[user.id] = count + 1
            
        return await handler(event, data)
