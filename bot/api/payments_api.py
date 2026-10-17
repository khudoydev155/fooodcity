import html
import json
import logging
from aiohttp import web
from bot.api.router import routes, get_verified_user_id, verify_admin_token, get_admin_payload
from bot.config import config
from bot.database import db
from bot.services.payment_service import PaymentService, ClickError

logger = logging.getLogger(__name__)


async def _parse_request_data(request: web.Request) -> dict:
    """So'rovdan form-data yoki JSON ma'lumotlarni xavfsiz ajratib oladi."""
    content_type = request.content_type or ""
    if "application/json" in content_type:
        try:
            return await request.json()
        except Exception:
            return {}
    elif "form" in content_type:
        try:
            post_data = await request.post()
            return dict(post_data)
        except Exception:
            return {}
    else:
        # Fallback: avval JSON deb ko'radi, keyin post
        try:
            return await request.json()
        except Exception:
            try:
                post_data = await request.post()
                return dict(post_data)
            except Exception:
                return {}


async def _notify_payment_success(app: web.Application, order: dict, provider: str, amount: int):
    """To'lov muvaffaqiyatli o'tganda Adminga va Mijozga Telegram orqali xabar yuborish."""
    bot = app.get("bot")
    if not bot or not order:
        return

    order_id = order.get("id")
    user_id = order.get("user_id")
    provider_name = "Click" if provider == "click" else "Payme"

    # 1. Adminga xabar
    if config.ADMIN_CHAT_ID:
        admin_text = (
            f"💰 <b>To'lov qabul qilindi ({provider_name})!</b>\n\n"
            f"🔖 Buyurtma: <b>#{html.escape(str(order_id))}</b>\n"
            f"💵 Summa: <b>{amount:,} so'm</b>\n"
            f"✅ Holat: <b>To'langan</b>\n\n"
            f"Oshxona buyurtmani tayyorlashni boshlashi mumkin."
        )
        try:
            await bot.send_message(config.ADMIN_CHAT_ID, admin_text, parse_mode="HTML")
        except Exception as e:
            logger.error(f"Adminga to'lov xabarini yuborishda xato: {e}")

    # 2. Mijozga xabar
    if user_id:
        customer_text = (
            f"🎉 <b>To'lovingiz muvaffaqiyatli qabul qilindi!</b>\n\n"
            f"🔖 Buyurtma: <b>#{html.escape(str(order_id))}</b>\n"
            f"💳 To'lov usuli: <b>{provider_name}</b>\n"
            f"💵 To'langan summa: <b>{amount:,} so'm</b>\n\n"
            f"Buyurtmangiz tayyorlanishga yuborildi. Rahmat!"
        )
        try:
            await bot.send_message(user_id, customer_text, parse_mode="HTML")
        except Exception as e:
            logger.warning(f"Mijozga ({user_id}) to'lov xabarini yuborishda xato: {e}")


# ─── CLICK WEBHOOKS ─────────────────────────────────────────────────────────

@routes.post("/api/payments/click/prepare")
async def click_prepare_endpoint(request: web.Request):
    """Click Prepare Webhook (action=0)."""
    try:
        data = await _parse_request_data(request)
        logger.info(f"Click Prepare so'rovi olindi: {data.get('click_trans_id')}, order: {data.get('merchant_trans_id')}")
        resp = await PaymentService.process_click_prepare(data)
        return web.json_response(resp)
    except Exception as e:
        logger.exception(f"Click Prepare xatolik: {e}")
        return web.json_response({
            "error": ClickError.UPDATE_FAILED,
            "error_note": "Internal server error"
        })


@routes.post("/api/payments/click/complete")
async def click_complete_endpoint(request: web.Request):
    """Click Complete Webhook (action=1)."""
    try:
        data = await _parse_request_data(request)
        logger.info(f"Click Complete so'rovi olindi: {data.get('click_trans_id')}, order: {data.get('merchant_trans_id')}")
        resp, paid_order = await PaymentService.process_click_complete(data)

        # Agar to'lov muvaffaqiyatli o'tgan bo'lsa, xabarnomalar yuboramiz
        if paid_order and resp.get("error") == ClickError.SUCCESS:
            amount = int(float(paid_order.get("total", 0)))
            await _notify_payment_success(request.app, paid_order, "click", amount)

        return web.json_response(resp)
    except Exception as e:
        logger.exception(f"Click Complete xatolik: {e}")
        return web.json_response({
            "error": ClickError.UPDATE_FAILED,
            "error_note": "Internal server error"
        })


# ─── PAYME WEBHOOK (JSON-RPC 2.0) ───────────────────────────────────────────

@routes.post("/api/payments/payme")
async def payme_endpoint(request: web.Request):
    """Payme Merchant JSON-RPC 2.0 Webhook."""
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32700, "message": "Parse error"}
        })

    auth_header = request.headers.get("Authorization", "")
    try:
        resp, paid_order = await PaymentService.process_payme_rpc(payload, auth_header)

        # Agar PerformTransaction muvaffaqiyatli o'tgan bo'lsa, xabarnoma yuboramiz
        if paid_order and "result" in resp:
            amount = int(float(paid_order.get("total", 0)))
            await _notify_payment_success(request.app, paid_order, "payme", amount)

        return web.json_response(resp)
    except Exception as e:
        logger.exception(f"Payme endpoint xatolik: {e}")
        return web.json_response({
            "jsonrpc": "2.0",
            "id": payload.get("id"),
            "error": {"code": -32400, "message": "Could not perform operation"}
        })


