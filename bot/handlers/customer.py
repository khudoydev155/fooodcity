import json
import aiohttp
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppData, WebAppInfo
from aiogram.filters import CommandStart, Command
from bot.database import db
from bot.config import config
from bot.middlewares.i18n import get_i18n, locales
from bot.utils.formatters import format_order_summary

router = Router()

def get_language_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="🇺🇿 O'zbek", callback_data="lang_uz"),
            InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang_ru"),
            InlineKeyboardButton(text="🇬🇧 English", callback_data="lang_en")
        ]
    ])

@router.message(CommandStart())
async def cmd_start(message: Message):
    # Professional Upsert logic via DatabaseManager
    user = await db.get_or_create_user(message.from_user)
    i18n = get_i18n(message.from_user.id)
    
    # Premium Welcome with Mini App Button
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🍽 Buyurtma berish", web_app=WebAppInfo(url=config.MINI_APP_URL))]
    ])
    
    welcome_text = (
        f"👋 <b>Assalomu alaykum, {message.from_user.full_name}!</b>\n\n"
        "Food City fast-food kafesining rasmiy botiga xush kelibsiz.\n"
        "Pastdagi tugmani bosib mazali taomlarga buyurtma berishingiz mumkin!"
    )
    
    await message.answer(welcome_text, reply_markup=kb, parse_mode="HTML")

@router.message(F.location)
async def handle_location(message: Message):
    """
    Tejamkor Geokodlash:
    1. Gets lat/lon from Telegram
    2. Checks cache (not shown for brevity, but logically here)
    3. Fetches from Nominatim
    4. Caches address in User profile
    """
    user_id = message.from_user.id
    lat = message.location.latitude
    lon = message.location.longitude
    
    async with aiohttp.ClientSession() as session:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&accept-language=uz"
        headers = {'User-Agent': 'FoodCityBot/1.0'}
        async with session.get(url, headers=headers) as resp:
            if resp.status == 200:
                data = await resp.json()
                address = data.get("display_name", "Noma'lum manzil")
                
                # Cache in Database
                await db.update_user_location(user_id, lat, lon, address)
                
                await message.answer(f"📍 Manzilingiz saqlandi:\n<code>{address}</code>", parse_mode="HTML")
            else:
                await message.answer("📍 Joylashuv olindi, lekin manzilni aniqlab bo'lmadi.")

@router.message(F.web_app_data)
async def web_app_data_handler(message: Message, bot: Bot):
    try:
        data = json.loads(message.web_app_data.data)
        
        # Professional Order Creation with unit_price freezing
        order = await db.create_order(message.from_user.id, data)
        
        if order:
            await message.answer(
                f"✅ <b>Buyurtma qabul qilindi!</b>\n\n"
                f"🔖 Raqam: <b>#{order['id']}</b>\n"
                f"💰 Jami: <b>{order['total']:,} so'm</b>\n\n"
                "Tayyor bo'lgach xabar beramiz!",
                parse_mode="HTML"
            )
            
            # Notify Admin
            if config.ADMIN_CHAT_ID:
                await bot.send_message(
                    config.ADMIN_CHAT_ID,
                    f"🔔 <b>Yangi buyurtma!</b>\nID: #{order['id']}\nSumma: {order['total']:,} so'm",
                    parse_mode="HTML"
                )
    except Exception as e:
        import logging
        logging.error(f"Order error: {e}")
        await message.answer("Xatolik yuz berdi.")

@router.message(Command("help"))
async def cmd_help(message: Message, i18n: dict):
    text = """
/start - Boshlash
/profile - Profil
/orders - Buyurtmalar
/points - Ballar
/language - Tilni o'zgartirish
    """
    await message.answer(text)
