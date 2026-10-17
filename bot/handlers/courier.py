import logging
from html import escape
from urllib.parse import quote
from datetime import datetime
from aiogram import Router, F, Bot
from aiogram.types import CallbackQuery, Message, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from bot.database import db
from bot.config import config

logger = logging.getLogger(__name__)

router = Router()


def build_nav_urls(location: dict | None) -> tuple[str, str]:
    """Yandex va Google xaritalari uchun navigatsiya havolalarini shakllantiradi."""
    if not isinstance(location, dict):
        return "", ""
    lat = location.get("lat") or location.get("latitude")
    lon = location.get("lon") or location.get("longitude")
    if not lat or not lon:
        return "", ""
    yandex_url = f"https://yandex.uz/maps/?rtext=~{lat},{lon}&rtt=auto"
    google_url = f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}"
    return yandex_url, google_url


def build_courier_message_text(order: dict, stage: str = "assigned") -> str:
    """Kuryer uchun bosqichga mos boy HTML matn shakllantiradi."""
    customer = order.get("users") or {}
    customer_name = escape(str(customer.get("full_name") or "Mijoz"))
    username = str(customer.get("username") or "").strip()
    phone = str(order.get("phone") or customer.get("phone") or "").strip()

    phone_html = (
        f'<a href="tel:{quote(phone, safe="+")}">{escape(phone)}</a>'
        if phone
        else "<i>Ko'rsatilmagan</i>"
    )

    if username:
        customer_name += f" (@{escape(username.lstrip('@'))})"

    address = str(order.get("delivery_address") or "Olib ketish").strip()

    # Bosqich sarlavhalari
    stage_headers = {
        "assigned": "🛵 <b>Sizga yangi buyurtma biriktirildi!</b>",
        "delivering": "🚚 <b>Buyurtma yo'lda (Yetkazilmoqda)</b>",
        "arrived": "📍 <b>Yetib kelindi (Mijoz eshigi oldida)</b>",
        "delivered": "✅ <b>BUYURTMA MUVAFFAQIYATLI YETKAZILDI!</b>",
        "rejected": "❌ <b>Siz ushbu buyurtmani rad etdingiz.</b>",
    }
    header = stage_headers.get(stage, "📦 <b>Buyurtma ma'lumotlari</b>")

    # Taomlar ro'yxati
    items_list = []
    for item in order.get("items") or []:
        name = escape(str(item.get("name_uz") or item.get("name") or "Taom"))
        qty = item.get("qty") or item.get("quantity") or 1
        price = int(float(item.get("price") or 0))
        items_list.append(f"• {name} x{qty} — {price * qty:,} so'm")
    items_text = "\n".join(items_list) if items_list else "<i>(Taomlar ko'rsatilmagan)</i>"

    total = int(float(order.get("total") or 0))
    delivery_fee = int(float(order.get("delivery_fee") or 0))
    discount = int(float(order.get("discount") or 0))

    payment_method = str(order.get("payment_method") or "cash").lower()
    payment_status = str(order.get("payment_status") or "pending").lower()

    if payment_method in ("click", "payme") and payment_status == "paid":
        payment_badge = f"🟢 <b>TO'LANGAN ({payment_method.upper()})</b>\n⚠️ <i>Mijozdan naqd pul OLINMAYDI!</i>"
    elif payment_method in ("click", "payme"):
        payment_badge = f"🟡 <b>{payment_method.upper()} (To'lov kutilmoqda)</b>"
    else:
        payment_badge = f"💵 <b>NAQD TO'LOV</b>\n👉 <i>Mijozdan <b>{total:,} so'm</b> naqd pul oling!</i>"

    note = str(order.get("note") or "").strip()
    note_line = f"\n💬 <b>Izoh:</b> <i>{escape(note)}</i>" if note else ""

    text = (
        f"{header}\n\n"
        f"🔖 Buyurtma: <code>#{order.get('id')}</code>\n"
        f"👤 Mijoz: <b>{customer_name}</b>\n"
        f"📞 Telefon: {phone_html}\n"
        f"📍 Manzil: <b>{escape(address)}</b>\n"
        f"{note_line}\n"
        f"📋 <b>Tarkibi:</b>\n{items_text}\n\n"
        f"🛵 Yetkazish: {delivery_fee:,} so'm\n"
    )
    if discount > 0:
        text += f"🎁 Chegirma: -{discount:,} so'm\n"
    text += (
        f"💰 <b>Jami to'lov: {total:,} so'm</b>\n\n"
        f"{payment_badge}"
    )

    if stage == "delivered":
        now_time = datetime.now().strftime("%H:%M")
        text += f"\n\n⏰ Yetkazilgan vaqt: <b>{now_time}</b>"

    return text


