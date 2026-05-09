import json
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppData
from aiogram.filters import CommandStart, Command
from bot.database import db
from bot.config import config
from bot.middlewares.i18n import get_i18n, locales
from bot.utils.security import validate_init_data, validate_order_payload, recalculate_total, generate_unique_order_id
from bot.utils.loyalty import calculate_points_earned
from bot.utils.notifications import send_order_confirmation, send_points_earned, send_admin_new_order_alert
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
async def cmd_start(message: Message, i18n: dict):
    user = await db.get_or_create_user(message.from_user)
    if not user:
        return
        
    if user.get("is_blocked"):
        await message.answer(i18n.get("blocked", "Siz bloklangansiz."))
        return

    # Check if this is a brand new user or if language needs to be set
    if not user.get("language") or message.text == "/start":
        await message.answer(
            "Tilni tanlang / Выберите язык / Choose language:",
            reply_markup=get_language_keyboard()
        )
    else:
        await send_welcome(message, user, i18n)

@router.callback_query(F.data.startswith("lang_"))
async def process_language(callback: CallbackQuery, i18n: dict):
    lang = callback.data.split("_")[1]
    await db.update_user_language(callback.from_user.id, lang)
    
    # Reload i18n for new language
    new_i18n = locales.get(lang, locales["uz"])
    
    await callback.message.edit_text(new_i18n.get("welcome", "Xush kelibsiz!"))
    
    user = await db.get_user(callback.from_user.id)
    await send_welcome(callback.message, user, new_i18n, is_callback=True)

async def send_welcome(message, user, i18n, is_callback=False):
    from aiogram.types import WebAppInfo, ReplyKeyboardMarkup, KeyboardButton
    
    # Send Mini App button
    keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=i18n.get("menu_button", "🍽 Menuni ko'rish"), web_app=WebAppInfo(url=config.MINI_APP_URL))]
        ],
        resize_keyboard=True
    )
    
    text = i18n.get("welcome", "Xush kelibsiz!")
    points = user.get("loyalty_points", 0)
    if points > 0:
        text += f"\n\n💎 {i18n.get('points_balance', 'Balansingiz: {points} ball').format(points=points)}"
        
    if is_callback:
        await message.answer(text, reply_markup=keyboard)
    else:
        await message.answer(text, reply_markup=keyboard)

@router.message(F.web_app_data)
async def web_app_data_handler(message: Message, bot: Bot, i18n: dict):
    try:
        data = json.loads(message.web_app_data.data)
        
        # Validations
        valid, err_msg = validate_order_payload(data)
        if not valid:
            await message.answer(f"Xato: {err_msg}")
            return
            
        # Optional: Security validate INIT_DATA (usually done in API, but let's assume it's fine if from web_app_data via Telegram)
        # Recalculate total
        expected_subtotal = await recalculate_total(data['items'], db)
        if abs(expected_subtotal - data['subtotal']) > expected_subtotal * 0.05: # 5% tolerance
            await message.answer("Narxlar o'zgargan, iltimos qaytadan urinib ko'ring.")
            return
            
        order_id = await generate_unique_order_id(db)
        data['id'] = order_id
        
        # Create order
        order = await db.create_order(message.from_user.id, data)
        if not order:
            await message.answer("Xatolik yuz berdi.")
            return
            
        # Loyalty points calculation
        points_earned = calculate_points_earned(order['total'])
        if points_earned > 0:
            await db.add_points(message.from_user.id, points_earned, order_id, "Buyurtma uchun")
            
        # Send notifications
        lang = data.get("language", "uz")
        await send_order_confirmation(bot, message.from_user.id, data, lang)
        
        if config.ADMIN_CHAT_ID:
            await send_admin_new_order_alert(bot, config.ADMIN_CHAT_ID, data)
            
        if points_earned > 0:
            await send_points_earned(bot, message.from_user.id, points_earned, lang)
            
    except Exception as e:
        import logging
        logging.error(f"Web App Data error: {e}")
        await message.answer("Tizimda xatolik yuz berdi.")

@router.message(Command("orders"))
async def cmd_orders(message: Message, i18n: dict):
    orders = await db.get_user_orders(message.from_user.id, limit=5)
    if not orders:
        await message.answer("Sizda hali buyurtmalar yo'q.")
        return
        
    kb = []
    for order in orders:
        status_emoji = "🆕" if order['status'] == 'new' else "✅" if order['status'] == 'delivered' else "📦"
        kb.append([InlineKeyboardButton(text=f"{status_emoji} {order['id']} - {order['total']} so'm", callback_data=f"order_detail_{order['id']}")])
        
    await message.answer("Sizning oxirgi buyurtmalaringiz:", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))

@router.callback_query(F.data.startswith("order_detail_"))
async def order_detail_callback(callback: CallbackQuery, i18n: dict):
    order_id = callback.data.split("_")[2]
    order = await db.get_order(order_id)
    if not order:
        await callback.answer("Topilmadi", show_alert=True)
        return
        
    lang = (await db.get_user(callback.from_user.id)).get("language", "uz")
    summary = format_order_summary(order, lang)
    status_text = i18n.get(f"order_status_{order['status']}", order['status'])
    await callback.message.answer(f"Status: {status_text}\n\n{summary}")
    await callback.answer()

@router.message(Command("profile"))
async def cmd_profile(message: Message, i18n: dict):
    stats = await db.get_user_stats(message.from_user.id)
    text = i18n.get("profile_info", "").format(
        name=message.from_user.full_name,
        orders=stats['total_orders'],
        spent=stats['total_spent'],
        points=stats['points']
    )
    await message.answer(text)

@router.message(Command("language"))
async def cmd_language(message: Message, i18n: dict):
    await message.answer(i18n.get("choose_language", "Tilni tanlang:"), reply_markup=get_language_keyboard())

@router.message(Command("points"))
async def cmd_points(message: Message, i18n: dict):
    points = await db.get_points_balance(message.from_user.id)
    text = i18n.get("points_balance", "💎 Balansingiz: {points} ball").format(points=points)
    
    history = await db.get_loyalty_history(message.from_user.id)
    if history:
        text += "\n\n📋 Tarix:\n"
        for h in history:
            sign = "+" if h['points'] > 0 else ""
            text += f"▪️ {sign}{h['points']} ({h['reason']})\n"
            
    await message.answer(text)

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
