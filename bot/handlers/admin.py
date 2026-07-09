import asyncio
import uuid
import logging
from datetime import datetime, date
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, ContentType
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from bot.database import db
from bot.services.image_service import ImageService, ImageServiceError
from bot.config import config

# duplicate import removed
logger = logging.getLogger(__name__)
router = Router()

class FakeCall:
    def __init__(self, original_call, new_data):
        self.data = new_data
        self.message = original_call.message
        self.from_user = original_call.from_user
        self.id = original_call.id
        self.bot = original_call.bot
    async def answer(self, *args, **kwargs):
        pass


# --- ADMIN CHECK ---
async def is_admin(user_id: int) -> bool:
    if user_id in config.SUPERADMIN_IDS:
        return True
    try:
        # Check database for admin role
        role = await db.get_admin_role(user_id)
        return role is not None
    except:
        return False

# --- STATES FOR FSM ---
class MenuAddStates(StatesGroup):
    category = State()
    name_uz = State()
    name_ru = State()
    name_en = State()
    desc_uz = State()
    desc_ru = State()
    desc_en = State()
    price = State()
    emoji = State()
    badge = State()
    photo = State()
    confirm = State()

class CouponAddStates(StatesGroup):
    code = State()
    type = State()
    value = State()
    max_uses = State()

class ImageUploadStates(StatesGroup):
    waiting_photo = State()
    # store context
    menu_item_id = State()
    product_code = State()
    admin_user_id = State()

class BroadcastStates(StatesGroup):
    message = State()
    confirm = State()

# --- /admin COMMAND ---
@router.message(Command('admin'))
async def admin_cmd(message: Message, **kwargs):
    if not await is_admin(message.from_user.id):
        return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="📊 Statistika", callback_data="adm_stats"),
            InlineKeyboardButton(text="📦 Buyurtmalar", callback_data="adm_orders_new")
        ],
        [
            InlineKeyboardButton(text="🍽 Menyu", callback_data="adm_menu"),
            InlineKeyboardButton(text="👥 Foydalanuvchilar", callback_data="adm_users")
        ],
        [
            InlineKeyboardButton(text="🎟 Kuponlar", callback_data="adm_coupons"),
            InlineKeyboardButton(text="📢 Xabar yuborish", callback_data="adm_broadcast")
        ]
    ])
    
    await message.answer(
        "🍔 <b>FOOOD CITY — Admin Panel</b>\n\n"
        "Boshqarish uchun bo'limni tanlang:",
        parse_mode="HTML",
        reply_markup=kb
    )

