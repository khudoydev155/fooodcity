from aiogram.fsm.state import State, StatesGroup

class MenuAdd(StatesGroup):
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
    image = State()
    confirm = State()

class CouponAdd(StatesGroup):
    code = State()
    type = State()
    value = State()
    min_order = State()
    max_uses = State()
    expires_at = State()
    confirm = State()

class BroadcastState(StatesGroup):
    message = State()
    confirm = State()
