import logging
from aiohttp import web
from bot.api.router import routes, check_auth
from bot.database import db

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# NOTE: Bu faylda faqat router.py da YO'Q endpointlar turadi.
#
# Ilgari bu yerda menu-rasm yuklash uchun alohida, xom (unprocessed) endpoint
# ham bor edi (upload_menu_image → POST /api/admin/menu/upload). U olib
# tashlandi: WEBP konvertatsiya, thumbnail, hash-based dedup va
# menu_item_images metadata yozuvisiz, to'g'ridan-to'g'ri bucketga yozar edi.
# Kanonik, to'liq pipeline'li endpoint endi yagona: ImageService orqali
# ishlaydigan POST /api/admin/menu/{id}/image (bot/api/router.py).
# ─────────────────────────────────────────────────────────────────────────────

@routes.get("/api/admin/analytics")
async def get_admin_analytics(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)

    start_date = request.query.get("start_date")
    end_date = request.query.get("end_date")

    try:
        analytics = await db.get_admin_analytics(start_date, end_date)
    except Exception:
        logger.exception("Admin analytics query failed")
        return web.json_response({"error": "Analitikani yuklab bo'lmadi"}, status=503)
    return web.json_response(analytics)
