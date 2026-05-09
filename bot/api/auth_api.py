import hashlib
import hmac
import time
from aiohttp import web
from bot.config import config
from bot.database import db
from bot.api.router import routes

@routes.post("/api/auth/verify")
async def verify_auth(request: web.Request):
    data = await request.json()
    hash_str = data.pop("hash", None)
    if not hash_str:
        return web.json_response({"valid": False}, status=400)
        
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(config.BOT_TOKEN.encode()).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    if calculated_hash != hash_str:
        return web.json_response({"valid": False}, status=403)
        
    user_id = int(data.get("id"))
    is_admin = await db.is_admin(user_id)
    if not is_admin:
        return web.json_response({"valid": False, "role": "none"})
        
    role = await db.get_admin_role(user_id)
    
    # Generate token
    timestamp = str(int(time.time()))
    token = hmac.new(config.WEBHOOK_SECRET.encode(), f"{user_id}{timestamp}".encode(), hashlib.sha256).hexdigest()
    
    return web.json_response({"valid": True, "role": role, "token": f"{user_id}.{timestamp}.{token}"})
