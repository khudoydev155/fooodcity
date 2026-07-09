import logging
from aiohttp import web
from bot.api.router import routes, check_auth
from bot.database import db

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# NOTE: Bu faylda faqat router.py da YO'Q endpointlar turadi.
# Avval bu yerda router.py bilan dublikat bo'lgan (va hech qachon ishlamaydigan)
# stats/orders/menu/users/coupons handlerlari bor edi — ular olib tashlandi,
# chunki aiohttp birinchi ro'yxatdan o'tgan (router.py dagi) handlerni ishlatadi.
# ─────────────────────────────────────────────────────────────────────────────

@routes.get("/api/admin/analytics")
async def get_admin_analytics(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)

    start_date = request.query.get("start_date")
    end_date = request.query.get("end_date")

    analytics = await db.get_admin_analytics(start_date, end_date)
    return web.json_response(analytics)


async def upload_menu_image(request: web.Request) -> web.Response:
    try:
        # Verify admin token (imzo ham tekshiriladi, faqat prefiks emas)
        if not check_auth(request):
            return web.json_response({'error': 'Unauthorized'}, status=401)

        # Read multipart form data
        reader = await request.multipart()
        field = await reader.next()

        if field.name != 'file':
            return web.json_response({'error': 'No file field'}, status=400)

        # Read file content
        file_content = await field.read()
        file_bytes = bytes(file_content)
        filename = field.filename or 'image.jpg'
        content_type = field.headers.get('Content-Type', 'image/jpeg')

        # Validate file size (5MB max)
        if len(file_bytes) > 5 * 1024 * 1024:
            return web.json_response({'error': 'File too large (max 5MB)'}, status=400)

        # Validate content type
        allowed_types = ['image/jpeg', 'image/png', 'image/webp']
        if content_type not in allowed_types:
            return web.json_response({'error': 'Invalid file type'}, status=400)

        # Generate unique filename
        import uuid
        ext = filename.rsplit('.', 1)[-1] if '.' in filename else 'jpg'
        unique_filename = f"menu/{uuid.uuid4()}.{ext}"

        # SETUP REQUIRED:
        # Go to Supabase → Storage → Create bucket "menu-images" → Make PUBLIC
        # Upload to Supabase Storage
        upload_result = db.client.storage.from_('menu-images').upload(
            path=unique_filename,
            file=file_bytes,
            file_options={
                "content-type": content_type,
                "upsert": "true"
            }
        )

        # Get public URL
        public_url = db.client.storage.from_('menu-images').get_public_url(unique_filename)

        logger.info(f"Image uploaded: {unique_filename}")
        return web.json_response({'url': public_url, 'filename': unique_filename})

    except Exception as e:
        logger.exception(f"Image upload error: {e}")
        return web.json_response({'error': str(e)}, status=500)
