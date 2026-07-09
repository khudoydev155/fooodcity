import hashlib
import hmac
import time
from aiohttp import web
from bot.config import config
from bot.database import db
from bot.api.router import routes
from bot.middlewares.auth import is_admin

@routes.post("/api/auth/verify")
async def verify_auth(request: web.Request):
    data = await request.json()
    hash_val = data.get('hash')
    if not hash_val:
        return web.json_response({'valid': False, 'reason': 'Missing hash'}, status=400)
        
    # 1. Verify Telegram hash
    check_data = {k: v for k, v in data.items() if k != 'hash'}
    data_check_string = '\n'.join(f"{k}={v}" for k, v in sorted(check_data.items()))
    
    secret_key = hashlib.sha256(config.BOT_TOKEN.encode()).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    if computed_hash != hash_val:
        return web.json_response({'valid': False, 'reason': 'Invalid hash'}, status=403)
        
    # 2. Check auth_date not too old (24 hours)
    auth_date = int(data.get('auth_date', 0))
    if time.time() - auth_date > 86400:
        return web.json_response({'valid': False, 'reason': 'Expired'}, status=403)
        
    # 3. Check if admin
    user_id = int(data.get('id'))
    admin_status = await is_admin(user_id)
    if not admin_status:
        return web.json_response({'valid': False, 'is_admin': False}, status=403)
        
    role = await db.get_admin_role(user_id)
    if user_id in config.SUPERADMIN_IDS:
        role = "superadmin"
        
    # 4. Generate session token
    timestamp = str(int(time.time()))
    token_str = f"{user_id}:{timestamp}"
    token = hmac.new(config.WEBHOOK_SECRET.encode(), token_str.encode(), hashlib.sha256).hexdigest()
    
    return web.json_response({
        'valid': True,
        'is_admin': True,
        'token': f"{user_id}.{timestamp}.{token}",
        'role': role
    })
