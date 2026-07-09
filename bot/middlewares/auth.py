from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, Update
from bot.database import db
from bot.config import config
from bot.locales.i18n import get_i18n
import time

# Simple in-memory cache to speed up things
ADMIN_CACHE = {} # user_id: (is_admin, expires)
BLOCKED_CACHE = {} # user_id: (is_blocked, expires)
CACHE_TTL = 300 # 5 minutes

async def is_admin(user_id: int) -> bool:
    if user_id in config.SUPERADMIN_IDS:
        return True
        
    now = time.time()
    if user_id in ADMIN_CACHE:
        val, exp = ADMIN_CACHE[user_id]
        if now < exp: return val
        
    try:
        result = db.client.table('admins').select('*').eq('user_id', user_id).execute()
        is_adm = len(result.data) > 0
        ADMIN_CACHE[user_id] = (is_adm, now + CACHE_TTL)
        return is_adm
    except:
        return False

class AuthMiddleware(BaseMiddleware):
    async def __call__(self, handler, event: Update, data: dict):
        user = data.get("event_from_user")
        if not user:
            return await handler(event, data)
        
        now = time.time()
        user_id = user.id
        
        # Check blocked cache
        if user_id in BLOCKED_CACHE:
            is_blocked, exp = BLOCKED_CACHE[user_id]
            if now < exp:
                if is_blocked: return
            else:
                del BLOCKED_CACHE[user_id]

        if user_id not in BLOCKED_CACHE:
            db_user = await db.get_user(user_id)
            is_blocked = db_user.get("is_blocked", False) if db_user else False
            BLOCKED_CACHE[user_id] = (is_blocked, now + CACHE_TTL)
            if is_blocked: return
            
        return await handler(event, data)

def admin_required(func):
    async def wrapper(event, *args, **kwargs):
        user_id = event.from_user.id
        if not await is_admin(user_id):
            if isinstance(event, Message):
                i18n = get_i18n(user_id)
                await event.answer(i18n.get("not_admin", "Siz admin emassiz!"))
            return
        return await func(event, *args, **kwargs)
    return wrapper

def role_required(role):
    def decorator(func):
        async def wrapper(event, *args, **kwargs):
            user_id = event.from_user.id
            # We don't cache roles here yet, but superadmin bypasses
            if user_id in config.SUPERADMIN_IDS:
                return await func(event, *args, **kwargs)
                
            user_role = await db.get_admin_role(user_id)
            if user_role != role:
                return
            return await func(event, *args, **kwargs)
        return wrapper
    return decorator
