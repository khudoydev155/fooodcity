import aiohttp
from html import escape
from aiogram import Router, F
from aiogram.types import (
    KeyboardButton,
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    WebAppInfo,
    MenuButtonWebApp,
)
from aiogram.filters import CommandStart, Command
from bot.database import db
from bot.config import config

router = Router()


PHONE_SHARE_TEXT = "📱 Telefon raqamimni ulashish"


def phone_request_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=PHONE_SHARE_TEXT, request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def order_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🍽 Buyurtma berish", web_app=WebAppInfo(url=config.MINI_APP_URL))]
    ])


# MUHIM: bu yerda ilgari `web_app_data_handler` (Telegram Mini App'ning
# Telegram.WebApp.sendData() orqali yuboradigan xabarini qabul qiluvchi
# handler) bor edi. Hozirgi React mini-app (miniapp-react/src/customer)
# buyurtmani ENDI sendData() orqali emas, to'g'ridan-to'g'ri REST API
# (POST /api/orders, bot/api/router.py) orqali yuboradi — shuning uchun
# bu handler hech qachon ishga tushmaydigan (o'lik) kod edi. Buyurtma
# yaratishning yagona haqiqiy yo'li endi create_order_api (router.py).

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
    user = await db.get_or_create_user(message.from_user)
    if not user:
        await message.answer("Ma'lumotlaringizni saqlab bo'lmadi. Iltimos, birozdan so'ng qayta urinib ko'ring.")
        return

    if config.MINI_APP_URL:
        try:
            await message.bot.set_chat_menu_button(
                chat_id=message.chat.id,
                menu_button=MenuButtonWebApp(
                    text="🍽 Menyu",
                    web_app=WebAppInfo(url=config.MINI_APP_URL)
                )
            )
        except Exception as e:
            pass

    welcome_text = (
        f"👋 <b>Assalomu alaykum, {escape(message.from_user.full_name)}!</b>\n\n"
        "Food City fast-food kafesining rasmiy botiga xush kelibsiz.\n"
        "Pastdagi tugma orqali menyuni ochib, buyurtma berishingiz mumkin."
    )
    await message.answer(
        welcome_text,
        reply_markup=order_keyboard(),
        parse_mode="HTML",
    )


@router.message(Command("phone"))
async def cmd_request_phone(message: Message):
    if message.chat.type != "private":
        await message.answer("Telefon raqamingizni bot bilan shaxsiy chatda ulashing.")
        return
    await message.answer(
        "Telefon raqamingizni tasdiqlash uchun quyidagi tugmani bosing. "
        "Faqat o'zingizning Telegram akkauntingizga tegishli kontakt qabul qilinadi.",
        reply_markup=phone_request_keyboard(),
    )


@router.message(F.contact)
async def handle_contact(message: Message):
    contact = message.contact
    sender = message.from_user
    if not contact or not sender:
        return

    if message.chat.type != "private":
        await message.answer("Telefon raqamingizni bot bilan shaxsiy chatda ulashing.")
        return

    if contact.user_id != sender.id:
        if contact.user_id is None:
            error_message = (
                "Telegram bu kontakt sizga tegishli ekanini tasdiqlay olmadi. "
                "Kontaktni qo'lda tanlamasdan, pastdagi raqam ulashish tugmasini bosing."
            )
        else:
            error_message = (
                "Boshqa odamning raqami qabul qilinmaydi. "
                "Iltimos, pastdagi tugma orqali o'z raqamingizni ulashing."
            )
        await message.answer(
            error_message,
            reply_markup=phone_request_keyboard(),
        )
        return

    user = await db.get_or_create_user(sender)
    if not user or not await db.verify_user_phone(sender.id, contact.phone_number):
        await message.answer(
            "Telefon raqamingizni saqlashda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
            reply_markup=phone_request_keyboard(),
        )
        return

    await message.answer(
        "✅ Telefon raqamingiz Telegram orqali tasdiqlandi.",
        reply_markup=ReplyKeyboardRemove(),
    )
    await message.answer(
        "Endi menyuni ochib buyurtma berishingiz mumkin.",
        reply_markup=order_keyboard(),
    )

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

@router.message(Command("help"))
async def cmd_help(message: Message, i18n: dict):
    text = """
/start - Boshlash
/profile - Profil
/orders - Buyurtmalar
/points - Ballar
/language - Tilni o'zgartirish
/phone - Telefon raqamini tasdiqlash
    """
    await message.answer(text)
