import asyncio
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl
from aiohttp import web
from bot.config import config
from bot.database import db
import logging
logger = logging.getLogger(__name__)
from decimal import Decimal, ROUND_HALF_UP

async def generate_order_id() -> str:
    from datetime import date
    today = date.today().strftime('%y%m%d')  # e.g. "250516"
    
    # Count today's orders
    result = await asyncio.to_thread(
        lambda: db.client.table('orders')
            .select('id', count='exact')
            .like('id', f'{today}-%')
            .execute()
    )
    
    next_num = (result.count or 0) + 1
    order_id = f"{today}-{next_num:03d}"  # e.g. "250516-001"
    
    return order_id


routes = web.RouteTableDef()

# initData eng ko'pi bilan shu muddat davomida haqiqiy hisoblanadi (replay hujumidan himoya)
INIT_DATA_MAX_AGE = 86400  # 24 soat

def validate_init_data(init_data: str, bot_token: str) -> bool:
    """Validates data received from the Telegram Mini App."""
    try:
        if not init_data:
            logger.warning("validate_init_data: init_data is empty")
            return False
            
        vals = dict(parse_qsl(init_data))
        if 'hash' not in vals:
            logger.warning("validate_init_data: 'hash' missing in init_data")
            return False
            
        hash_str = vals.pop('hash')
        data_check_str = '\n'.join(f'{k}={v}' for k, v in sorted(vals.items()))

        bot_token = bot_token.strip()
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calc_hash = hmac.new(secret_key, data_check_str.encode(), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(calc_hash, hash_str):
            logger.warning(f"validate_init_data: Hash mismatch! calc={calc_hash} vs hash={hash_str}. Token prefix: {bot_token[:10]}")
            return False

        auth_date = int(vals.get('auth_date', 0))
        if auth_date and (time.time() - auth_date) > INIT_DATA_MAX_AGE:
            logger.warning(f"validate_init_data: auth_date too old! auth_date={auth_date}, now={time.time()}")
            return False

        return True
    except Exception as e:
        logger.error(f"validate_init_data Exception: {e}")
        return False

def get_verified_user_id(request: web.Request) -> int | None:
    """
    X-TG-Init-Data sarlavhasini tasdiqlab, ichidan user_id ni qaytaradi.
    Query param'dagi user_id'ga ISHONMAYDI — IDOR hujumining oldini oladi.
    """
    init_data = request.headers.get("X-TG-Init-Data", "")
    if not init_data or not validate_init_data(init_data, config.BOT_TOKEN):
        return None
    try:
        init_vals = dict(parse_qsl(init_data))
        user_info = json.loads(init_vals.get("user", "{}"))
        uid = user_info.get("id")
        return int(uid) if uid else None
    except Exception:
        return None

@routes.get("/api/menu")
async def get_public_menu(request: web.Request):
    items = await db.get_public_menu()
    return web.json_response(items)

@routes.get("/api/menu/categories")
async def get_categories(request: web.Request):
    try:
        res = await db._run_sync(db.client.table("categories").select("*").execute)
        return web.json_response(res.data)
    except: return web.json_response([])

@routes.get("/api/user/orders")
async def get_user_orders(request: web.Request):
    # user_id faqat tasdiqlangan initData'dan olinadi (query param'ga ishonmaymiz)
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        orders = await db.get_user_orders(user_id)
        return web.json_response(orders)
    except Exception:
        return web.json_response([])

@routes.get("/api/user/profile")
async def get_user_profile(request: web.Request):
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        result = await asyncio.to_thread(
            lambda: db.client.table('users')
                .select('loyalty_points, total_orders, total_spent')
                .eq('id', user_id)
                .execute()
        )
        if result.data:
            return web.json_response(result.data[0])
        return web.json_response({})
    except Exception:
        return web.json_response({})

@routes.get("/api/order/{order_id}/status")
async def get_order_status(request: web.Request):
    order_id = request.match_info.get('order_id', '')
    
    # Try different ID formats
    # Remove # if present
    clean_id = order_id.replace('%23', '').replace('#', '')
    
    # Try with # prefix first (new format: #260515-001)
    result = await asyncio.to_thread(
        lambda: db.client.table('orders')
            .select('id, status, created_at, updated_at')
            .eq('id', '#' + clean_id)
            .execute()
    )
    
    # If not found, try without # (old format)
    if not result.data:
        result = await asyncio.to_thread(
            lambda: db.client.table('orders')
                .select('id, status, created_at, updated_at')
                .eq('id', clean_id)
                .execute()
        )
    
    if result.data:
        return web.json_response(result.data[0])

    return web.json_response({'error': 'Order not found'}, status=404)

@routes.post("/api/order/{order_id}/rate")
async def rate_order_api(request: web.Request):
    """Mijoz yetkazilgan buyurtmani 1-5 yulduz bilan baholaydi."""
    order_id = request.match_info.get('order_id', '')
    clean_id = order_id.replace('%23', '').replace('#', '')

    # user_id tasdiqlangan initData'dan olinadi (body'dagi user_id soxta bo'lishi mumkin)
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    try:
        data = await request.json()
        rating = int(data.get('rating', 0))
    except Exception:
        return web.json_response({'error': 'Invalid payload'}, status=400)

    if rating < 1 or rating > 5:
        return web.json_response({'error': 'Rating must be 1-5'}, status=400)

    try:
        # Ikkala ID formatini ham qo'llab-quvvatlaymiz (status endpointidagidek)
        for oid in ('#' + clean_id, clean_id):
            result = await asyncio.to_thread(
                lambda oid=oid: db.client.table('orders')
                    .update({'rating': rating})
                    .eq('id', oid)
                    .eq('user_id', user_id)  # faqat o'z buyurtmasini baholay oladi
                    .execute()
            )
            if result.data:
                return web.json_response({'success': True, 'rating': rating})

        return web.json_response({'error': 'Order not found'}, status=404)
    except Exception as e:
        logger.error(f"Rate order error: {e}")
        return web.json_response({'error': str(e)}, status=500)

async def validate_coupon_for_order(coupon_code, user_id, subtotal):
    if not coupon_code:
        return 0, None
    
    try:
        # Get coupon
        coupon = await db._run_sync(db.client.table('coupons')
            .select('*')
            .eq('code', coupon_code.upper())
            .eq('is_active', True)
            .execute)
        
        if not coupon.data:
            return 0, "Kupon topilmadi"
        
        c = coupon.data[0]
        
        # Check expiry
        if c.get('valid_until'):
            from datetime import datetime, timezone
            expiry = datetime.fromisoformat(c['valid_until'].replace('Z', '+00:00'))
            if datetime.now(timezone.utc) > expiry:
                return 0, "Kupon muddati tugagan"
        
        # Check max uses
        if c['used_count'] >= c['max_uses']:
            return 0, "Kupon limiti tugagan"
        
        # Check min order
        if subtotal < c.get('min_order_amount', 0):
            return 0, f"Minimum buyurtma: {c['min_order_amount']:,} so'm"
        
        # Check if user already used this coupon (if table exists)
        try:
            used = await db._run_sync(db.client.table('coupon_usage')
                .select('id')
                .eq('coupon_id', c['id'])
                .eq('user_id', user_id)
                .execute)
            
            if used.data:
                return 0, "Siz bu kuponni allaqachon ishlatgansiz"
        except: pass # Table might not exist yet
        
        # Calculate discount
        if c['discount_type'] == 'percent':
            discount = int(subtotal * c['discount_value'] / 100)
        else:
            discount = c['discount_value']
        
        return discount, None
        
    except Exception as e:
        return 0, f"Kupon tekshirishda xatolik: {str(e)}"

@routes.post("/api/coupon/validate")
async def validate_coupon_api(request: web.Request):
    try:
        data = await request.json()
        coupon_code = data.get('code')
        user_id = data.get('user_id')
        subtotal = data.get('subtotal', 0)
        
        if not coupon_code or not user_id:
            return web.json_response({"valid": False, "error": "Kod yoki foydalanuvchi xato"})
            
        discount, error = await validate_coupon_for_order(coupon_code, int(user_id), float(subtotal))
        if error:
            return web.json_response({"valid": False, "error": error})
            
        # Get coupon type and value
        coupon = await db._run_sync(db.client.table('coupons').select('discount_type, discount_value').eq('code', coupon_code.upper()).execute)
        c_data = coupon.data[0] if coupon.data else {}
            
        return web.json_response({
            "valid": True,
            "discount": discount,
            "coupon": {
                "code": coupon_code.upper(),
                "discount_type": c_data.get('discount_type'),
                "discount_value": c_data.get('discount_value')
            }
        })

    except Exception as e:
        return web.json_response({"valid": False, "error": str(e)}, status=500)

@routes.post("/api/orders")
async def create_order_api(request: web.Request):
    # 0. Kill-Switch Check: System settings dan bot holati tekshiriladi
    try:
        sys_res = await db._run_sync(
            db.client.table("system_settings").select("is_active,bot_disabled_message")
            .eq("id", "foodcity_bot").single().execute
        )
        if sys_res.data and not sys_res.data.get("is_active", True):
            msg = sys_res.data.get("bot_disabled_message", "Xizmat ko'rsatish vaqtincha to'xtatilgan.")
            return web.json_response({"error": msg}, status=403)
    except Exception as e:
        logger.warning("Kill-switch check failed (allowing): %s", e)

    # 1-2. Security Check: initData tasdiqlanadi va user_id undan olinadi
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized: Invalid Telegram initData"}, status=401)

    # 3. Process Order
    try:
        payload = await request.json()
        # Coupon Validation
        coupon_code = payload.get("coupon_code")
        calculated_subtotal = 0
        for item in payload.get("items", []):
            db_item = await db.get_menu_item(item["id"])
            if db_item:
                price = int(float(db_item["price"]))
                qty = int(float(item["qty"]))
                calculated_subtotal += price * qty
        calculated_subtotal = int(float(calculated_subtotal))
        # Compare with frontend subtotal if provided
        frontend_subtotal = Decimal(str(payload.get('subtotal', 0)))
        if calculated_subtotal != frontend_subtotal:
            logger.error(
                "Price mismatch: frontend subtotal %s != calculated subtotal %s (user %s)",
                frontend_subtotal,
                calculated_subtotal,
                user_id,
            )

        discount, coupon_error = await validate_coupon_for_order(coupon_code, user_id, float(calculated_subtotal))
        if coupon_error:
            return web.json_response({"error": coupon_error}, status=400)

        payload["discount"] = discount
        # Attempt to create the order in DB
        order = await db.create_order(user_id, payload)

        if not order:
            # Detailed logging of mismatch
            logger.error(
                "Order creation failed due to price mismatch. User ID: %s, Frontend subtotal: %s, Calculated subtotal: %s, Discount: %s, Payload: %s",
                user_id,
                payload.get("subtotal"),
                calculated_subtotal,
                discount,
                payload,
            )
            return web.json_response({"error": "Order creation failed (Price mismatch or DB error)"}, status=400)

        return web.json_response({"success": True, "order": order})
    except Exception as e:
        # Log full exception details (e.g., NUMERIC type errors)
        logger.exception("Exception during order creation: %s", e)
        return web.json_response({"error": str(e)}, status=500)

def validate_login_data(data: dict, bot_token: str) -> bool:
    """Validates data received from the Telegram Login Widget."""
    try:
        check_hash = data.pop('hash')
        data_check_str = '\n'.join(f'{k}={v}' for k, v in sorted(data.items()))
        secret_key = hashlib.sha256(bot_token.encode()).digest()
        calc_hash = hmac.new(secret_key, data_check_str.encode(), hashlib.sha256).hexdigest()
        return calc_hash == check_hash
    except: return False

from bot.api.security import generate_admin_token, extract_token, verify_admin_token_logic

@routes.post("/api/auth/verify")
async def verify_auth(request: web.Request):
    data = await request.json()
    if not validate_login_data(data.copy(), config.BOT_TOKEN):
        return web.json_response({"valid": False, "reason": "Invalid hash"}, status=401)
    
    user_id = int(data.get('id'))
    role = await db.get_admin_role(user_id)
    if not role:
        return web.json_response({"valid": True, "is_admin": False}, status=403)
        
    token = generate_admin_token(user_id, role)
    return web.json_response({
        "valid": True, 
        "is_admin": True, 
        "role": role,
        "token": token
    })

@routes.post("/api/auth/pin")
async def verify_pin(request: web.Request):
    data = await request.json()
    pin = str(data.get('pin', ''))

    # Xavfsizlik: standart/bo'sh PIN bilan kirishni bloklaymiz.
    # .env da ADMIN_PIN o'rnatilmagan bo'lsa (default "123456"), PIN login o'chiq turadi.
    if not config.ADMIN_PIN or config.ADMIN_PIN == "123456":
        logger.warning("PIN login bloklandi: ADMIN_PIN .env da xavfsiz qiymatga o'rnatilmagan")
        return web.json_response(
            {"valid": False, "reason": "PIN login o'chirilgan. Administrator bilan bog'laning."},
            status=403
        )

    # Doimiy-vaqt (timing-safe) solishtirish — PIN ni brute-force vaqt tahlilidan himoya qiladi
    if hmac.compare_digest(pin, config.ADMIN_PIN):
        token = generate_admin_token(0, "superadmin")
        return web.json_response({
            "valid": True,
            "is_admin": True,
            "role": "superadmin",
            "token": token
        })
    return web.json_response({"valid": False, "reason": "Noto'g'ri PIN kod"}, status=401)

def verify_admin_token(request):
    token = extract_token(request)
    if not token:
        return False
    payload = verify_admin_token_logic(token)
    return payload is not None

def check_auth(request):
    return verify_admin_token(request)


@routes.get("/api/admin/stats")
async def get_admin_stats_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    stats = await db.get_admin_stats()
    return web.json_response(stats)

@routes.get("/api/admin/orders")
async def get_admin_orders_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    status = request.query.get("status")
    search = request.query.get("search")
    orders = await db.get_admin_orders(status=status, search=search)
    return web.json_response(orders)

@routes.post("/api/admin/orders/{id}/status")
async def update_order_status_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    order_id = request.match_info['id']
    data = await request.json()
    success = await db.update_order_status(order_id, data.get('status'))
    return web.json_response({"success": success})

@routes.get("/api/admin/menu")
async def get_admin_menu_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    menu = await db.get_all_menu()
    return web.json_response(menu)

@routes.post("/api/admin/menu")
async def add_menu_item_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    import uuid
    
    # Build complete item with all required fields
    new_item = {
        'id': str(uuid.uuid4()),
        'category_id': data.get('category_id'),
        'name_uz': data.get('name_uz') or data.get('name', ''),
        'name_ru': data.get('name_ru') or data.get('name', ''),
        'name_en': data.get('name_en') or data.get('name', ''),
        'description_uz': data.get('description_uz') or data.get('description', ''),
        'description_ru': data.get('description_ru') or data.get('description', ''),
        'description_en': data.get('description_en') or data.get('description', ''),
        'price': int(data.get('price', 0)),
        'emoji': data.get('emoji', '🍽'),
        'badge': data.get('badge', ''),
        'image_url': data.get('image_url'),
        'is_available': data.get('is_available', True),
        'sort_order': int(data.get('sort_order', 99)),
        'total_ordered': 0
    }
    
    # Validate required fields
    if not new_item['name_uz']:
        return web.json_response({'error': 'Name is required'}, status=400)
    if not new_item['price'] or new_item['price'] <= 0:
        return web.json_response({'error': 'Valid price is required'}, status=400)
    if not new_item['category_id']:
        return web.json_response({'error': 'Category is required'}, status=400)
    
    item = await db.add_menu_item(new_item)
    if item:
        return web.json_response(item)
    else:
        return web.json_response({'error': 'Failed to create item'}, status=500)

@routes.put("/api/admin/menu/{id}")
async def update_menu_item_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    item_id = request.match_info['id']
    data = await request.json()
    item = await db.update_menu_item(item_id, data)
    return web.json_response(item)

@routes.delete("/api/admin/menu/{id}")
async def delete_menu_item_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    item_id = request.match_info['id']
    success = await db.delete_menu_item(item_id)
    return web.json_response({"success": success})

# ---------------------------------------------------------------------------
# IMAGE UPLOAD — POST /api/admin/menu/{id}/image
# Production-grade multipart image upload with full pipeline integration.
# ---------------------------------------------------------------------------
MAX_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024  # 12 MiB hard cap

@routes.post("/api/admin/menu/{id}/image")
async def upload_menu_image_api(request: web.Request):
    """Accept a multipart/form-data upload with field name 'image'.

    Pipeline:
        1. Auth check (Bearer admin token)
        2. Read multipart field 'image', enforce 12 MiB limit
        3. Look up menu_item by id → get product_code
        4. Delegate to ImageService.upload_product_image (validates MIME via
           Pillow, converts to WEBP q=82, creates 300×300 center-crop thumb,
           uploads to Supabase Storage, updates menu_items table)
        5. Return JSON with image_url, image_thumb_url, storage_path, was_duplicate

    All errors return structured JSON with 'error' and optional 'detail' fields.
    """
    import logging as _logging
    _logger = _logging.getLogger("bot.api.image_upload")

    # ── 1. Auth ────────────────────────────────────────────────────────────
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)

    item_id = request.match_info.get("id", "")
    _logger.info(
        "image_upload.started",
        extra={"item_id": item_id, "content_type": request.content_type},
    )

    # ── 2. Content-Type guard ──────────────────────────────────────────────
    if not request.content_type or not request.content_type.startswith("multipart/"):
        _logger.warning("image_upload.invalid_content_type", extra={"item_id": item_id})
        return web.json_response(
            {"error": "Content-Type must be multipart/form-data"}, status=415
        )

    # ── 3. Read the 'image' field from multipart stream ────────────────────
    try:
        reader = await request.multipart()
        field = None
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "image":
                field = part
                break
            # skip unknown fields
            await part.read()

        if field is None:
            _logger.warning("image_upload.missing_field", extra={"item_id": item_id})
            return web.json_response(
                {"error": "Missing 'image' field in form data"}, status=400
            )

        raw_bytes = await field.read(decode=False)
    except Exception as exc:
        _logger.error("image_upload.multipart_read_error", extra={"item_id": item_id, "error": str(exc)})
        return web.json_response(
            {"error": "Failed to read multipart data", "detail": str(exc)}, status=400
        )

    # ── 4. Size gate (12 MiB) ──────────────────────────────────────────────
    if len(raw_bytes) > MAX_IMAGE_UPLOAD_BYTES:
        _logger.warning(
            "image_upload.too_large",
            extra={"item_id": item_id, "size": len(raw_bytes)},
        )
        return web.json_response(
            {"error": f"Image too large ({len(raw_bytes)} bytes). Maximum is 12 MiB."},
            status=413,
        )

    if len(raw_bytes) == 0:
        return web.json_response({"error": "Empty file uploaded"}, status=400)

    # ── 5. Look up menu item → product_code ────────────────────────────────
    menu_item = await db.get_menu_item(item_id)
    if not menu_item:
        _logger.warning("image_upload.item_not_found", extra={"item_id": item_id})
        return web.json_response({"error": "Menu item not found"}, status=404)

    product_code = menu_item.get("product_code")
    if not product_code:
        _logger.error("image_upload.no_product_code", extra={"item_id": item_id})
        return web.json_response(
            {"error": "Menu item has no product_code. Cannot upload."}, status=422
        )

    # ── 6. Delegate to ImageService ────────────────────────────────────────
    from bot.services.image_service import ImageService, ImageServiceError

    try:
        result = await ImageService.upload_product_image(
            product_code=product_code,
            raw_bytes=raw_bytes,
            uploaded_by=0,  # HTTP-based uploads don't carry a Telegram user id
        )
    except ImageServiceError as exc:
        _logger.error(
            "image_upload.pipeline_failed",
            extra={"item_id": item_id, "product_code": product_code, "error": str(exc)},
        )
        return web.json_response(
            {"error": "Image processing failed", "detail": str(exc)}, status=422
        )
    except Exception as exc:
        _logger.exception(
            "image_upload.unexpected_error",
            extra={"item_id": item_id, "product_code": product_code},
        )
        return web.json_response(
            {"error": "Internal server error", "detail": str(exc)}, status=500
        )

    # ── 7. Success response ────────────────────────────────────────────────
    _logger.info(
        "image_upload.success",
        extra={
            "item_id": item_id,
            "product_code": product_code,
            "image_url": result.main_url,
            "thumb_url": result.thumb_url,
            "storage_path": f"products/{product_code}/main.webp",
            "was_duplicate": result.was_duplicate,
            "db_updated": True,
        },
    )
    return web.json_response({
        "success": True,
        "image_url": result.main_url,
        "image_thumb_url": result.thumb_url,
        "storage_path": f"products/{product_code}/main.webp",
        "was_duplicate": result.was_duplicate,
        "dimensions": list(result.dimensions),
        "size_main": result.size_main,
        "size_thumb": result.size_thumb,
    })

