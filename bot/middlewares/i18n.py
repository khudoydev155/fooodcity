import json
from pathlib import Path
from cachetools import TTLCache
from bot.database import db

# Cache language for 5 mins
lang_cache = TTLCache(maxsize=1000, ttl=300)

locales = {}
locales_dir = Path(__file__).parent.parent / "locales"

for lang in ["uz", "ru", "en"]:
    try:
        with open(locales_dir / f"{lang}.json", "r", encoding="utf-8") as f:
            locales[lang] = json.load(f)
    except FileNotFoundError:
        locales[lang] = {}

def get_i18n(user_id: int, override_lang: str = None):
    lang = override_lang
    if not lang:
        lang = lang_cache.get(user_id)
    if not lang:
        # Default sync resolution, ideally this is done async in middleware
        lang = "uz"
    return locales.get(lang, locales["uz"])

from aiogram import BaseMiddleware
from aiogram.types import Update

class I18nMiddleware(BaseMiddleware):
    async def __call__(self, handler, event: Update, data: dict):
        user = data.get("event_from_user")
        if user:
            lang = lang_cache.get(user.id)
            if not lang:
                db_user = await db.get_user(user.id)
                lang = db_user.get("language", "uz") if db_user else "uz"
                lang_cache[user.id] = lang
            data["i18n"] = locales.get(lang, locales["uz"])
        
        return await handler(event, data)
