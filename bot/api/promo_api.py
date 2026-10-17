import io
import logging
import uuid

from aiohttp import web
from PIL import Image, ImageOps, UnidentifiedImageError

from bot.config import config
from bot.database import db
from bot.api.router import routes, verify_admin_token

logger = logging.getLogger(__name__)
MAX_PROMO_IMAGE_BYTES = 12 * 1024 * 1024
PROMO_IMAGE_BUCKET = "menu-images"
PROMO_FIELDS = (
    "id,kind,title_uz,title_ru,title_en,subtitle_uz,subtitle_ru,subtitle_en,"
    "image_url,link_url,sort_order,is_active,created_at,updated_at"
)


@routes.get("/api/promotions")
async def get_public_promotions(request: web.Request):
    try:
        result = await db._run_sync(
            lambda: db.client.table("promotional_content")
            .select(PROMO_FIELDS)
            .eq("is_active", True)
            .order("sort_order")
            .execute()
        )
        return web.json_response(result.data or [])
    except Exception:
        logger.exception("Public promotions query failed")
        return web.json_response({"error": "Promolarni yuklab bo'lmadi"}, status=503)


@routes.get("/api/admin/promotions")
async def get_admin_promotions(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        result = await db._run_sync(
            lambda: db.client.table("promotional_content")
            .select(PROMO_FIELDS)
            .order("kind")
            .order("sort_order")
            .execute()
        )
        return web.json_response(result.data or [])
    except Exception:
        logger.exception("Admin promotions query failed")
        return web.json_response({"error": "Promolarni yuklab bo'lmadi"}, status=503)


@routes.post("/api/admin/promotions/upload")
async def upload_promotion_image(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)
    if not request.content_type or not request.content_type.startswith("multipart/"):
        return web.json_response({"error": "Rasm multipart formatda yuborilishi kerak"}, status=415)

    try:
        reader = await request.multipart()
        image_field = None
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "image":
                image_field = part
                break
            await part.read()
        if image_field is None:
            return web.json_response({"error": "Rasm fayli topilmadi"}, status=400)
        raw_bytes = await image_field.read(decode=False)
    except Exception:
        logger.exception("Promotion image multipart read failed")
        return web.json_response({"error": "Rasmni o'qib bo'lmadi"}, status=400)

    if not raw_bytes:
        return web.json_response({"error": "Bo'sh rasm fayli"}, status=400)
    if len(raw_bytes) > MAX_PROMO_IMAGE_BYTES:
        return web.json_response({"error": "Rasm hajmi 12 MB dan oshmasligi kerak"}, status=413)

    try:
        with Image.open(io.BytesIO(raw_bytes)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                return web.json_response({"error": "JPG, PNG yoki WEBP rasm tanlang"}, status=415)
            if source.width * source.height > 40_000_000:
                return web.json_response({"error": "Rasm o‘lchami juda katta"}, status=413)
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="WEBP", quality=82, method=6)
            webp_bytes = output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError):
        return web.json_response({"error": "Rasm fayli yaroqsiz"}, status=415)

    object_path = f"promotions/{uuid.uuid4().hex}.webp"
    try:
        await db._run_sync(
            lambda: db.client.storage.from_(PROMO_IMAGE_BUCKET).upload(
                object_path,
                webp_bytes,
                file_options={"content-type": "image/webp", "upsert": "false"},
            )
        )
        image_url = db.client.storage.from_(PROMO_IMAGE_BUCKET).get_public_url(object_path)
        return web.json_response({"image_url": image_url})
    except Exception:
        logger.exception("Promotion image upload failed")
        return web.json_response({"error": "Rasmni saqlab bo'lmadi"}, status=503)


def _validated_promotion(data: object) -> dict | None:
    if not isinstance(data, dict):
        return None
    kind = data.get("kind")
    image_url = data.get("image_url")
    if (
        kind not in {"story", "banner"}
        or not isinstance(image_url, str)
        or not image_url.strip()
        or len(image_url) > 2048
        or not isinstance(data.get("is_active", True), bool)
    ):
        return None
    row: dict = {
        "kind": kind,
        "image_url": image_url.strip(),
        "sort_order": int(data.get("sort_order", 0)),
        "is_active": bool(data.get("is_active", True)),
    }
    if row["sort_order"] < 0 or isinstance(data.get("sort_order", 0), bool):
        return None
    if data.get("link_url") is not None:
        link_url = str(data["link_url"]).strip()
        if len(link_url) > 2048 or (link_url and not link_url.startswith(("https://", "http://", "tg://"))):
            return None
        row["link_url"] = link_url or None
    for field in (
        "title_uz", "title_ru", "title_en",
        "subtitle_uz", "subtitle_ru", "subtitle_en",
    ):
        value = data.get(field)
        text = str(value).strip() if value is not None else ""
        if len(text) > (120 if field.startswith("title_") else 500):
            return None
        row[field] = text
    return row


@routes.post("/api/admin/promotions")
async def create_promotion(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        row = _validated_promotion(await request.json())
    except (ValueError, TypeError):
        return web.json_response({"error": "So'rov JSON formati noto'g'ri"}, status=400)
    if row is None:
        return web.json_response({"error": "Promo turi, rasm, tartib yoki havolani tekshiring"}, status=400)
    try:
        result = await db._run_sync(
            lambda: db.client.table("promotional_content").insert(row).execute()
        )
        return web.json_response(result.data[0] if result.data else row, status=201)
    except Exception:
        logger.exception("Promotion create failed")
        return web.json_response({"error": "Promoni saqlab bo'lmadi"}, status=503)


@routes.put("/api/admin/promotions/{promo_id}")
async def update_promotion(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        row = _validated_promotion(await request.json())
    except (ValueError, TypeError):
        return web.json_response({"error": "So'rov JSON formati noto'g'ri"}, status=400)
    if row is None:
        return web.json_response({"error": "Promo turi, rasm, tartib yoki havolani tekshiring"}, status=400)
    try:
        result = await db._run_sync(
            lambda: db.client.table("promotional_content")
            .update(row)
            .eq("id", request.match_info["promo_id"])
            .execute()
        )
        if not result.data:
            return web.json_response({"error": "Promo topilmadi"}, status=404)
        return web.json_response(result.data[0])
    except Exception:
        logger.exception("Promotion update failed")
        return web.json_response({"error": "Promoni yangilab bo'lmadi"}, status=503)


@routes.delete("/api/admin/promotions/{promo_id}")
async def delete_promotion(request: web.Request):
    if not verify_admin_token(request):
        return web.json_response({"error": "Unauthorized"}, status=401)
    try:
        result = await db._run_sync(
            lambda: db.client.table("promotional_content")
            .delete()
            .eq("id", request.match_info["promo_id"])
            .execute()
        )
        if not result.data:
            return web.json_response({"error": "Promo topilmadi"}, status=404)
        return web.json_response({"success": True})
    except Exception:
        logger.exception("Promotion delete failed")
        return web.json_response({"error": "Promoni o'chirib bo'lmadi"}, status=503)