@routes.get("/api/admin/users")
async def get_admin_users_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    search = request.query.get("search")
    users = await db.get_all_users(search=search)
    return web.json_response(users)

@routes.post("/api/admin/users/{id}/block")
async def block_user_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    user_id = int(request.match_info['id'])
    success = await db.update_user_block(user_id, True)
    return web.json_response({"success": success})

@routes.post("/api/admin/users/{id}/unblock")
async def unblock_user_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    user_id = int(request.match_info['id'])
    success = await db.update_user_block(user_id, False)
    return web.json_response({"success": success})

@routes.get("/api/admin/coupons")
async def get_admin_coupons_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    coupons = await db.get_all_coupons()
    return web.json_response(coupons)

@routes.post("/api/admin/coupons")
async def create_coupon_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    import uuid
    data['id'] = str(uuid.uuid4())
    coupon = await db.create_coupon(data)
    return web.json_response(coupon)

@routes.delete("/api/admin/coupons/{id}")
async def delete_coupon_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    coupon_id = request.match_info['id']
    success = await db.delete_coupon(coupon_id)
    return web.json_response({"success": success})

@routes.post("/api/admin/broadcast")
async def admin_broadcast_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    msg = data.get('message')
    if not msg: return web.json_response({"error": "No message"}, status=400)
    
    bot = request.app['bot']
    users = await db.get_all_users()
    sent = 0
    for u in users:
        if u.get('is_blocked'): continue
        try:
            await bot.send_message(u['id'], f"📢 <b>FOOD CITY</b>\n\n{msg}")
            sent += 1
            if sent % 25 == 0: await asyncio.sleep(1) # Rate limit
        except: pass
    
    return web.json_response({"success": True, "sent_count": sent})

def setup_cors(app):
    import aiohttp_cors
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers=["Content-Type", "Authorization", "X-TG-Init-Data"],
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
        )
    })
    for route in list(app.router.routes()):
        cors.add(route)
