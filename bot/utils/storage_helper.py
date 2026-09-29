import asyncio
import logging
import os
from datetime import datetime
from typing import Optional, Any

from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Configuration (environment variables)
# ---------------------------------------------------------------------------
from bot.config import config

SUPABASE_URL = os.getenv("PROJECT_URL")
SUPABASE_SERVICE_KEY = os.getenv("SERVICE_ROLE")
# Bucket name used for product images – loaded from config
IMAGE_BUCKET = config.STORAGE_BUCKET

# ---------------------------------------------------------------------------
# Structured logger – use JSON-friendly dict output for production logging.
# ---------------------------------------------------------------------------
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s %(extra)s",
        "%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Typed exceptions – hide raw Supabase errors from callers.
# ---------------------------------------------------------------------------
class StorageError(RuntimeError):
    """Base class for storage‑related errors."""

class UploadError(StorageError):
    """Raised when an upload cannot be completed."""

class DeleteError(StorageError):
    """Raised when deletion fails."""

# ---------------------------------------------------------------------------
# Helper to obtain a Supabase client – created lazily for testability.
# ---------------------------------------------------------------------------
def _get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise StorageError("Supabase credentials are not set in the environment")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def _get_storage() -> Any:
    client = _get_client()
    return client.storage.from_(IMAGE_BUCKET)

# ---------------------------------------------------------------------------
# Path generation helpers – deterministic, static paths with timestamped archive.
# ---------------------------------------------------------------------------
def _timestamp() -> str:
    # ISO format without colon to keep path safe for all providers.
    return datetime.utcnow().strftime("%Y%m%dT%H%M%S")

def _main_path(product_code: str) -> str:
    return f"products/{product_code}/main.webp"

def _thumb_path(product_code: str) -> str:
    return f"products/{product_code}/thumb.webp"

def _archive_path(product_code: str, original_path: str) -> str:
    # Preserve original filename for traceability.
    base, ext = os.path.splitext(os.path.basename(original_path))
    return f"archive/products/{product_code}/{base}_{_timestamp()}{ext}"


# ---------------------------------------------------------------------------
# Core async API – all heavy I/O runs in a thread pool via asyncio.to_thread.
# ---------------------------------------------------------------------------
async def upload_file(
    product_code: str,
    data: bytes,
    *,
    thumbnail: bool = False,
    kind: Optional[str] = None,
    content_type: str = "image/webp",
) -> str:
    """Upload *data* to Supabase Storage.

    Returns the public URL of the uploaded file.  The function is safe to call
    from an async event loop because the actual HTTP request is executed in a
    thread via :func:`asyncio.to_thread`.
    """
    is_thumb = thumbnail or (kind == "thumb")
    path = _thumb_path(product_code) if is_thumb else _main_path(product_code)
    logger.info(
        "Uploading image",
        extra={"product_code": product_code, "path": path, "thumbnail": is_thumb},
    )
    storage = _get_storage()
    try:
        # Supabase python client expects file‑like object.
        async def _upload():
            return storage.upload(
                path,
                data,
                file_options={"content-type": content_type, "x-upsert": "true"},
            )
        result = await asyncio.to_thread(_upload)
        # The client returns a Response object. Check status_code.
        if result.status_code != 200:
            raise UploadError(f"Upload failed with status {result.status_code}: {result.text}")
        url = storage.get_public_url(path)
        logger.info(
            "Upload succeeded",
            extra={"product_code": product_code, "url": url},
        )
        return url
    except Exception as exc:
        logger.error(
            "Upload failed",
            extra={"product_code": product_code, "path": path},
            exc_info=True,
        )
        raise UploadError(str(exc)) from exc


async def delete_file(path: str) -> None:
    """Delete a file at *path* from the bucket.

    Raises :class:`DeleteError` on failure.
    """
    logger.info("Deleting file", extra={"path": path})
    storage = _get_storage()
    try:
        async def _delete():
            return storage.remove([path])
        result = await asyncio.to_thread(_delete)
        # Supabase returns a list of dicts with 'name' for each deletion.
        if not isinstance(result, list):
            raise DeleteError(f"Unexpected delete response: {result}")
        logger.info("Deletion succeeded", extra={"path": path})
    except Exception as exc:
        logger.error(
            "Deletion failed",
            extra={"path": path},
            exc_info=True,
        )
        raise DeleteError(str(exc)) from exc


async def archive_file(product_code: str, original_path: str) -> str:
    """Move *original_path* to the archive folder.

    Returns the public URL of the archived file.
    """
    archive_path = _archive_path(product_code, original_path)
    logger.info(
        "Archiving file",
        extra={"original_path": original_path, "archive_path": archive_path},
    )
    storage = _get_storage()
    try:
        async def _move():
            return storage.move(original_path, archive_path)
        await asyncio.to_thread(_move)
        url = storage.get_public_url(archive_path)
        logger.info(
            "Archive move succeeded",
            extra={"archive_path": archive_path, "url": url},
        )
        return url
    except Exception as exc:
        logger.error(
            "Archive operation failed",
            extra={"original_path": original_path, "archive_path": archive_path},
            exc_info=True,
        )
        raise StorageError(str(exc)) from exc


async def get_public_url(path: str) -> str:
    """Return a public URL for *path* without performing any network request.
    The Supabase client builds the URL client‑side.
    """
    storage = _get_storage()
    return storage.get_public_url(path)

# Exported symbols – useful for ``from bot.utils.storage_helper import *``
__all__ = [
    "upload_file",
    "delete_file",
    "archive_file",
    "get_public_url",
    "UploadError",
    "DeleteError",
    "StorageError",
]

