import hmac
import hashlib
import time
import base64
import json
import logging
from aiohttp import web
from bot.config import config

logger = logging.getLogger(__name__)

TOKEN_LIFETIME = 86400  # Token muddati: 24 soat (sekundlarda)

def generate_admin_token(user_id: int, role: str) -> str:
    """Adminga HMAC yordamida vaqtinchalik xavfsiz token generatsiya qiladi."""
    payload = {
        "id": user_id,
        "role": role,
        "exp": int(time.time()) + TOKEN_LIFETIME
    }
    
    # Payload'ni Base64 formatga o'tkazish
    payload_bytes = json.dumps(payload).encode()
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode().rstrip("=")
    
    # HMAC SHA256 bilan imzolash (Maxfiy kalit sifatida BOT_TOKEN ishlatiladi)
    signature = hmac.new(
        config.BOT_TOKEN.encode(),
        payload_b64.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return f"{payload_b64}.{signature}"

def verify_admin_token_logic(token: str) -> dict | None:
    """Tokenni tekshiradi va agar to'g'ri/muddati o'tmagan bo'lsa payload'ni qaytaradi."""
    parts = token.split(".")
    if len(parts) != 2:
        return None
    
    payload_b64, signature = parts
    
    # Imzoni qayta hisoblab tekshirish
    expected_signature = hmac.new(
        config.BOT_TOKEN.encode(),
        payload_b64.encode(),
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(expected_signature, signature):
        return None
    
    try:
        # Base64 dan decode qilish (padding'ni to'g'rilab)
        padding = "=" * (4 - len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + padding)
        payload = json.loads(payload_bytes)
        
        # Muddati (Expiry) tekshiruvi
        if payload.get("exp", 0) < time.time():
            return None
            
        return payload
    except Exception as e:
        logger.error(f"Token decode xatoligi: {e}")
        return None

def extract_token(request: web.Request) -> str | None:
    """So'rovdan Bearer tokenni ajratib oladi."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ")[1]
    return None

@web.middleware
async def security_middleware(request, handler):
    """
    Barcha Aiohttp so'rovlaridan o'tadigan xavfsizlik middleware'i.
    Agar joriy token bo'lsa, request ichiga 'admin_payload' qilib saqlaydi.
    """
    token = extract_token(request)
    if token:
        payload = verify_admin_token_logic(token)
        if payload:
            request["admin_payload"] = payload
            
    return await handler(request)