# --- STATISTICS ---
@router.callback_query(F.data == "adm_stats")
async def adm_stats(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    await call.answer()
    
    today_str = date.today().isoformat()
    
    # Run all stats queries in threads
    today_res = await asyncio.to_thread(lambda: db.client.table('daily_stats').select('*').eq('date', today_str).execute())
    total_users = await asyncio.to_thread(lambda: db.client.table('users').select('id', count='exact').execute())
    total_orders = await asyncio.to_thread(lambda: db.client.table('orders').select('id', count='exact').execute())
    top_items = await asyncio.to_thread(lambda: db.client.table('menu_items').select('name_uz, total_ordered').eq('is_deleted', False).order('total_ordered', desc=True).limit(3).execute())
    
    stats = today_res.data[0] if today_res.data else {'total_orders': 0, 'total_revenue': 0}
    
    top_text = '\n'.join([f"{i+1}. {item['name_uz']} — {item['total_ordered']} marta" for i, item in enumerate(top_items.data)]) if top_items.data else "Ma'lumot yo'q"
    
    text = (
        f"📊 <b>Statistika</b>\n\n"
        f"📅 <b>Bugun:</b>\n"
        f"• Buyurtmalar: {stats.get('total_orders', 0)} ta\n"
        f"• Daromad: {stats.get('total_revenue', 0):,} so'm\n\n"
        f"📈 <b>Jami:</b>\n"
        f"• Foydalanuvchilar: {total_users.count or 0} ta\n"
        f"• Barcha buyurtmalar: {total_orders.count or 0} ta\n\n"
        f"🏆 <b>Top mahsulotlar:</b>\n{top_text}"
    )
    
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_main")]]))

# --- ORDERS LIST ---
@router.callback_query(F.data.startswith("adm_orders_"))
async def adm_orders(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    await call.answer()
    
    status = call.data.replace("adm_orders_", "")
    status_labels = {'new': '🆕 Yangi', 'confirmed': '✅ Tasdiqlangan', 'cooking': '👨🍳 Tayyorlanmoqda', 'delivering': '🛵 Yo\'lda', 'delivered': '✅ Yetkazildi', 'cancelled': '❌ Bekor qilingan'}
    
    orders = await asyncio.to_thread(lambda: db.client.table('orders').select('*, users(full_name, username)').eq('status', status).order('created_at', desc=True).limit(10).execute())
    
    filter_buttons = [
        [InlineKeyboardButton(text="🆕 Yangi", callback_data="adm_orders_new"), InlineKeyboardButton(text="👨🍳 Jarayonda", callback_data="adm_orders_cooking"), InlineKeyboardButton(text="🛵 Yo'lda", callback_data="adm_orders_delivering")],
        [InlineKeyboardButton(text="✅ Bajarilgan", callback_data="adm_orders_delivered"), InlineKeyboardButton(text="❌ Bekor", callback_data="adm_orders_cancelled")]
    ]
    
    order_buttons = []
    if orders.data:
        for order in orders.data:
            name = (order.get('users') or {}).get('full_name', 'Noma\'lum')
            order_buttons.append([InlineKeyboardButton(text=f"{order['id']} — {order['total']:,} so'm — {name}", callback_data=f"adm_order_{order['id'].replace('#', 'ORD')}")])
    
    msg_text = f"📦 <b>{status_labels.get(status, status)} buyurtmalar</b>\n\n" + ("Buyurtma tanlang:" if orders.data else "Hozircha buyurtma yo'q.")
    
    await call.message.edit_text(msg_text, reply_markup=InlineKeyboardMarkup(inline_keyboard=order_buttons + filter_buttons + [[InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_main")]]))

# --- ORDER DETAIL ---
@router.callback_query(F.data.startswith("adm_order_"))
async def adm_order_detail(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    await call.answer()
    
    order_id = '#' + call.data.replace("adm_order_ORD", "")
    order_res = await asyncio.to_thread(lambda: db.client.table('orders').select('*, users(*)').eq('id', order_id).execute())
    
    if not order_res.data:
        await call.answer("Buyurtma topilmadi!", show_alert=True)
        return
    
    o = order_res.data[0]
    user = o.get('users') or {}
    items = o.get('items', []) or []
    items_text = '\n'.join([
        f"• {item.get('emoji', '🍽')} "
        f"{item.get('name_uz') or item.get('name_ru') or item.get('name', 'Taom')} "
        f"x{item.get('qty', 1)} — "
        f"{(item.get('price', 0) * item.get('qty', 1)):,} so'm"
        for item in items
    ]) if items else "Ma'lumot yo'q"
    status_map = {'new': '🆕 Yangi', 'confirmed': '✅ Tasdiqlangan', 'cooking': '👨🍳 Tayyorlanmoqda', 'delivering': '🛵 Yo\'lda', 'delivered': '✅ Yetkazildi', 'cancelled': '❌ Bekor qilingan'}
    
    unknown = "Noma'lum"
    no_val = "Yo'q"
    u_name = user.get('full_name', unknown)
    u_user = user.get('username', no_val)
    o_address = o.get('delivery_address', no_val)
    o_note = o.get('note', no_val)
    
    text = (
        f"🔖 <b>Buyurtma {o['id']}</b>\n\n"
        f"👤 <b>Mijoz:</b> {u_name} (@{u_user})\n"
        f"🆔 <b>ID:</b> <code>{user.get('id', '')}</code>\n\n"
        f"📦 <b>Tarkib:</b>\n{items_text}\n\n"
        f"🚚 Yetkazib berish: {o.get('delivery_fee', 0):,} so'm\n"
        f"💰 <b>Jami: {o.get('total', 0):,} so'm</b>\n\n"
        f"📍 <b>Manzil:</b> {o_address}\n"
        f"📝 <b>Izoh:</b> {o_note}\n\n"
        f"📊 <b>Status:</b> {status_map.get(o['status'], o['status'])}"
    )
    
    actions = []
    s = o['status']
    if s == 'new':
        actions.append([InlineKeyboardButton(text="✅ Tasdiqlash", callback_data=f"adm_status_{o['id'].replace('#','ORD')}_confirmed"), InlineKeyboardButton(text="❌ Bekor qilish", callback_data=f"adm_status_{o['id'].replace('#','ORD')}_cancelled")])
    elif s == 'confirmed':
        actions.append([InlineKeyboardButton(text="👨🍳 Tayyorlanmoqda", callback_data=f"adm_status_{o['id'].replace('#','ORD')}_cooking")])
    elif s == 'cooking':
        actions.append([InlineKeyboardButton(text="🛵 Yo'lda", callback_data=f"adm_status_{o['id'].replace('#','ORD')}_delivering")])
    elif s == 'delivering':
        actions.append([InlineKeyboardButton(text="✅ Yetkazildi", callback_data=f"adm_status_{o['id'].replace('#','ORD')}_delivered")])
    
    actions.append([InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_orders_new")])
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=actions))

# --- STATUS UPDATE ---
@router.callback_query(F.data.startswith("adm_status_"))
async def adm_update_status(call: CallbackQuery, bot: Bot, **kwargs):
    if not await is_admin(call.from_user.id): return
    
    parts = call.data.split("_")
    new_status = parts[-1]
    order_id = '#' + call.data.replace("adm_status_", "").replace(f"_{new_status}", "").replace("ORD", "")
    
    await asyncio.to_thread(lambda: db.client.table('orders').update({'status': new_status}).eq('id', order_id).execute())
    
    # Notify User
    order_res = await asyncio.to_thread(lambda: db.client.table('orders').select('user_id').eq('id', order_id).execute())
    if order_res.data:
        u_id = order_res.data[0]['user_id']
        msgs = {
            'confirmed': f"✅ Buyurtmangiz tasdiqlandi!\n\n🔖 {order_id}\n⏱ Taxminan 30-45 daqiqada yetkazamiz",
            'cooking': f"👨🍳 Buyurtmangiz tayyorlanmoqda!\n\n🔖 {order_id}\n🍳 Oshpazimiz ishlayapti...",
            'delivering': f"🛵 Kuryer yo'lda!\n\n🔖 {order_id}\n📍 Tez orada yetib keladi",
            'delivered': f"✅ Buyurtma yetkazildi!\n\n🔖 {order_id}\n\n⭐ Xizmatimizdan mamnunmisiz?\nBaholang:",
            'cancelled': f"❌ Buyurtma bekor qilindi\n\n🔖 {order_id}\n\nUzr so'raymiz. Sabab: Qabul qilinmadi\n\nQayta buyurtma berish uchun:"
        }
        
        from aiogram.types import WebAppInfo
        
        reply_markup = None
        if new_status == 'delivered':
            reply_markup = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⭐⭐⭐⭐⭐ Ajoyib!", callback_data=f"rate_{order_id.replace('#', 'ORD')}_5")],
                [InlineKeyboardButton(text="👍 Yaxshi", callback_data=f"rate_{order_id.replace('#', 'ORD')}_4")],
                [InlineKeyboardButton(text="👎 Yomonlashtirilsin", callback_data=f"rate_{order_id.replace('#', 'ORD')}_1")]
            ])
        elif new_status == 'cancelled':
            reply_markup = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🍔 Yangi buyurtma", web_app=WebAppInfo(url=config.MINI_APP_URL))]
            ])
            
        try: await bot.send_message(u_id, msgs.get(new_status, new_status), reply_markup=reply_markup)
        except: pass
    
    await call.answer("Status yangilandi!")
    fake_call = FakeCall(call, f"adm_order_{order_id.replace('#', 'ORD')}")
    await adm_order_detail(fake_call)

@router.callback_query(F.data.startswith("rate_"))
async def handle_rating(call: CallbackQuery, bot: Bot, **kwargs):
    parts = call.data.split("_")
    rating = int(parts[-1])
    order_id = '#' + call.data.replace(f"rate_", "").replace(f"_{rating}", "").replace("ORD", "")
    
    # Save rating
    await asyncio.to_thread(lambda: db.client.table('orders').update({'rating': rating}).eq('id', order_id).execute())
    
    await call.message.edit_text(f"✅ Buyurtma yetkazildi!\n\n🔖 {order_id}\n\n⭐ Bahoyingiz: {rating}/5. Rahmat!")
    
    if rating <= 2:
        await call.message.answer("Uzr! Muammoni hal qilamiz")
        admin_text = f"⚠️ <b>Past baho!</b>\n\n🔖 Buyurtma: {order_id}\n⭐ Baho: {rating}\n👤 Mijoz ID: {call.from_user.id}"
        if config.ADMIN_CHAT_ID:
            try: await bot.send_message(config.ADMIN_CHAT_ID, admin_text, parse_mode="HTML")
            except: pass

# --- MENU MANAGEMENT ---
@router.callback_query(F.data == "adm_menu")
async def adm_menu(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    await call.answer()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Yangi taom", callback_data="adm_menu_add")],
        [InlineKeyboardButton(text="📋 Ro'yxat", callback_data="adm_menu_list_0")],
        [InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_main")]
    ])
    await call.message.edit_text("🍽 <b>Menyu boshqaruvi</b>", reply_markup=kb)

@router.callback_query(F.data.startswith("adm_menu_list_"))
async def adm_menu_list(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    await call.answer()
    page = int(call.data.replace("adm_menu_list_", ""))
    items = await asyncio.to_thread(lambda: db.client.table('menu_items').select('*').eq('is_deleted', False).order('sort_order').range(page*8, (page+1)*8 - 1).execute())
    
    buttons = []
    for i in items.data:
        buttons.append([InlineKeyboardButton(text=f"{i['emoji']} {i['name_uz']} — {i['price']:,} so'm", callback_data=f"adm_item_{i['id'][:8]}")])
    
    nav = []
    if page > 0: nav.append(InlineKeyboardButton(text="◀️", callback_data=f"adm_menu_list_{page-1}"))
    if len(items.data) == 8: nav.append(InlineKeyboardButton(text="▶️", callback_data=f"adm_menu_list_{page+1}"))
    if nav: buttons.append(nav)
    
    buttons.append([InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_menu")])
    await call.message.edit_text("📋 <b>Taomlar:</b>", reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))

@router.callback_query(F.data.startswith("adm_imgup_"))
async def adm_image_upload_start(call: CallbackQuery, state: FSMContext, **kwargs):
    if not await is_admin(call.from_user.id):
        return
    short_id = call.data.replace("adm_imgup_", "")
    # fetch full menu item to get product_code
    res = await asyncio.to_thread(lambda: db.client.table('menu_items').select('id, product_code').like('id', f"{short_id}%").execute())
    if not res.data:
        await call.answer("Item not found", show_alert=True)
        return
    item = res.data[0]
    # store context in FSM
    await state.set_state(ImageUploadStates.waiting_photo)
    await state.update_data(
        menu_item_id=item['id'],
        product_code=item['product_code'],
        admin_user_id=call.from_user.id,
    )
    await call.answer()
    await call.message.edit_text("📷 Iltimos, rasmini yuboring (photo).", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Bekor qilish", callback_data="adm_main")]]))

@router.message(F.content_type == ContentType.PHOTO, ImageUploadStates.waiting_photo)
async def adm_image_received(message: Message, state: FSMContext, bot: Bot, **kwargs):
    data = await state.get_data()
    # ensure same admin user
    if message.from_user.id != data.get('admin_user_id'):
        await message.answer("Bu tasvir sizga emas.")
        return
    # get highest resolution photo
    photo = message.photo[-1]
    file = await bot.get_file(photo.file_id)
    raw_bytes = await bot.download_file(file.file_path)
    try:
        result = await ImageService.upload_product_image(
            product_code=data['product_code'],
            raw_bytes=raw_bytes,
            uploaded_by=data['admin_user_id'],
        )
    except ImageServiceError as e:
        await message.answer(f"❌ Xatolik: {e}")
        await state.clear()
        return
    if result.was_duplicate:
        await message.answer("⚠️ Tasvir takroriy, yangilanish qilinmadi.")
    else:
        await message.answer(f"✅ Tasvir yuklandi.\nMain: {result.main_url}\nThumb: {result.thumb_url}")
    await state.clear()
    # return to item detail view
    fake_call = FakeCall(message, f"adm_item_{data['menu_item_id'][:8]}")
    await adm_item_detail(fake_call)

@router.callback_query(F.data.startswith("adm_item_"))
async def adm_item_detail(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    await call.answer()
    short_id = call.data.replace("adm_item_", "")
    res = await asyncio.to_thread(lambda: db.client.table('menu_items').select('*').eq('is_deleted', False).like('id', f"{short_id}%").execute())
    if not res.data: return
    
    i = res.data[0]
    status_text = "✅ Faol" if i['is_available'] else "❌ O'chirilgan"
    text = f"{i['emoji']} <b>{i['name_uz']}</b>\n\nNarx: {i['price']:,} so'm\nStatus: {status_text}"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Toggle Status", callback_data=f"adm_toggle_{i['id'][:8]}")],
        [InlineKeyboardButton(text="🗑 O'chirish", callback_data=f"adm_delete_{i['id'][:8]}")],
        [InlineKeyboardButton(text="📷 Rasm yuklash", callback_data=f"adm_imgup_{i['id'][:8]}")],
        [InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_menu_list_0")]
    ])
    await call.message.edit_text(text, reply_markup=kb)

@router.callback_query(F.data.startswith("adm_toggle_"))
async def adm_toggle_item(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    short_id = call.data.replace("adm_toggle_", "")
    res = await asyncio.to_thread(lambda: db.client.table('menu_items').select('id, is_available').eq('is_deleted', False).like('id', f"{short_id}%").execute())
    if res.data:
        new_val = not res.data[0]['is_available']
        await asyncio.to_thread(lambda: db.client.table('menu_items').update({'is_available': new_val}).eq('id', res.data[0]['id']).execute())
    await call.answer("O'zgartirildi!")
    fake_call = FakeCall(call, f"adm_item_{short_id}")
    await adm_item_detail(fake_call)

@router.callback_query(F.data.startswith("adm_delete_"))
async def adm_delete_item(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    short_id = call.data.replace("adm_delete_", "")
    res = await asyncio.to_thread(lambda: db.client.table('menu_items').select('id, name_uz').eq('is_deleted', False).like('id', f"{short_id}%").execute())
    if not res.data: return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Ha", callback_data=f"adm_delconf_{short_id}"), InlineKeyboardButton(text="Yo'q", callback_data=f"adm_item_{short_id}")]])
    await call.message.edit_text(f"🗑 {res.data[0]['name_uz']}ni o'chirasizmi?", reply_markup=kb)

@router.callback_query(F.data.startswith("adm_delconf_"))
async def adm_delconf(call: CallbackQuery, **kwargs):
    short_id = call.data.replace("adm_delconf_", "")
    res = await asyncio.to_thread(lambda: db.client.table('menu_items').select('id').eq('is_deleted', False).like('id', f"{short_id}%").execute())
    if res.data:
        await db.delete_menu_item(res.data[0]['id'])
    await call.answer("O'chirildi!")
    fake_call = FakeCall(call, "adm_menu_list_0")
    await adm_menu_list(fake_call)

# --- MENU ADD FSM ---
@router.callback_query(F.data == "adm_menu_add")
async def adm_add_start(call: CallbackQuery, state: FSMContext, **kwargs):
    if not await is_admin(call.from_user.id): return
    cats = await db.get_categories(active_only=True)
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{c['emoji']} {c['name_uz']}", callback_data=f"adm_cat_{c['id']}")] for c in cats])
    await state.set_state(MenuAddStates.category)
    await call.message.edit_text("1️⃣ Kategoriyani tanlang:", reply_markup=kb)

@router.callback_query(F.data.startswith("adm_cat_"), MenuAddStates.category)
async def adm_add_cat(call: CallbackQuery, state: FSMContext, **kwargs):
    await state.update_data(category_id=call.data.replace("adm_cat_", ""))
    await state.set_state(MenuAddStates.name_uz)
    await call.message.answer("2️⃣ Nomi (UZ):")

@router.message(MenuAddStates.name_uz)
async def adm_add_nuz(message: Message, state: FSMContext, **kwargs):
    await state.update_data(name_uz=message.text, name_ru=message.text, name_en=message.text) # Simplified for brevity
    await state.set_state(MenuAddStates.desc_uz)
    await message.answer("3️⃣ Tavsif (UZ):")

@router.message(MenuAddStates.desc_uz)
async def adm_add_duz(message: Message, state: FSMContext, **kwargs):
    await state.update_data(desc_uz=message.text, desc_ru=message.text, desc_en=message.text)
    await state.set_state(MenuAddStates.price)
    await message.answer("4️⃣ Narx (faqat raqam):")

@router.message(MenuAddStates.price)
async def adm_add_pr(message: Message, state: FSMContext, **kwargs):
    try: price = int(message.text.strip())
    except: return await message.answer("Raqam yozing!")
    await state.update_data(price=price)
    await state.set_state(MenuAddStates.emoji)
    await message.answer("5️⃣ Emoji (1 ta):")

@router.message(MenuAddStates.emoji)
async def adm_add_em(message: Message, state: FSMContext, **kwargs):
    await state.update_data(emoji=message.text[:2])
    data = await state.get_data()
    text = f"Ko'rib chiqing:\n{data['emoji']} {data['name_uz']}\nNarx: {data['price']:,}"
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Saqlash", callback_data="adm_msave"), InlineKeyboardButton(text="Bekor", callback_data="adm_menu")]])
    await state.set_state(MenuAddStates.confirm)
    await message.answer(text, reply_markup=kb)

@router.callback_query(F.data == "adm_msave", MenuAddStates.confirm)
async def adm_msave(call: CallbackQuery, state: FSMContext, **kwargs):
    d = await state.get_data()
    item = {'id': str(uuid.uuid4()), 'category_id': d['category_id'], 'name_uz': d['name_uz'], 'name_ru': d['name_ru'], 'name_en': d['name_en'], 'description_uz': d['desc_uz'], 'description_ru': d['desc_ru'], 'description_en': d['desc_en'], 'price': d['price'], 'emoji': d['emoji'], 'is_available': True, 'sort_order': 99}
    await db.add_menu_item(item)
    await state.clear()
    await call.answer("Saqlandi!")
    fake_call = FakeCall(call, "adm_menu")
    await adm_menu(fake_call)

# --- USERS & BLOCKS ---
@router.callback_query(F.data == "adm_users")
async def adm_users(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    users = await asyncio.to_thread(lambda: db.client.table('users').select('*').order('created_at', desc=True).limit(10).execute())
    total = await asyncio.to_thread(lambda: db.client.table('users').select('id', count='exact').execute())
    unknown = "Noma'lum"
    btns = []
    for u in users.data:
        status_icon = '🚫' if u.get('is_blocked') else '✅'
        u_name = u.get('full_name', unknown)
        btns.append([InlineKeyboardButton(text=f"{status_icon} {u_name}", callback_data=f"adm_u_{u['id']}")])
    
    btns.append([InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_main")])
    await call.message.edit_text(f"👥 Foydalanuvchilar (jami: {total.count})", reply_markup=InlineKeyboardMarkup(inline_keyboard=btns))

@router.callback_query(F.data.startswith("adm_u_"))
async def adm_user_det(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    u_id = int(call.data.replace("adm_u_", ""))
    res = await asyncio.to_thread(lambda: db.client.table('users').select('*').eq('id', u_id).execute())
    if not res.data: return
    u = res.data[0]
    status_text = "🚫 Bloklangan" if u.get('is_blocked') else "✅ Faol"
    text = f"👤 {u['full_name']}\nID: {u['id']}\nStatus: {status_text}"
    kb = [[InlineKeyboardButton(text="Bloklash/Ochish", callback_data=f"adm_ublock_{u['id']}"), InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_users")]]
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))

@router.callback_query(F.data.startswith("adm_ublock_"))
async def adm_ublock(call: CallbackQuery, **kwargs):
    u_id = int(call.data.replace("adm_ublock_", ""))
    res = await asyncio.to_thread(lambda: db.client.table('users').select('is_blocked').eq('id', u_id).execute())
    if res.data:
        new_v = not res.data[0]['is_blocked']
        await asyncio.to_thread(lambda: db.client.table('users').update({'is_blocked': new_v}).eq('id', u_id).execute())
    await call.answer("O'zgartirildi")
    fake_call = FakeCall(call, f"adm_u_{u_id}")
    await adm_user_det(fake_call)

# --- BROADCAST ---
@router.callback_query(F.data == "adm_broadcast")
async def adm_br_start(call: CallbackQuery, state: FSMContext, **kwargs):
    if not await is_admin(call.from_user.id): return
    await state.set_state(BroadcastStates.message)
    await call.message.edit_text("📢 Xabarni yozing:")

@router.message(BroadcastStates.message)
async def adm_br_msg(message: Message, state: FSMContext, **kwargs):
    await state.update_data(m=message.text)
    await state.set_state(BroadcastStates.confirm)
    await message.answer(f"Yuborishni tasdiqlaysizmi?\n\n{message.text}", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="✅ Ha", callback_data="adm_br_send"), InlineKeyboardButton(text="❌ Yo'q", callback_data="adm_main")]]))

@router.callback_query(F.data == "adm_br_send", BroadcastStates.confirm)
async def adm_br_send(call: CallbackQuery, state: FSMContext, bot: Bot, **kwargs):
    d = await state.get_data()
    msg = d['m']
    await state.clear()
    users = await asyncio.to_thread(lambda: db.client.table('users').select('id').eq('is_blocked', False).execute())
    sent = 0
    for u in users.data:
        try:
            await bot.send_message(u['id'], f"📢 <b>FOOOD CITY</b>\n\n{msg}")
            sent += 1
            if sent % 25 == 0: await asyncio.sleep(1)
        except: pass
    await call.message.answer(f"✅ {sent} ta foydalanuvchiga yuborildi.")

# --- COUPONS ---
@router.callback_query(F.data == "adm_coupons")
async def adm_coupons(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    c = await asyncio.to_thread(lambda: db.client.table('coupons').select('*').eq('is_active', True).execute())
    coupon_lines = []
    for x in c.data:
        unit = "%" if x['discount_type'] == "percent" else " sum"
        coupon_lines.append(f"• {x['code']} ({x['discount_value']}{unit})")
    
    coupons_text = "\n".join(coupon_lines) if coupon_lines else "Yo'q"
    text = f"🎟 <b>Kuponlar:</b>\n\n{coupons_text}"
    kb = [[InlineKeyboardButton(text="➕ Yangi", callback_data="adm_c_add"), InlineKeyboardButton(text="🔙 Orqaga", callback_data="adm_main")]]
    await call.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))

@router.callback_query(F.data == "adm_c_add")
async def adm_c_add(call: CallbackQuery, state: FSMContext, **kwargs):
    await state.set_state(CouponAddStates.code)
    await call.message.edit_text("🎟 Kod (masalan: HOT20):")

@router.message(CouponAddStates.code)
async def adm_c_code(message: Message, state: FSMContext, **kwargs):
    await state.update_data(code=message.text.upper())
    await state.set_state(CouponAddStates.type)
    await message.answer("Turi:", reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="%", callback_data="ctype_percent"), InlineKeyboardButton(text="Sum", callback_data="ctype_fixed")]]))

@router.callback_query(F.data.startswith("ctype_"), CouponAddStates.type)
async def adm_c_type(call: CallbackQuery, state: FSMContext, **kwargs):
    await state.update_data(t=call.data.replace("ctype_", ""))
    await state.set_state(CouponAddStates.value)
    await call.message.edit_text("Qiymat:")

@router.message(CouponAddStates.value)
async def adm_c_val(message: Message, state: FSMContext, **kwargs):
    v = int(message.text.strip())
    d = await state.get_data()
    coupon = {'id': str(uuid.uuid4()), 'code': d['code'], 'discount_type': d['t'], 'discount_value': v, 'max_uses': 100, 'used_count': 0, 'is_active': True}
    await asyncio.to_thread(lambda: db.client.table('coupons').insert(coupon).execute())
    await state.clear()
    await message.answer("Kupon saqlandi!")
    # In adm_c_val, 'call' is not available because it's handling a Message.
    # The original code did: `call.data = "adm_coupons"; await adm_coupons(call)` which is completely invalid since there's no `call`.
    # Wait, the original code had:
    # call.data = "adm_coupons"
    # await adm_coupons(call)
    # But this is a @router.message handler! 'call' was never defined here!
    # Instead, let's create a fake CallbackQuery-like object that wraps the message context to reuse adm_coupons.
    class MessageFakeCall(FakeCall):
        def __init__(self, msg, new_data):
            self.data = new_data
            self.message = msg
            self.from_user = msg.from_user
            self.id = "fake_id"
            self.bot = msg.bot
            
    fake_call = MessageFakeCall(message, "adm_coupons")
    await adm_coupons(fake_call)

# --- BACK TO MAIN ---
@router.callback_query(F.data == "adm_main")
async def adm_main(call: CallbackQuery, **kwargs):
    if not await is_admin(call.from_user.id): return
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="📊 Statistika", callback_data="adm_stats"),
            InlineKeyboardButton(text="📦 Buyurtmalar", callback_data="adm_orders_new")
        ],
        [
            InlineKeyboardButton(text="🍽 Menyu", callback_data="adm_menu"),
            InlineKeyboardButton(text="👥 Foydalanuvchilar", callback_data="adm_users")
        ],
        [
            InlineKeyboardButton(text="🎟 Kuponlar", callback_data="adm_coupons"),
            InlineKeyboardButton(text="📢 Xabar yuborish", callback_data="adm_broadcast")
        ]
    ])
    
    await call.message.edit_text(
        "🍔 <b>FOOOD CITY — Admin Panel</b>\n\n"
        "Boshqarish uchun bo'limni tanlang:",
        parse_mode="HTML",
        reply_markup=kb
    )
    await call.answer()
