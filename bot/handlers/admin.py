from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from bot.database import db
from bot.middlewares.auth import admin_required, role_required
from bot.utils.formatters import format_order_summary

router = Router()

@router.message(Command("admin"))
@admin_required
async def cmd_admin(message: Message):
    role = await db.get_admin_role(message.from_user.id)
    
    if role == "superadmin":
        text = "👑 Superadmin Paneli"
    elif role == "admin":
        text = "👨‍💼 Admin Paneli"
    else:
        text = "👷 Staff Paneli"
        
    await message.answer(f"{text}\nWeb panelga kiring yordamchi buyruqlar orqali boshqaring.")

@router.message(Command("orders_new"))
@admin_required
async def cmd_orders_new(message: Message):
    orders = await db.get_orders_by_status("new")
    if not orders:
        await message.answer("Yangi buyurtmalar yo'q.")
        return
        
    for order in orders:
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Tasdiqlash", callback_data=f"admin_order_confirm_{order['id']}"),
                InlineKeyboardButton(text="❌ Bekor qilish", callback_data=f"admin_order_cancel_{order['id']}")
            ]
        ])
        summary = format_order_summary(order, "uz")
        await message.answer(summary, reply_markup=kb)

@router.callback_query(F.data.startswith("admin_order_"))
@admin_required
async def admin_order_action(callback: CallbackQuery):
    parts = callback.data.split("_")
    action = parts[2]
    order_id = parts[3]
    
    if action == "confirm":
        await db.update_order_status(order_id, "confirmed")
        await callback.message.edit_text(callback.message.text + "\n\n✅ Tasdiqlandi")
    elif action == "cancel":
        await db.update_order_status(order_id, "cancelled")
        await callback.message.edit_text(callback.message.text + "\n\n❌ Bekor qilindi")
    
    await callback.answer()

@router.message(Command("broadcast"))
@role_required("superadmin")
async def cmd_broadcast(message: Message):
    text = message.text.replace("/broadcast ", "", 1)
    if not text or text == "/broadcast":
        await message.answer("Matn kiriting: /broadcast Xabar matni")
        return
        
    users = await db.get_all_users(limit=10000)
    await message.answer(f"Yuborilmoqda... {len(users)} ta foydalanuvchiga")
    
    # In a real scenario, use asyncio.sleep to respect Telegram limits
    # and maybe run in a separate task. Here we just show the structure.
    success = 0
    for u in users:
        if not u.get("is_blocked"):
            try:
                await message.bot.send_message(u["id"], text)
                success += 1
            except Exception:
                pass
                
    await message.answer(f"✅ {success} ta yuborildi.")