# ─── CUSTOMER TO'LOV HAVOLASI & STATUS ENDPOINTS ─────────────────────────────

@routes.get("/api/order/{id}/payment-link")
async def get_payment_link_endpoint(request: web.Request):
    """Mijoz Mini App orqali Click yoki Payme to'lov havolasini oladi."""
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)

    order_id = request.match_info.get("id", "")
    provider = request.query.get("provider", "click").lower().strip()
    if provider not in ("click", "payme"):
        return web.json_response({"error": "Noto'g'ri to'lov provayderi (click yoki payme bo'lishi kerak)"}, status=400)

    order = await db.get_order_by_id(order_id)
    if not order:
        return web.json_response({"error": "Buyurtma topilmadi"}, status=404)

    if int(order.get("user_id", 0)) != int(user_id):
        return web.json_response({"error": "Bu buyurtma sizga tegishli emas"}, status=403)

    if order.get("payment_status") == "paid":
        return web.json_response({"error": "Buyurtma uchun to'lov allaqachon to'langan", "status": "paid"}, status=400)

    total = int(float(order.get("total", 0)))
    return_url = f"{config.MINI_APP_URL}?order_id={order_id}"
    payment_url = await PaymentService.generate_payment_url(order_id, provider, total, return_url)

    return web.json_response({
        "order_id": order_id,
        "provider": provider,
        "amount": total,
        "payment_url": payment_url,
    })


@routes.get("/api/order/{id}/payment-status")
async def get_payment_status_endpoint(request: web.Request):
    """Tracking sahifasida to'lov holatini real-time tekshirish."""
    user_id = get_verified_user_id(request)
    if not user_id:
        return web.json_response({"error": "Unauthorized"}, status=401)

    order_id = request.match_info.get("id", "")
    order = await db.get_order_by_id(order_id)
    if not order:
        return web.json_response({"error": "Buyurtma topilmadi"}, status=404)

    if int(order.get("user_id", 0)) != int(user_id):
        return web.json_response({"error": "Bu buyurtma sizga tegishli emas"}, status=403)

    return web.json_response({
        "order_id": order_id,
        "payment_method": order.get("payment_method") or "cash",
        "payment_status": order.get("payment_status") or "pending",
        "payment_confirmed_at": order.get("payment_confirmed_at"),
        "total": int(float(order.get("total", 0))),
    })


# ─── ADMIN SOZLAMALARI: CLICK & PAYME ──────────────────────────────────────

@routes.get("/api/admin/click-payme-settings")
async def get_admin_click_payme_settings(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)

    settings = await db.get_click_and_payme_settings()
    # Xavfsizlik: Maxfiy kalitlarning faqat birinchi va oxirgi 3 ta belgisini ko'rsatamiz (masking)
    def mask_key(k: str) -> str:
        if not k:
            return ""
        if len(k) <= 6:
            return "******"
        return f"{k[:3]}...{k[-3:]}"

    return web.json_response({
        "click_service_id": settings.get("click_service_id") or "",
        "click_merchant_id": settings.get("click_merchant_id") or "",
        "click_merchant_user_id": settings.get("click_merchant_user_id") or "",
        "click_secret_key_masked": mask_key(settings.get("click_secret_key") or ""),
        "click_is_configured": bool(settings.get("click_service_id") and settings.get("click_merchant_id")),
        "payme_merchant_id": settings.get("payme_merchant_id") or "",
        "payme_secret_key_masked": mask_key(settings.get("payme_secret_key") or ""),
        "payme_test_mode": settings.get("payme_test_mode", True),
        "payme_is_configured": bool(settings.get("payme_merchant_id") and settings.get("payme_secret_key")),
    })


@routes.put("/api/admin/click-payme-settings")
async def update_admin_click_payme_settings(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)

    data = await request.json()
    updates = {}

    if "click_service_id" in data:
        updates["click_service_id"] = str(data["click_service_id"] or "").strip()
    if "click_merchant_id" in data:
        updates["click_merchant_id"] = str(data["click_merchant_id"] or "").strip()
    if "click_secret_key" in data and data["click_secret_key"]:
        updates["click_secret_key"] = str(data["click_secret_key"] or "").strip()
    if "click_merchant_user_id" in data:
        updates["click_merchant_user_id"] = str(data["click_merchant_user_id"] or "").strip()

    if "payme_merchant_id" in data:
        updates["payme_merchant_id"] = str(data["payme_merchant_id"] or "").strip()
    if "payme_secret_key" in data and data["payme_secret_key"]:
        updates["payme_secret_key"] = str(data["payme_secret_key"] or "").strip()
    if "payme_test_mode" in data:
        updates["payme_test_mode"] = bool(data["payme_test_mode"])

    if updates:
        try:
            await db._run_sync(
                db.client.table("system_settings")
                    .update(updates)
                    .eq("id", "foodcity_bot")
                    .execute
            )
            return web.json_response({"success": True, "message": "To'lov sozlamalari yangilandi"})
        except Exception as e:
            logger.error(f"update_admin_click_payme_settings failed: {e}")
            return web.json_response({"error": "Sozlamalarni saqlab bo'lmadi"}, status=500)

    return web.json_response({"success": True})
