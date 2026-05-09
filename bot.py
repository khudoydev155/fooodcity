"""
Food City Telegram Bot
Backend for the Food City Mini App ordering system.
Uses aiogram 3.x (async).
"""

import asyncio
import json
import logging
import os
import random

from aiogram import Bot, Dispatcher, F
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppData,
    WebAppInfo,
)
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")
MINI_APP_URL: str = os.getenv("MINI_APP_URL", "https://yourdomain.com/index.html")
ADMIN_CHAT_ID: str = os.getenv("ADMIN_CHAT_ID", "")
PROXY_URL: str = os.getenv("PROXY_URL", "")  # e.g. socks5://user:pass@host:port

if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN is not set. Check your .env file.")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bot & Dispatcher
# ---------------------------------------------------------------------------

# Configure proxy session if PROXY_URL is set (needed when Telegram is blocked)
if PROXY_URL:
    logger.info("Using proxy: %s", PROXY_URL)
    _session = AiohttpSession(proxy=PROXY_URL)
    bot = Bot(token=BOT_TOKEN, session=_session)
else:
    bot = Bot(token=BOT_TOKEN)

dp = Dispatcher()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def format_price(amount: int) -> str:
    """Format an integer price with thousands separator and 'so'm' suffix."""
    return f"{amount:,}".replace(",", " ") + " so'm"


def generate_order_number() -> int:
    """Return a random 4-digit order number."""
    return random.randint(1000, 9999)


def build_order_message(order: dict, order_number: int) -> str:
    """
    Build the human-readable order confirmation message in Uzbek.

    Expected order structure:
    {
        "items": [
            {"name": "Classic Burger", "price": 28000, "quantity": 2},
            ...
        ],
        "subtotal": 56000,
        "delivery": 15000,
        "total": 71000
    }
    """
    items: list = order.get("items", [])
    delivery: int = order.get("delivery", 15000)
    total: int = order.get("total", 0)

    lines = [
        "✅ <b>Buyurtma qabul qilindi!</b>\n",
        f"🔖 <b>Buyurtma raqami:</b> #{order_number}\n",
        "📦 <b>Tarkib:</b>",
    ]

    for item in items:
        name = item.get("name", "Noma'lum")
        qty = item.get("quantity", 1)
        price = item.get("price", 0) * qty
        lines.append(f"  • {name} x{qty} — {format_price(price)}")

    lines.append("")
    lines.append(f"🚚 <b>Yetkazib berish:</b> {format_price(delivery)}")
    lines.append(f"⚡ <b>Jami:</b> {format_price(total)}")
    lines.append("")
    lines.append("⏱ <b>Taxminiy vaqt:</b> 30–45 daqiqa")

    return "\n".join(lines)


def build_admin_message(order: dict, order_number: int, user: object) -> str:
    """Build the admin notification message with full user info."""
    full_name = user.full_name or "Noma'lum"
    username = f"@{user.username}" if user.username else "yo'q"
    user_id = user.id

    order_body = build_order_message(order, order_number)

    admin_header = (
        "🛎 <b>Yangi buyurtma keldi!</b>\n\n"
        f"👤 <b>Mijoz:</b> {full_name}\n"
        f"🔗 <b>Username:</b> {username}\n"
        f"🆔 <b>User ID:</b> <code>{user_id}</code>\n\n"
    )

    return admin_header + order_body


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


@dp.message(CommandStart())
async def handle_start(message: Message) -> None:
    """Send welcome message with the Mini App button."""
    try:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="🍽 Menuni ko'rish",
                        web_app=WebAppInfo(url=MINI_APP_URL),
                    )
                ]
            ]
        )

        welcome_text = (
            "🍔 <b>Food City</b> ga xush kelibsiz!\n\n"
            "Biz sizga eng mazali burgerlar, pizzalar, sneklar "
            "va ichimliklarni taklif qilamiz. 🎉\n\n"
            "Buyurtma berish uchun quyidagi tugmani bosing 👇"
        )

        await message.answer(welcome_text, parse_mode="HTML", reply_markup=keyboard)
        logger.info("Start command handled for user %s", message.from_user.id)

    except Exception as exc:
        logger.exception("Error in handle_start: %s", exc)
        await message.answer(
            "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
            parse_mode="HTML",
        )


@dp.message(F.web_app_data)
async def handle_web_app_data(message: Message) -> None:
    """Receive order JSON from the Mini App and confirm it."""
    try:
        raw_data: WebAppData = message.web_app_data
        order: dict = json.loads(raw_data.data)

        # Validate minimal structure
        if not isinstance(order, dict) or "items" not in order:
            raise ValueError("Invalid order structure received.")

        items = order.get("items", [])
        if not items:
            await message.answer(
                "⚠️ Buyurtmangiz bo'sh. Iltimos, menuga qayting va mahsulot tanlang.",
                parse_mode="HTML",
            )
            return

        order_number = generate_order_number()

        # Send confirmation to user
        confirmation = build_order_message(order, order_number)
        await message.answer(confirmation, parse_mode="HTML")

        # Forward to admin if configured
        if ADMIN_CHAT_ID:
            try:
                admin_msg = build_admin_message(order, order_number, message.from_user)
                await bot.send_message(
                    chat_id=int(ADMIN_CHAT_ID),
                    text=admin_msg,
                    parse_mode="HTML",
                )
                logger.info(
                    "Order #%s forwarded to admin chat %s", order_number, ADMIN_CHAT_ID
                )
            except Exception as admin_exc:
                logger.error("Failed to forward order to admin: %s", admin_exc)

        logger.info(
            "Order #%s received from user %s (%s items)",
            order_number,
            message.from_user.id,
            len(items),
        )

    except json.JSONDecodeError:
        logger.warning("Invalid JSON received from user %s", message.from_user.id)
        await message.answer(
            "❌ Buyurtma ma'lumotlarini o'qishda xatolik yuz berdi. "
            "Iltimos, qayta urinib ko'ring.",
            parse_mode="HTML",
        )
    except Exception as exc:
        logger.exception("Unexpected error in handle_web_app_data: %s", exc)
        await message.answer(
            "❌ Buyurtmangizni qayta ishlashda xatolik yuz berdi. "
            "Iltimos, bir ozdan so'ng qayta urinib ko'ring.",
            parse_mode="HTML",
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    logger.info("Starting Food City bot...")
    await dp.start_polling(bot, skip_updates=True)


if __name__ == "__main__":
    asyncio.run(main())
