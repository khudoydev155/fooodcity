import time
import logging
import asyncio
from typing import Callable, Dict, Any, Awaitable

from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, TelegramObject
from bot.database import db

logger = logging.getLogger(__name__)

class LicenseCheckMiddleware(BaseMiddleware):
    """
    Botni masofadan o'chirish/yoqish (Kill-Switch) uchun Outer Middleware.
    Supabase bilan ishlaydi va bazani ortiqcha yuklamaslik uchun In-Memory Cache ishlatadi.
    """

    def __init__(self, cache_timeout: int = 120):
        super().__init__()
        self.cache_timeout = cache_timeout
        
        # In-Memory Kesh holati
        self._is_active: bool = True
        self._disabled_message: str = "Kechirasiz, bot vaqtincha faol emas."
        self._last_check_time: float = 0.0

    async def _update_cache_if_needed(self) -> None:
        """
        Agar kesh vaqti tugagan bo'lsa, bazadan yangi holatni tekshiradi.
        Tarmoq xatoliklarida bot ishlashda davom etadi (is_active = True).
        """
        current_time = time.time()
        
        if current_time - self._last_check_time < self.cache_timeout:
            return

        try:
            # Singleton DatabaseManager'dan (db) foydalanamiz
            response = await db._run_sync(
                db.client.table("system_settings")
                .select("*")
                .eq("id", "foodcity_bot")
                .single()
                .execute
            )
            data = response.data
            
            if data:
                self._is_active = data.get("is_active", True)
                self._disabled_message = data.get("bot_disabled_message", self._disabled_message)
            else:
                self._is_active = True

        except Exception as e:
            logger.error("Supabase'dan litsenziya holatini tekshirishda xatolik: %s", e)
            self._is_active = True
        finally:
            self._last_check_time = current_time

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any]
    ) -> Any:
        
        if not isinstance(event, (Message, CallbackQuery)):
            return await handler(event, data)
            
        await self._update_cache_if_needed()
        
        if not self._is_active:
            if isinstance(event, Message):
                await event.answer(self._disabled_message)
            elif isinstance(event, CallbackQuery):
                await event.answer(self._disabled_message, show_alert=True)
            return
            
        return await handler(event, data)