def build_courier_keyboard(order: dict, stage: str = "assigned") -> InlineKeyboardMarkup | None:
    """Har bir bosqich uchun kuryerga mos Inline Keyboard qaytaradi."""
    if stage in ("delivered", "rejected"):
        return None

    order_id = str(order.get("id"))
    customer = order.get("users") or {}
    username = str(customer.get("username") or "").strip()
    location = order.get("location")
    yandex_url, _ = build_nav_urls(location)

    keyboard = []

    if stage == "assigned":
        # 1-Bosqich: Qabul qilish yoki Rad etish
        keyboard.append([
            InlineKeyboardButton(text="✅ Qabul qilish", callback_data=f"cr_acc_{order_id}"),
            InlineKeyboardButton(text="❌ Rad etish", callback_data=f"cr_rej_{order_id}")
        ])
        if yandex_url:
            keyboard.append([
                InlineKeyboardButton(text="🗺 Xaritada ko'rish", url=yandex_url)
            ])

    elif stage == "delivering":
        # 2-Bosqich: Yo'lda — Navigatsiya va yetib borganlik
        row1 = []
        if yandex_url:
            row1.append(InlineKeyboardButton(text="🗺 Yandex Navigator", url=yandex_url))
        if row1:
            keyboard.append(row1)

        keyboard.append([
            InlineKeyboardButton(text="📍 Manzilga yetib bordim", callback_data=f"cr_arr_{order_id}")
        ])

        if username:
            clean_user = username.lstrip("@")
            keyboard.append([
                InlineKeyboardButton(text="💬 Mijoz bilan Telegramda yozish", url=f"https://t.me/{clean_user}")
            ])

    elif stage == "arrived":
        # 3-Bosqich: Yetib keldi — Pul olish / Yakunlash
        total = int(float(order.get("total") or 0))
        payment_method = str(order.get("payment_method") or "cash").lower()
        payment_status = str(order.get("payment_status") or "pending").lower()

        if payment_method in ("click", "payme") and payment_status == "paid":
            btn_text = "✅ Buyurtma topshirildi (To'langan)"
        else:
            btn_text = f"💵 {total:,} so'm olindi va topshirildi"

        keyboard.append([
            InlineKeyboardButton(text=btn_text, callback_data=f"cr_del_{order_id}")
        ])

        if yandex_url:
            keyboard.append([
                InlineKeyboardButton(text="🗺 Xarita", url=yandex_url)
            ])

        if username:
            clean_user = username.lstrip("@")
            keyboard.append([
                InlineKeyboardButton(text="💬 Mijoz bilan Telegramda yozish", url=f"https://t.me/{clean_user}")
            ])

    return InlineKeyboardMarkup(inline_keyboard=keyboard) if keyboard else None


# ─── CALLBACK HANDLERS ────────────────────────────────────────────────────────

