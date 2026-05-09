from aiogram import Bot
from bot.locales.i18n import get_i18n
import logging
from bot.utils.formatters import format_order_summary

logger = logging.getLogger(__name__)

async def send_order_confirmation(bot: Bot, user_id: int, order: dict, lang: str):
    i18n = get_i18n(user_id, lang)
    text = i18n.get("order_confirmed", "✅ Buyurtmangiz qabul qilindi!")
    summary = format_order_summary(order, lang)
    
    try:
        await bot.send_message(user_id, f"{text}\n\n{summary}")
    except Exception as e:
        logger.error(f"Failed to send confirmation to {user_id}: {e}")

async def send_points_earned(bot: Bot, user_id: int, points: int, lang: str):
    i18n = get_i18n(user_id, lang)
    text = i18n.get("points_earned", "🎁 +{points} ball oldingiz!").format(points=points)
    try:
        await bot.send_message(user_id, text)
    except Exception as e:
        logger.error(f"Failed to send points notification to {user_id}: {e}")

async def send_admin_new_order_alert(bot: Bot, chat_id: int, order: dict):
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    
    text = f"🚨 YANGI BUYURTMA!\n\n" + format_order_summary(order, "uz")
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Tasdiqlash", callback_data=f"admin_order_confirm_{order['id']}"),
            InlineKeyboardButton(text="❌ Bekor qilish", callback_data=f"admin_order_cancel_{order['id']}")
        ]
    ])
    try:
        await bot.send_message(chat_id, text, reply_markup=keyboard)
    except Exception as e:
        logger.error(f"Failed to send admin alert to {chat_id}: {e}")

async def send_broadcast_message(bot: Bot, user_id: int, message: str) -> bool:
    try:
        await bot.send_message(user_id, message)
        return True
    except Exception as e:
        logger.error(f"Broadcast failed for {user_id}: {e}")
        return False
