from aiogram import Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from bot.database import db
from bot.middlewares.auth import admin_required

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
async def process_photo(message: Message, state: FSMContext):
    # Skipping actual photo upload for brevity, using empty URL if skipped
    await state.update_data(image_url="")
    
    data = await state.get_data()
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Saqlash", callback_data="mwsave_yes"),
        InlineKeyboardButton(text="❌ Bekor qilish", callback_data="mwsave_no")
    ]])
    await message.answer(f"Ma'lumotlar:\n{data['name_uz']} - {data['price']} so'm\nSaqlaymizmi?", reply_markup=kb)
    await state.set_state(MenuWizard.confirm)

@router.callback_query(MenuWizard.confirm)
async def process_confirm(callback: CallbackQuery, state: FSMContext):
    if callback.data == "mwsave_yes":
        data = await state.get_data()
        await db.create_menu_item(data, callback.from_user.id)
        await callback.message.edit_text("✅ Saqlandi!")
    else:
        await callback.message.edit_text("❌ Bekor qilindi.")
    await state.clear()
    await callback.answer()