@router.callback_query(F.data.startswith("cr_acc_"))
async def handle_courier_accept(call: CallbackQuery, bot: Bot):
    order_id = call.data.replace("cr_acc_", "")
    user_id = call.from_user.id

    order = await db.get_order_for_courier_notification(order_id)
    if not order:
        await call.answer("❌ Buyurtma topilmadi!", show_alert=True)
        return

    # Kuryer o'ziga biriktirilganini tekshirish
    assigned_courier_id = order.get("courier_id")
    if assigned_courier_id and int(assigned_courier_id) != user_id:
        await call.answer("⚠️ Bu buyurtma sizga biriktirilmagan!", show_alert=True)
        return

    # Statusni delivering ga o'tkazish
    success = await db.update_order_status_as_courier(order_id, user_id, "delivering")
    if not success:
        # Admin bo'lishi ham mumkin
        await db.update_order_status(order_id, "delivering")

    order["status"] = "delivering"

    # Mijozga avtomatik bildirishnoma
    customer_id = order.get("user_id")
    if customer_id:
        try:
            await bot.send_message(
                customer_id,
                f"🛵 <b>Kuryerimiz yo'lga chiqdi!</b>\n\n"
                f"🔖 Buyurtma: <code>#{order_id}</code>\n"
                f"Kuryer taomlarni olib sizning manzilingiz tomon harakatlanmoqda. "
                f"Iltimos, telefoningizga e'tiborli bo'ling.",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.debug("Failed to notify customer on courier accept: %s", e)

    # Kuryer xabarini 2-bosqichga (delivering) o'tkazish
    new_text = build_courier_message_text(order, stage="delivering")
    new_kb = build_courier_keyboard(order, stage="delivering")
    try:
        await call.message.edit_text(new_text, reply_markup=new_kb, parse_mode="HTML", disable_web_page_preview=True)
    except Exception as e:
        logger.warning("Edit message on cr_acc failed: %s", e)

    await call.answer("✅ Buyurtmani qabul qildingiz! Yo'lingiz bexatar bo'lsin.")


@router.callback_query(F.data.startswith("cr_rej_"))
async def handle_courier_reject(call: CallbackQuery, bot: Bot):
    order_id = call.data.replace("cr_rej_", "")
    user_id = call.from_user.id

    order = await db.get_order_for_courier_notification(order_id)
    if not order:
        await call.answer("❌ Buyurtma topilmadi!", show_alert=True)
        return

    # Buyurtmadan kuryerni yechish
    await db.unassign_courier(order_id, user_id)

    # Kuryer xabarini yangilash
    new_text = build_courier_message_text(order, stage="rejected")
    try:
        await call.message.edit_text(new_text, reply_markup=None, parse_mode="HTML")
    except Exception as e:
        logger.warning("Edit message on cr_rej failed: %s", e)

    # Adminga ogohlantirish yuborish
    if config.ADMIN_CHAT_ID:
        admin_alert = (
            f"⚠️ <b>Kuryer buyurtmani rad etdi!</b>\n\n"
            f"🔖 Buyurtma: <code>#{order_id}</code>\n"
            f"👤 Kuryer: <b>{escape(call.from_user.full_name)}</b>\n\n"
            f"👉 Iltimos, admin paneldan ushbu buyurtmaga boshqa kuryer biriktiring."
        )
        try:
            await bot.send_message(config.ADMIN_CHAT_ID, admin_alert, parse_mode="HTML")
        except Exception as e:
            logger.error("Admin alert on courier reject failed: %s", e)

    await call.answer("Buyurtma rad etildi.")


@router.callback_query(F.data.startswith("cr_arr_"))
async def handle_courier_arrived(call: CallbackQuery, bot: Bot):
    order_id = call.data.replace("cr_arr_", "")
    user_id = call.from_user.id

    order = await db.get_order_for_courier_notification(order_id)
    if not order:
        await call.answer("❌ Buyurtma topilmadi!", show_alert=True)
        return

    # Mijozga darhol xabar
    customer_id = order.get("user_id")
    if customer_id:
        try:
            await bot.send_message(
                customer_id,
                f"🔔 <b>Kuryer yetib keldi!</b>\n\n"
                f"🔖 Buyurtma: <code>#{order_id}</code>\n"
                f"Kuryerimiz siz ko'rsatgan manzilga yetib keldi. Iltimos, buyurtmangizni qabul qilib oling.",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.debug("Failed to notify customer on courier arrived: %s", e)

    # Kuryer xabarini 3-bosqichga (arrived) o'tkazish
    new_text = build_courier_message_text(order, stage="arrived")
    new_kb = build_courier_keyboard(order, stage="arrived")
    try:
        await call.message.edit_text(new_text, reply_markup=new_kb, parse_mode="HTML", disable_web_page_preview=True)
    except Exception as e:
        logger.warning("Edit message on cr_arr failed: %s", e)

    await call.answer("📍 Mijozga yetib kelganingiz xabar qilindi!")


@router.callback_query(F.data.startswith("cr_del_"))
async def handle_courier_delivered(call: CallbackQuery, bot: Bot):
    order_id = call.data.replace("cr_del_", "")
    user_id = call.from_user.id

    order = await db.get_order_for_courier_notification(order_id)
    if not order:
        await call.answer("❌ Buyurtma topilmadi!", show_alert=True)
        return

    # Statusni delivered ga o'tkazish
    success = await db.update_order_status_as_courier(order_id, user_id, "delivered")
    if not success:
        await db.update_order_status(order_id, "delivered")

    order["status"] = "delivered"

    # Mijozga reyting baholash xabari
    customer_id = order.get("user_id")
    if customer_id:
        rating_kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⭐⭐⭐⭐⭐ Ajoyib!", callback_data=f"rate_{order_id.replace('#', 'ORD')}_5")],
            [InlineKeyboardButton(text="👍 Yaxshi", callback_data=f"rate_{order_id.replace('#', 'ORD')}_4")],
            [InlineKeyboardButton(text="👎 Yomon", callback_data=f"rate_{order_id.replace('#', 'ORD')}_1")]
        ])
        try:
            await bot.send_message(
                customer_id,
                f"✅ <b>Buyurtmangiz yetkazildi!</b>\n\n"
                f"🔖 Buyurtma: <code>#{order_id}</code>\n"
                f"Yoqimli ishtaha! Bizning xizmatimizni baholang:",
                reply_markup=rating_kb,
                parse_mode="HTML"
            )
        except Exception as e:
            logger.debug("Failed to notify customer on delivered: %s", e)

    # Kuryer xabarini 4-bosqichga (delivered) o'tkazish va barcha tugmalarni olib tashlash
    new_text = build_courier_message_text(order, stage="delivered")
    try:
        await call.message.edit_text(new_text, reply_markup=None, parse_mode="HTML", disable_web_page_preview=True)
    except Exception as e:
        logger.warning("Edit message on cr_del failed: %s", e)

    await call.answer("🎉 Buyurtma muvaffaqiyatli yakunlandi! Rahmat.")


# ─── COURIER STATS & COMMANDS ────────────────────────────────────────────────

@router.message(Command("kassa", "hisobot", "courier"))
async def cmd_courier_stats(message: Message):
    user_id = message.from_user.id
    couriers = await db.get_couriers()
    if not any(int(c.get("user_id", 0)) == user_id for c in couriers):
        await message.answer("Siz kuryerlar ro'yxatida emassiz.")
        return

    stats = await db.get_courier_daily_stats(user_id)
    active_orders = await db.get_courier_orders(user_id)

    text = (
        f"📊 <b>Kuryer hisoboti (Bugun)</b>\n\n"
        f"🛵 <b>Hozirgi faol buyurtmalar:</b> {len(active_orders)} ta\n"
        f"✅ <b>Yetkazilgan buyurtmalar:</b> {stats['delivered_count']} ta\n"
        f"💵 <b>Kassaga topshiriladigan naqd pul:</b> {stats['total_cash_to_deposit']:,} so'm\n"
    )
    if stats['total_delivery_fees'] > 0:
        text += f"📦 <b>Jami yetkazish to'lovlari:</b> {stats['total_delivery_fees']:,} so'm\n"

    await message.answer(text, parse_mode="HTML")
