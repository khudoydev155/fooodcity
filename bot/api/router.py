import asyncio
import hashlib
import hmac
from html import escape
import json
import re
import time
import uuid
from urllib.parse import parse_qsl, quote
from aiohttp import web
from bot.config import config
from bot.database import db
import logging
logger = logging.getLogger(__name__)
from decimal import Decimal, ROUND_HALF_UP

routes = web.RouteTableDef()

# initData eng ko'pi bilan shu muddat davomida haqiqiy hisoblanadi (replay hujumidan himoya)
INIT_DATA_MAX_AGE = 86400  # 24 soat


def format_admin_order_notification(order: dict, title: str) -> str:
    customer = order.get("users") or {}
    customer_name = escape(str(customer.get("full_name") or "Mijoz"))
    username = str(customer.get("username") or "").strip()
    phone = str(order.get("phone") or customer.get("phone") or "").strip()
    phone_text = (
        f'<a href="tel:{quote(phone, safe="+")}">{escape(phone)}</a>'
        if phone
        else "Ulanmagan"
    )
    if username:
        customer_name += f" (@{escape(username.lstrip('@'))})"

    address = str(order.get("delivery_address") or "").strip()
    location = order.get("location")
    map_url = ""
    if isinstance(location, dict):
        latitude = location.get("lat", location.get("latitude"))
        longitude = location.get("lon", location.get("longitude"))
        if latitude is not None and longitude is not None:
            try:
                map_url = f"https://maps.google.com/?q={float(latitude)},{float(longitude)}"
            except (TypeError, ValueError):
                map_url = ""
    is_pickup = address.lower() in {"olib ketish", "pickup"}
    if not map_url and address and not is_pickup:
        map_url = f"https://www.google.com/maps/search/?api=1&query={quote(address, safe='')}"
    map_href = escape(map_url, quote=True)
    if address and not is_pickup:
        address_text = f'<a href="{map_href}">{escape(address)}</a>' if map_url else escape(address)
    elif map_url:
        address_text = f'<a href="{map_href}">Joylashuv xaritada</a>'
    else:
        address_text = escape(address or "Ko'rsatilmagan")
    if address and is_pickup:
        address_text = escape(address)

    items = order.get("items") or []
    item_lines = []
    for item in items[:20]:
        name = str(item.get("name_uz") or item.get("name") or "Taom")[:90]
        quantity = max(1, int(item.get("qty") or 1))
        price = int(float(item.get("price") or 0))
        item_lines.append(
            f"• {escape(name)} × {quantity} — {price * quantity:,} so'm"
        )
    if len(items) > 20:
        item_lines.append(f"… yana {len(items) - 20} ta mahsulot")

    payment_method = order.get("payment_method") or "cash"
    if payment_method == "click":
        payment_status = order.get("payment_status") or "pending"
        payment_label = "Click — to'langan" if payment_status == "paid" else "Click — to'lov kutilmoqda"
    elif payment_method == "payme":
        payment_status = order.get("payment_status") or "pending"
        payment_label = "Payme — to'langan" if payment_status == "paid" else "Payme — to'lov kutilmoqda"
    else:
        payment_label = "Naqd pul"

    subtotal = int(float(order.get("subtotal") or 0))
    delivery_fee = int(float(order.get("delivery_fee") or 0))
    discount = int(float(order.get("discount") or 0))
    total = int(float(order.get("total") or 0))
    note = str(order.get("note") or "").strip()

    message = (
        f"{title}\n\n"
        f"🔖 Buyurtma: <b>#{escape(str(order.get('id') or ''))}</b>\n"
        f"👤 Mijoz: {customer_name}\n"
        f"☎️ Aloqa: {phone_text}\n"
        f"📍 Manzil: {address_text}\n\n"
        "<b>🧺 Buyurtma tarkibi:</b>\n"
        + ("\n".join(item_lines) if item_lines else "• Tarkib topilmadi")
        + "\n\n"
        f"Mahsulotlar: {subtotal:,} so'm\n"
        f"Yetkazib berish: {delivery_fee:,} so'm\n"
        + (f"Chegirma: −{discount:,} so'm\n" if discount else "")
        + f"💰 <b>Jami: {total:,} so'm</b>\n"
        + f"💳 To'lov: {escape(payment_label)}"
        + (f"\n📝 Izoh: {escape(note[:500])}" if note else "")
    )
    return message


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
    except Exception as e:
        logger.error(f"get_categories failed: {e}")
        return web.json_response([])

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

