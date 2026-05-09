from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, Update
from bot.database import db
from bot.locales.i18n import get_i18n

class AuthMiddleware(BaseMiddleware):
    async def __call__(self, handler, event: Update, data: dict):
        # Allow checking is_blocked here or in customer handlers
        user = data.get("event_from_user")
        if not user:
            return await handler(event, data)
        
        db_user = await db.get_user(user.id)
        if db_user and db_user.get("is_blocked"):
            return # silent ignore
            
        return await handler(event, data)

def admin_required(func):
    async def wrapper(message: Message, *args, **kwargs):
        is_admin = await db.is_admin(message.from_user.id)
        if not is_admin:
            i18n = get_i18n(message.from_user.id)
            await message.answer(i18n["not_admin"])
            return
        return await func(message, *args, **kwargs)
    return wrapper

def role_required(role):
    def decorator(func):
        async def wrapper(message: Message, *args, **kwargs):
            user_role = await db.get_admin_role(message.from_user.id)
            if user_role != role:
                return
            return await func(message, *args, **kwargs)
        return wrapper
    return decorator
