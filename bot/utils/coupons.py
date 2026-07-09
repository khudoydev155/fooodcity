from bot.database import db

async def validate_coupon_full(code: str, user_id: int, subtotal: int) -> dict:
    return await db.validate_coupon(code, user_id, subtotal)