@routes.post("/api/user/orders/{order_id}/cancel")
async def cancel_user_order(request: web.Request):
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)

    order_id = request.match_info.get("order_id", "").replace("%23", "").replace("#", "")
    if not order_id:
        return web.json_response({"error": "Order ID is required"}, status=400)

    try:
        result = await db._run_sync(
            lambda: db.client.rpc(
                "cancel_customer_order",
                {"p_order_id": order_id, "p_user_id": user_id},
            ).execute()
        )
        outcome = result.data if isinstance(result.data, dict) else {}
        if outcome.get("success"):
            return web.json_response(outcome)
        if outcome.get("error") == "not_found":
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if outcome.get("error") == "not_cancellable":
            return web.json_response(
                {"error": "Faqat yangi buyurtmani bekor qilish mumkin."},
                status=409,
            )
        logger.error("Unexpected customer order cancellation response for order %s: %r", order_id, outcome)
        return web.json_response({"error": "Buyurtmani bekor qilib bo'lmadi"}, status=500)
    except Exception:
        logger.exception("Customer order cancellation failed for order %s", order_id)
        return web.json_response(
            {"error": "Bekor qilish xizmati ishlamadi. Migration 007 qo'llanganini tekshiring."},
            status=503,
        )

@routes.get("/api/user/profile")
async def get_user_profile(request: web.Request):
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        result = await asyncio.to_thread(
            lambda: db.client.table('users')
                .select('loyalty_points, total_orders, total_spent, phone, phone_verified_at')
                .eq('id', user_id)
                .execute()
        )
        if result.data:
            profile = result.data[0]
            return web.json_response({
                "loyalty_points": profile.get("loyalty_points", 0),
                "total_orders": profile.get("total_orders", 0),
                "total_spent": profile.get("total_spent", 0),
                "phone_verified": bool(profile.get("phone") and profile.get("phone_verified_at")),
                "phone_number": (
                    profile.get("phone")
                    if profile.get("phone") and profile.get("phone_verified_at")
                    else None
                ),
            })
        return web.json_response({
            "loyalty_points": 0,
            "total_orders": 0,
            "total_spent": 0,
            "phone_verified": False,
            "phone_number": None,
        })
    except Exception:
        logger.exception("User profile lookup failed for Telegram user %s", user_id)
        return web.json_response(
            {"error": "Profil ma'lumotlarini hozir yuklab bo'lmadi. Qayta urinib ko'ring."},
            status=503,
        )

