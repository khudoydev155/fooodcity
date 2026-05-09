from bot.config import config
from supabase import create_client, Client
import logging

logger = logging.getLogger(__name__)
client: Client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)

async def upload_image(file_bytes: bytes, filename: str, content_type: str) -> str:
    try:
        res = client.storage.from_("menu-images").upload(
            path=filename,
            file=file_bytes,
            file_options={"content-type": content_type, "cache-control": "3600", "upsert": "true"}
        )
        return get_public_url(filename)
    except Exception as e:
        logger.error(f"Upload error: {e}")
        return ""

async def delete_image(filename: str):
    try:
        client.storage.from_("menu-images").remove([filename])
    except Exception as e:
        logger.error(f"Delete image error: {e}")

def get_public_url(filename: str) -> str:
    res = client.storage.from_("menu-images").get_public_url(filename)
    return res
