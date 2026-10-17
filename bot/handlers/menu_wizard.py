from aiogram import Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from bot.database import db
from bot.middlewares.auth import admin_required
from bot.services.image_service import ImageService, ImageServiceError
import logging
import uuid

logger = logging.getLogger(__name__)

router = Router()

class MenuWizard(StatesGroup):
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

@router.message(Command("menu_add"))
@admin_required
async def start_menu_add(message: Message, state: FSMContext):
    cats = await db.get_categories(active_only=True)
    if not cats:
        await message.answer("Kategoriyalar yo'q. Oldin toifa qo'shing.")
        return
        
    kb = [[InlineKeyboardButton(text=c["name_uz"], callback_data=f"mwcat_{c['id']}")] for c in cats]
    await message.answer("Kategoriyani tanlang:", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
    await state.set_state(MenuWizard.category)

@router.callback_query(MenuWizard.category)
async def process_category(callback: CallbackQuery, state: FSMContext):
    cat_id = callback.data.split("_")[1]
    await state.update_data(category_id=cat_id)
    await callback.message.answer("Nomi (O'zbek):")
    await state.set_state(MenuWizard.name_uz)
    await callback.answer()

@router.message(MenuWizard.name_uz)
async def process_name_uz(message: Message, state: FSMContext):
    await state.update_data(name_uz=message.text)
    await message.answer("Nomi (Rus):")
    await state.set_state(MenuWizard.name_ru)

@router.message(MenuWizard.name_ru)
async def process_name_ru(message: Message, state: FSMContext):
    await state.update_data(name_ru=message.text)
    await message.answer("Nomi (Ingliz):")
    await state.set_state(MenuWizard.name_en)

@router.message(MenuWizard.name_en)
async def process_name_en(message: Message, state: FSMContext):
    await state.update_data(name_en=message.text)
    await message.answer("Tavsif (O'zbek):")
    await state.set_state(MenuWizard.desc_uz)

@router.message(MenuWizard.desc_uz)
async def process_desc_uz(message: Message, state: FSMContext):
    await state.update_data(description_uz=message.text)
    await message.answer("Tavsif (Rus):")
    await state.set_state(MenuWizard.desc_ru)

@router.message(MenuWizard.desc_ru)
async def process_desc_ru(message: Message, state: FSMContext):
    await state.update_data(description_ru=message.text)
    await message.answer("Tavsif (Ingliz):")
    await state.set_state(MenuWizard.desc_en)

@router.message(MenuWizard.desc_en)
async def process_desc_en(message: Message, state: FSMContext):
    await state.update_data(description_en=message.text)
    await message.answer("Narxi (raqam, so'mda):")
    await state.set_state(MenuWizard.price)

@router.message(MenuWizard.price)
async def process_price(message: Message, state: FSMContext):
    if not message.text.isdigit():
        await message.answer("Faqat raqam kiriting.")
        return
    await state.update_data(price=int(message.text))
    await message.answer("Emoji (1ta belgi):")
    await state.set_state(MenuWizard.emoji)

@router.message(MenuWizard.emoji)
async def process_emoji(message: Message, state: FSMContext):
    await state.update_data(emoji=message.text)
    await message.answer("Nishon (Badge, masalan '🔥 Hit') yoki /skip:")
    await state.set_state(MenuWizard.badge)

@router.message(MenuWizard.badge)
async def process_badge(message: Message, state: FSMContext):
    badge = "" if message.text == "/skip" else message.text
    await state.update_data(badge=badge)
    await message.answer("Rasm yuboring (yoki /skip):")
    await state.set_state(MenuWizard.photo)

@router.message(MenuWizard.photo)
async def handle_photo_upload(message: Message, state: FSMContext, **kwargs):
    # Rasm bu bosqichda hali yuklanmaydi — faqat xotiraga olinadi (bytes).
    # Haqiqiy yuklash (WEBP konvertatsiya, thumbnail, dedup) "Saqlash"
    # bosqichida, item DB'da yaratilib product_code olingandan KEYIN
    # ImageService orqali amalga oshiriladi — shu tarqibda web admin
    # panel bilan bir xil pipeline ishlatiladi.
    photo_bytes = None

    if message.photo:
        try:
            photo = message.photo[-1]  # largest size
            file_info = await message.bot.get_file(photo.file_id)
            file_content = await message.bot.download_file(file_info.file_path)
            photo_bytes = file_content.read() if hasattr(file_content, 'read') else bytes(file_content)
            await message.answer("✅ Rasm qabul qilindi (saqlashda ishlanadi)")
        except Exception as e:
            logger.error(f"Photo download error: {e}")
            await message.answer(f"⚠️ Rasmni yuklab bo'lmadi: {str(e)[:100]}\nDavom etamiz...")

    elif message.text and message.text.strip() == '/skip':
        await message.answer("⏭ Rasm o'tkazib yuborildi")
    else:
        await message.answer("📸 Rasm yuboring yoki /skip yozing:")
        return

    await state.update_data(photo_bytes=photo_bytes)

    # Show preview and confirm
    data = await state.get_data()
    img_status = "✅ Tayyor" if photo_bytes else "❌ Yo'q"
    badge = data.get('badge') or "Yo'q"
    price = data.get('price', 0)

    preview = (
        f"📋 <b>Ko'rib chiqing:</b>\n\n"
        f"{data.get('emoji', '🍽')} <b>{data.get('name_uz', '')}</b>\n"
        f"🇷🇺 {data.get('name_ru', '')}\n\n"
        f"📝 {data.get('desc_uz', '')}\n\n"
        f"💰 Narx: <b>{price:,} so'm</b>\n"
        f"🏷 Badge: {badge}\n"
        f"🖼 Rasm: {img_status}"
    )

    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Saqlash", callback_data="adm_menu_save"),
        InlineKeyboardButton(text="❌ Bekor", callback_data="adm_menu_cancel")
    ]])

    await state.set_state(MenuWizard.confirm)
    await message.answer(preview, parse_mode="HTML", reply_markup=kb)

@router.callback_query(MenuWizard.confirm)
async def process_confirm(callback: CallbackQuery, state: FSMContext):
    if callback.data == "adm_menu_save":
        data = await state.get_data()
        photo_bytes = data.pop('photo_bytes', None)

        item = await db.create_menu_item(data, callback.from_user.id)
        if not item:
            await callback.message.edit_text("❌ Mahsulotni saqlab bo'lmadi.")
            await state.clear()
            await callback.answer()
            return

        if photo_bytes:
            try:
                await ImageService.upload_product_image(
                    product_code=item['product_code'],
                    raw_bytes=photo_bytes,
                    uploaded_by=callback.from_user.id,
                )
                await callback.message.edit_text("✅ Saqlandi! (rasm ishlandi va yuklandi)")
            except ImageServiceError as e:
                logger.error(f"menu_wizard image upload error: {e}")
                await callback.message.edit_text(
                    f"✅ Mahsulot saqlandi, lekin rasm yuklanmadi: {e}\n"
                    f"Rasmni keyinroq mahsulot tafsilotidan qayta yuklashingiz mumkin."
                )
        else:
            await callback.message.edit_text("✅ Saqlandi!")
    else:
        await callback.message.edit_text("❌ Bekor qilindi.")
    await state.clear()
    await callback.answer()