@routes.get("/api/order/{order_id}/status")
async def get_order_status(request: web.Request):
    order_id = request.match_info.get('order_id', '')

    # SECURITY: order_id ketma-ket va oson topiladi (masalan 260515-001),
    # shuning uchun auth shart — aks holda har kim boshqa mijozning
    # buyurtma holatini ID'ni sanab ko'rish orqali o'qiy olardi.
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({'error': 'Unauthorized'}, status=401)

    # Try different ID formats
    # Remove # if present
    clean_id = order_id.replace('%23', '').replace('#', '')

    # Try with # prefix first (new format: #260515-001)
    result = await asyncio.to_thread(
        lambda: db.client.table('orders')
            .select('id, status, created_at, updated_at, payment_method, payment_status, payment_receipt_url, total')
            .eq('id', '#' + clean_id)
            .eq('user_id', user_id)
            .execute()
    )

    # If not found, try without # (old format)
    if not result.data:
        result = await asyncio.to_thread(
            lambda: db.client.table('orders')
                .select('id, status, created_at, updated_at, payment_method, payment_status, payment_receipt_url, total')
                .eq('id', clean_id)
                .eq('user_id', user_id)
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
        except Exception as e:
            # "coupon_usage" jadvali hali yaratilmagan bo'lishi mumkin (eski
            # muhitlarda) — shu holatda o'tkazib yuboramiz, lekin haqiqiy
            # xato (masalan ulanish uzilishi) sezilmasdan qolmasligi uchun
            # log yozamiz.
            logger.warning(f"coupon_usage check failed for coupon={coupon_code!r}: {e}")
        
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
        # SECURITY: user_id tanadan (body) emas, tasdiqlangan initData'dan
        # olinadi — aks holda har kim boshqa foydalanuvchi nomidan kupon
        # holatini (masalan "allaqachon ishlatilganmi") tekshira olardi.
        user_id = get_verified_user_id(request)
        if not user_id:
            return web.json_response({"valid": False, "error": "Unauthorized"}, status=401)

        data = await request.json()
        coupon_code = data.get('code')
        subtotal = data.get('subtotal', 0)

        if not coupon_code:
            return web.json_response({"valid": False, "error": "Kod xato"})

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

        # Phone validation: Delivery phone is mandatory in order payload or fallback to existing valid phone
        raw_phone = str(payload.get("phone") or "").strip()
        clean_phone = None
        digits = re.sub(r"[^\d]", "", raw_phone)
        if digits.startswith("998") and len(digits) == 12:
            clean_phone = f"+{digits}"
        elif len(digits) == 9:
            clean_phone = f"+998{digits}"

        if clean_phone:
            # Update user profile with the delivery phone number
            await db.verify_user_phone(user_id, clean_phone)
            payload["phone"] = clean_phone
        else:
            # Check if user has an existing valid phone in database
            user_data = await db.get_user(user_id)
            existing_phone = (user_data.get("phone") or "").strip() if user_data else ""
            existing_digits = re.sub(r"[^\d]", "", existing_phone)
            if existing_digits.startswith("998") and len(existing_digits) == 12:
                payload["phone"] = f"+{existing_digits}"
            else:
                return web.json_response(
                    {"error": "Yetkazib berish uchun O'zbekiston telefon raqamingizni kiriting (+998 XX XXX XX XX)"},
                    status=400,
                )

        fulfillment_mode = payload.get("fulfillment_mode", "delivery")
        if fulfillment_mode not in ("delivery", "pickup"):
            return web.json_response({"error": "Noto'g'ri buyurtma turi"}, status=400)
        if fulfillment_mode == "pickup":
            payload["delivery_fee"] = 0
            payload["delivery_address"] = "Olib ketish"
            payload["location"] = {}
        else:
            address = str(payload.get("delivery_address", "")).strip()
            if len(address) < 6:
                return web.json_response({"error": "Yetkazib berish manzilini kiriting"}, status=400)
            # Delivery cost is trusted server-side configuration, never client input.
            payload["delivery_fee"] = config.DELIVERY_FEE

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

        # MUHIM: bu yerda ilgari adminga Telegram orqali HECH QANDAY darhol
        # (push) bildirishnoma yuborilmas edi — buyurtmalarni faqat admin
        # panel (12 soniyalik polling) yoki botni qo'lda ochib ko'rish
        # mumkin edi. (Eski, endi o'chirilgan web_app_data_handler'da
        # shunday xabar bor edi, lekin u kod yo'li hech qachon ishlamas
        # edi — haqiqiy buyurtmalar shu REST endpoint orqali keladi.)
        # Endi yangi buyurtma kelishi bilan adminga darhol xabar boradi.
        try:
            bot = request.app.get('bot')
            if bot and config.ADMIN_CHAT_ID:
                order_details = await db.get_order_for_courier_notification(order["id"])
                if not order_details:
                    raise LookupError(f"New order {order['id']} could not be reloaded for admin notification")
                await bot.send_message(
                    config.ADMIN_CHAT_ID,
                    format_admin_order_notification(order_details, "🔔 <b>Yangi buyurtma!</b>"),
                    parse_mode="HTML",
                )
        except Exception:
            logger.exception("New-order admin notification failed for order %s", order.get("id"))

        # Agar payment_method == 'click' yoki 'payme' bo'lsa, payment_url generatsiya qilib qo'shamiz
        payment_url = ""
        p_method = str(payload.get("payment_method") or "").lower()
        if p_method in ("click", "payme"):
            try:
                from bot.services.payment_service import PaymentService
                order_total = int(float(order.get("total") or 0))
                return_url = f"{config.MINI_APP_URL}?order_id={order['id']}"
                payment_url = await PaymentService.generate_payment_url(order["id"], p_method, order_total, return_url)
            except Exception as pe:
                logger.warning(f"Payment URL generation failed for order {order['id']}: {pe}")

        return web.json_response({"success": True, "order": order, "payment_url": payment_url})
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
    except Exception as e:
        logger.warning(f"Telegram login-widget hash verification error: {e}")
        return False

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

def get_admin_payload(request: web.Request) -> dict | None:
    """Token haqiqiy bo'lsa uning ichidagi payload'ni (id, role) qaytaradi."""
    token = extract_token(request)
    if not token:
        return None
    return verify_admin_token_logic(token)

def verify_admin_token(request):
    # MUHIM: kuryer roli BU orqali TO'LIQ admin panelga (statistika,
    # foydalanuvchilar, kuponlar, broadcast, boshqa kuryerlarning
    # buyurtmalari) kira olmasligi kerak — shuning uchun role='courier'
    # bo'lsa bu funksiya False qaytaradi. Kuryerga tegishli endpointlar
    # alohida (get_admin_payload + role tekshiruvi) orqali ishlaydi.
    payload = get_admin_payload(request)
    if not payload:
        return False
    return payload.get('role') != 'courier'

def check_auth(request):
    return verify_admin_token(request)


@routes.get("/api/admin/stats")
async def get_admin_stats_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    # MUHIM: ilgari bu yerda start_date/end_date umuman o'qilmas edi —
    # Dashboard'dagi "Bugun/Kecha/7 kun/Shu oy" filtrlari faqat KO'RINISHDA
    # ishlar, statistika kartalari esa doim bugungi kunni ko'rsatardi.
    start_date = request.query.get("start_date")
    end_date = request.query.get("end_date")
    try:
        stats = await db.get_admin_stats(start_date=start_date, end_date=end_date)
    except Exception:
        logger.exception("Admin stats query failed")
        return web.json_response({"error": "Statistikani yuklab bo'lmadi"}, status=503)
    return web.json_response(stats)

@routes.get("/api/admin/orders")
async def get_admin_orders_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    status_param = request.query.get("status")
    # Frontend bir nechta statusni vergul bilan yuboradi (masalan
    # "new,confirmed,cooking,delivering") — ilgari bu bitta STRING sifatida
    # to'g'ridan-to'g'ri .eq()ga uzatilar edi, ya'ni HECH QACHON hech qanday
    # buyurtmaga mos kelmasdi (chunki hech bir orderning statusi literal
    # "new,confirmed,cooking,delivering" emas) — natijada Dashboard'dagi
    # "joriy buyurtmalar" ro'yxati doim BO'SH chiqardi.
    status = status_param.split(",") if status_param else None
    search = request.query.get("search")
    start_date = request.query.get("start_date")
    end_date = request.query.get("end_date")
    try:
        limit = int(request.query.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    try:
        offset = int(request.query.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    try:
        orders = await db.get_admin_orders(
            status=status, search=search, limit=limit, offset=offset,
            start_date=start_date, end_date=end_date,
        )
    except Exception:
        logger.exception("Admin orders query failed")
        return web.json_response({"error": "Buyurtmalarni yuklab bo'lmadi"}, status=503)
    return web.json_response(orders)

@routes.post("/api/admin/orders/{id}/status")
async def update_order_status_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    order_id = request.match_info['id']
    data = await request.json()
    success = await db.update_order_status(order_id, data.get('status'))
    return web.json_response({"success": success})

@routes.post("/api/admin/orders/{id}/assign-courier")
async def assign_courier_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    order_id = request.match_info['id']
    data = await request.json()
    courier_id = data.get('courier_id')
    if not courier_id:
        return web.json_response({"error": "courier_id kerak"}, status=400)
    try:
        courier_id = int(courier_id)
    except (TypeError, ValueError):
        return web.json_response({"error": "Noto'g'ri kuryer ID"}, status=400)
    try:
        couriers = await db.get_couriers()
        if not any(int(courier.get("user_id", 0)) == courier_id for courier in couriers):
            return web.json_response({"error": "Kuryer ro'yxatdan topilmadi"}, status=404)
        success = await db.assign_courier(order_id, courier_id)
    except Exception:
        logger.exception("Admin courier assignment failed")
        return web.json_response({
            "error": "Kuryer biriktirilmadi. Supabase'da 003_courier_assignment.sql migratsiyasi qo'llanganini tekshiring."
        }, status=503)
    if not success:
        return web.json_response({"error": "Buyurtma topilmadi yoki kuryer biriktirilmadi"}, status=404)

    notification_sent = False
    try:
        order = await db.get_order_for_courier_notification(order_id)
        if not order:
            raise LookupError(f"Assigned order {order_id} could not be reloaded")

        bot = request.app.get("bot")
        if not bot:
            raise RuntimeError("Telegram bot is unavailable")

        message = format_admin_order_notification(
            order,
            "🛵 <b>Sizga yangi buyurtma biriktirildi</b>",
        )
        await bot.send_message(courier_id, message, parse_mode="HTML")
        notification_sent = True
    except Exception:
        logger.exception("Courier assignment notification failed for order %s", order_id)

    return web.json_response({"success": True, "notification_sent": notification_sent})

# ─── COURIERS (Yetkazib berish) ──────────────────────────────────────────────

@routes.get("/api/admin/couriers")
async def get_couriers_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        couriers = await db.get_couriers()
    except Exception:
        logger.exception("Admin couriers query failed")
        return web.json_response({"error": "Kuryerlar ro'yxatini yuklab bo'lmadi"}, status=503)
    return web.json_response(couriers)

@routes.post("/api/admin/couriers")
async def add_courier_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    payload = get_admin_payload(request)
    data = await request.json()
    user_id = data.get('user_id')
    if not user_id:
        return web.json_response({"error": "user_id kerak"}, status=400)
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return web.json_response({"error": "user_id raqam bo'lishi kerak"}, status=400)
    ok, error = await db.add_courier(user_id, payload.get('id', 0))
    if not ok:
        return web.json_response({"error": error or "Kuryer qo'shilmadi"}, status=400)
    return web.json_response({"success": True})

@routes.delete("/api/admin/couriers/{id}")
async def remove_courier_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    courier_id = request.match_info['id']
    try:
        courier_id = int(courier_id)
    except ValueError:
        return web.json_response({"error": "Noto'g'ri ID"}, status=400)
    success = await db.remove_courier(courier_id)
    return web.json_response({"success": success})

@routes.get("/api/courier/orders")
async def get_courier_orders_api(request: web.Request):
    payload = get_admin_payload(request)
    if not payload:
        return web.json_response({"error": "Unauthorized"}, status=401)
    role = payload.get('role')
    if role == 'courier':
        courier_id = payload['id']
    elif role in ('admin', 'superadmin'):
        # Admin biror aniq kuryerning ro'yxatini ko'rmoqchi bo'lsa (masalan sinov uchun)
        q = request.query.get('courier_id')
        courier_id = int(q) if q else payload['id']
    else:
        return web.json_response({"error": "Forbidden"}, status=403)
    try:
        orders = await db.get_courier_orders(courier_id)
    except Exception:
        logger.exception("Courier orders query failed")
        return web.json_response({"error": "Kuryer buyurtmalarini yuklab bo'lmadi"}, status=503)
    return web.json_response(orders)

@routes.post("/api/courier/orders/{id}/status")
async def update_courier_order_status_api(request: web.Request):
    payload = get_admin_payload(request)
    if not payload:
        return web.json_response({"error": "Unauthorized"}, status=401)
    role = payload.get('role')
    if role not in ('courier', 'admin', 'superadmin'):
        return web.json_response({"error": "Forbidden"}, status=403)

    order_id = request.match_info['id']
    data = await request.json()
    new_status = data.get('status')
    # Kuryer faqat shu ikki holatga o'tkaza oladi — boshqa statuslar
    # (masalan 'cancelled') faqat to'liq admin panel orqali o'zgartiriladi.
    if new_status not in ('delivering', 'delivered'):
        return web.json_response({"error": "Ruxsat etilmagan holat"}, status=400)

    if role == 'courier':
        # MUHIM: kuryer FAQAT o'ziga biriktirilgan buyurtmani o'zgartira oladi.
        success = await db.update_order_status_as_courier(order_id, payload['id'], new_status)
    else:
        success = await db.update_order_status(order_id, new_status)

    if not success:
        return web.json_response({"error": "Buyurtma topilmadi yoki sizga biriktirilmagan"}, status=404)
    return web.json_response({"success": True})

@routes.get("/api/admin/menu")
async def get_admin_menu_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    menu = await db.get_all_menu()
    return web.json_response(menu)

@routes.post("/api/admin/menu")
async def add_menu_item_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()

    # Talab qilinadigan maydonlarni shu yerda (HTTP qatlamida) tekshiramiz —
    # maydonlarni normalizatsiya qilish (RU/EN fallback, default qiymatlar)
    # esa endi yagona manba: db.add_menu_item() / _build_menu_item_row().
    name_uz = data.get('name_uz') or data.get('name', '')
    if not name_uz:
        return web.json_response({'error': 'Name is required'}, status=400)
    try:
        price = int(data.get('price', 0))
    except (TypeError, ValueError):
        return web.json_response({'error': 'Valid price is required'}, status=400)
    if price <= 0:
        return web.json_response({'error': 'Valid price is required'}, status=400)
    if not data.get('category_id'):
        return web.json_response({'error': 'Category is required'}, status=400)

    item = await db.add_menu_item(data)
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

async def _run_broadcast(bot, msg: str) -> None:
    """Broadcast'ni orqa fonda yuboradi — HTTP javobini bloklamaydi."""
    users = await db.get_all_users()
    sent = 0
    for u in users:
        if u.get('is_blocked'):
            continue
        try:
            await bot.send_message(u['id'], f"📢 <b>FOOD CITY</b>\n\n{msg}")
            sent += 1
            if sent % 25 == 0:
                await asyncio.sleep(1)  # Telegram rate limit
        except Exception:
            pass
    logger.info(f"broadcast.finished sent={sent} total={len(users)}")


@routes.post("/api/admin/broadcast")
async def admin_broadcast_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    msg = data.get('message')
    if not msg: return web.json_response({"error": "No message"}, status=400)

    bot = request.app['bot']

    # MUHIM: ilgari bu yerda barcha foydalanuvchilarga xabar TO'LIQ
    # yuborilib bo'lgandan keyingina HTTP javobi qaytarilardi — ko'p
    # foydalanuvchi bo'lsa, admin panel so'rovi o'nlab soniya (hatto
    # daqiqalab) osilib qolar, brauzer/proksi timeout'iga uchrashi
    # mumkin edi. Endi yuborish orqa fonda (background task) davom
    # etadi, admin panelga esa darhol javob qaytariladi.
    asyncio.create_task(_run_broadcast(bot, msg))

    return web.json_response({"success": True, "message": "Yuborish boshlandi"})

# ─── PAYMENTS (naqd / karta-kartaga o'tkazma) ───────────────────────────────

MAX_RECEIPT_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MiB

@routes.get("/api/payment-info")
async def get_payment_info_api(request: web.Request):
    """Do'konning karta-kartaga o'tkazma rekvizitlari — mijoz to'lov qilishdan oldin ko'radi."""
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)
    settings = await db.get_payment_settings()
    return web.json_response({
        "card_number": settings.get("payment_card_number") or "",
        "card_holder": settings.get("payment_card_holder") or "",
    })

@routes.post("/api/order/{id}/payment-receipt")
async def upload_payment_receipt_api(request: web.Request):
    """Mijoz karta-kartaga o'tkazma chekini (skrinshot) yuklaydi.

    Xavfsizlik: buyurtma HAQIQATAN shu (tasdiqlangan initData'dagi)
    foydalanuvchiga tegishli ekani tekshiriladi — aks holda har kim
    boshqa birovning buyurtmasiga soxta chek yuklashi mumkin bo'lardi.
    """
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)

    order_id = request.match_info.get("id", "")
    order = await db.get_order_owner(order_id)
    if not order:
        return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
    if int(order.get("user_id", 0)) != int(user_id):
        return web.json_response({"error": "Bu buyurtma sizga tegishli emas"}, status=403)
    if order.get("payment_method") != "card_transfer":
        return web.json_response({"error": "Bu buyurtma naqd to'lov uchun — chek kerak emas"}, status=400)
    if order.get("payment_status") == "paid":
        return web.json_response({"error": "Bu buyurtma uchun to'lov allaqachon tasdiqlangan"}, status=409)

    if not request.content_type or not request.content_type.startswith("multipart/"):
        return web.json_response({"error": "Content-Type must be multipart/form-data"}, status=415)

    try:
        reader = await request.multipart()
        field = None
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "receipt":
                field = part
                break
        if field is None:
            return web.json_response({"error": "Missing 'receipt' field in form data"}, status=400)
        raw_bytes = bytearray()
        while True:
            chunk = await field.read_chunk(size=64 * 1024)
            if not chunk:
                break
            if len(raw_bytes) + len(chunk) > MAX_RECEIPT_UPLOAD_BYTES:
                return web.json_response({
                    "error": f"Fayl juda katta (max {MAX_RECEIPT_UPLOAD_BYTES // (1024*1024)} MB)"
                }, status=413)
            raw_bytes.extend(chunk)
    except web.HTTPRequestEntityTooLarge:
        return web.json_response({
            "error": f"Fayl juda katta (max {MAX_RECEIPT_UPLOAD_BYTES // (1024*1024)} MB)"
        }, status=413)
    except Exception as exc:
        return web.json_response({"error": "Failed to read multipart data", "detail": str(exc)}, status=400)

    if len(raw_bytes) == 0:
        return web.json_response({"error": "Empty file uploaded"}, status=400)
    receipt_bytes = bytes(raw_bytes)

    # Haqiqiy rasm ekanini tekshiramiz (buzuq/boshqa fayl turlarini rad etish uchun)
    try:
        from PIL import Image
        import io

        def validate_receipt_image() -> tuple[str, str]:
            with Image.open(io.BytesIO(receipt_bytes)) as image:
                image_format = image.format
                if image_format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Unsupported receipt image format")
                image.verify()
            extension = "jpg" if image_format == "JPEG" else image_format.lower()
            mime_type = "image/jpeg" if image_format == "JPEG" else f"image/{extension}"
            return extension, mime_type

        ext, content_type = await asyncio.to_thread(validate_receipt_image)
    except Exception:
        return web.json_response({
            "error": "Faqat JPG, PNG yoki WEBP formatidagi haqiqiy rasm yuklang"
        }, status=400)

    try:
        path = f"payment-receipts/{uuid.uuid4().hex}.{ext}"
        await asyncio.to_thread(
            lambda: db.client.storage.from_(config.STORAGE_BUCKET).upload(
                path=path, file=receipt_bytes,
                file_options={"content-type": content_type, "x-upsert": "true"},
            )
        )
        receipt_url = db.client.storage.from_(config.STORAGE_BUCKET).get_public_url(path)
    except Exception as exc:
        logger.error(f"payment-receipt upload failed for order {order_id}: {exc}")
        return web.json_response({"error": "Yuklashda xatolik yuz berdi"}, status=500)

    ok = await db.save_payment_receipt(order_id, receipt_url)
    if not ok:
        return web.json_response({"error": "Chek saqlanmadi"}, status=500)

    # Adminni darhol xabardor qilamiz (rasm bilan) — tez tekshirib tasdiqlashi uchun
    try:
        bot = request.app.get('bot')
        if bot and config.ADMIN_CHAT_ID:
            order_details = await db.get_order_for_courier_notification(order_id)
            customer = (order_details or {}).get("users") or {}
            customer_name = escape(str(customer.get("full_name") or "Mijoz"))
            phone = str(customer.get("phone") or "").strip()
            caption = f"💳 <b>#{escape(order_id)} — to'lov cheki</b>\n👤 {customer_name}"
            if phone:
                caption += f"\n☎️ {escape(phone)}"
            await bot.send_photo(
                config.ADMIN_CHAT_ID,
                receipt_url,
                caption=caption,
                parse_mode="HTML",
            )
            if order_details:
                await bot.send_message(
                    config.ADMIN_CHAT_ID,
                    format_admin_order_notification(
                        order_details,
                        "🧾 <b>Chek qabul qilindi — buyurtma tafsilotlari</b>",
                    ),
                    parse_mode="HTML",
                )
    except Exception:
        logger.exception("Payment receipt admin notification failed for order %s", order_id)

    return web.json_response({"success": True, "receipt_url": receipt_url})

@routes.post("/api/admin/orders/{id}/confirm-payment")
async def confirm_payment_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    payload = get_admin_payload(request)
    order_id = request.match_info["id"]
    try:
        ok = await db.confirm_payment(order_id, payload.get("id", 0) if payload else 0)
    except Exception:
        logger.exception("Admin payment confirmation failed for order %s", order_id)
        return web.json_response(
            {"error": "To'lovni bazaga yozib bo'lmadi. Aniq sabab server jurnalida saqlandi."},
            status=503,
        )
    if not ok:
        return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
    return web.json_response({"success": True})

@routes.post("/api/admin/orders/{id}/reject-payment")
async def reject_payment_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    payload = get_admin_payload(request)
    order_id = request.match_info["id"]
    try:
        ok = await db.reject_payment(order_id, payload.get("id", 0) if payload else 0)
    except Exception:
        logger.exception("Admin payment rejection failed for order %s", order_id)
        return web.json_response({"error": "To'lovni rad etib bo'lmadi."}, status=503)
    if not ok:
        return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
    return web.json_response({"success": True})

@routes.get("/api/admin/payment-settings")
async def get_admin_payment_settings_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    settings = await db.get_payment_settings()
    return web.json_response(settings)

@routes.put("/api/admin/payment-settings")
async def update_admin_payment_settings_api(request: web.Request):
    if not verify_admin_token(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    ok = await db.update_payment_settings(
        str(data.get("card_number", "") or ""), str(data.get("card_holder", "") or "")
    )
    return web.json_response({"success": ok})


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
