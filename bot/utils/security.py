import hmac
import hashlib
import json
from urllib.parse import unquote
import re
from bot.config import config

def validate_init_data(init_data_raw: str, bot_token: str) -> bool:
    try:
        parsed_data = dict(x.split('=') for x in init_data_raw.split('&'))
        hash_val = parsed_data.pop('hash', None)
        if not hash_val:
            return False
            
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        return calculated_hash == hash_val
    except Exception:
        return False

def sanitize_text(text: str, max_length: int = 500) -> str:
    if not text:
        return ""
    text = re.sub(r'<[^>]*>', '', text)
    text = " ".join(text.split())
    return text[:max_length]

def validate_order_payload(payload: dict) -> tuple[bool, str]:
    if 'items' not in payload or not payload['items']:
        return False, "Bo'sh savatcha"
    for item in payload['items']:
        if item.get('qty', 0) <= 0:
            return False, "Xato miqdor"
    if payload.get('total', 0) <= 0:
        return False, "Xato summa"
    return True, "OK"

async def recalculate_total(items_payload: list, db) -> int:
    subtotal = 0
    for item in items_payload:
        db_item = await db.get_menu_item(item['id'])
        if db_item:
            subtotal += db_item['price'] * item['qty']
    return subtotal

async def generate_unique_order_id(db) -> str:
    from datetime import date
    today_str = date.today().strftime('%y%m%d')
    # Use the same logic as database.py
    count_res = await db._run_sync(
        db.client.table('orders')
            .select('id', count='exact')
            .like('id', f'{today_str}-%')
            .execute
    )
    next_num = (count_res.count or 0) + 1
    return f"{today_str}-{next_num:03d}"

