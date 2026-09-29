# bot/services/image_service.py
"""Image Service – orchestration layer for Food City image pipeline.

Responsibilities:
* Validate and process raw image bytes (delegates to ``bot.utils.image_processor``).
* Upload main and thumbnail images to Supabase Storage (via ``bot.utils.storage_helper``).
* Archive any previously‑active image for the same product.
* Persist a ``menu_item_images`` record and update the related ``menu_items`` row.
* Provide transactional safety – on any failure the uploaded files are removed and DB changes rolled back.
* Detect duplicate images based on the processed SHA‑256 hash.

All I/O is async – blocking Pillow/Storage calls are executed in ``asyncio.to_thread``.
Structured ``logging`` is used; no ``print`` statements.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Tuple, Optional
from urllib.parse import urlparse

from bot.utils.image_processor import (
    validate_image,
    process_image,
    ImageValidationError,
    ImageProcessingError,
    ProcessedImage,
)
from bot.utils.storage_helper import (
    upload_file,
    delete_file,
    archive_file,
    get_public_url,
    StorageError,
    UploadError,
    DeleteError,
)
from bot.database import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data structures returned by the service
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ImageUploadResult:
    """Result of a successful (or duplicate) image upload.

    Attributes:
        main_url: Public URL of the main (800×800) image.
        thumb_url: Public URL of the thumbnail (300×300).
        was_duplicate: ``True`` if the image already existed for the product.
        raw_hash: SHA‑256 of the original uploaded bytes.
        processed_hash: SHA‑256 of the processed (webp) image.
        dimensions: ``(width, height)`` of the processed main image.
        size_main: Size in bytes of the main image.
        size_thumb: Size in bytes of the thumbnail image.
    """

    main_url: str
    thumb_url: str
    was_duplicate: bool = False
    raw_hash: str = ""
    processed_hash: str = ""
    dimensions: Tuple[int, int] = (0, 0)
    size_main: int = 0
    size_thumb: int = 0


class ImageServiceError(Exception):
    """Base class for unrecoverable errors raised by :class:`ImageService`."""


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------
def _extract_storage_path(public_url: str) -> str:
    """Supabase public URLs are of the form ``https://<host>/storage/v1/object/public/<bucket>/<path>``.
    This function returns the ``<path>`` part which is needed for ``delete_file``/``archive_file``.
    """
    parsed = urlparse(public_url)
    # The path after '/public/' is the storage key.
    parts = parsed.path.split("/public/")
    return parts[1] if len(parts) == 2 else ""


# ---------------------------------------------------------------------------
# Core orchestration class (stateless – all methods are ``@staticmethod``)
# ---------------------------------------------------------------------------
class ImageService:
    """High‑level, async‑safe image upload orchestration.

    The class contains only ``@staticmethod`` members – it does not maintain state
    and can be used directly via ``await ImageService.upload_product_image(...)``.
    """

    @staticmethod
    async def upload_product_image(
        product_code: str,
        raw_bytes: bytes,
        uploaded_by: int = 0,
    ) -> ImageUploadResult:
        """Validate, process, store and record an image for ``product_code``.

        The function guarantees **no orphan files** and **consistent DB rows** –
        if any step fails a rollback is performed.
        """
        logger.info(
            "image_service.upload.start",
            extra={"product_code": product_code},
        )

        # -------------------------------------------------------------------
        # 1. Validation
        # -------------------------------------------------------------------
        try:
            val_res = validate_image(raw_bytes)  # raises ImageValidationError on failure
            allowed_mimes = ["image/jpeg", "image/png", "image/webp"]
            if val_res.mime not in allowed_mimes:
                raise ImageValidationError("Faqat JPG, PNG yoki WEBP formatidagi rasmlar qabul qilinadi")
        except ImageValidationError as exc:
            logger.warning(
                "image_service.validation_failed",
                extra={"product_code": product_code, "error": str(exc)},
            )
            raise ImageServiceError(str(exc)) from exc

        # -------------------------------------------------------------------
        # 2. Processing (CPU‑bound – run in a thread pool)
        # -------------------------------------------------------------------
        try:
            processed: ProcessedImage = await process_image(raw_bytes)
        except ImageProcessingError as exc:
            logger.error(
                "image_service.processing_failed",
                extra={"product_code": product_code, "error": str(exc)},
            )
            raise ImageServiceError(str(exc)) from exc

        # -------------------------------------------------------------------
        # 3. Fetch menu item and duplicate detection (by raw hash in image_hash)
        # -------------------------------------------------------------------
        menu_item = await db.get_menu_item_by_product_code(product_code)
        if not menu_item:
            raise ImageServiceError(f"Menu item not found for product code: {product_code}")
        menu_item_id = menu_item["id"]

        existing = await db._run_sync(
            db.client.table("menu_item_images")
            .select("id", "image_hash")
            .eq("menu_item_id", menu_item_id)
            .eq("is_active", True)
            .eq("is_deleted", False)
            .execute,
        )
        for rec in (existing.data or []):
            if rec.get("image_hash") == processed.raw_hash:
                logger.info(
                    "image_service.duplicate_detected",
                    extra={"product_code": product_code, "image_id": rec["id"]},
                )
                return ImageUploadResult(
                    main_url=menu_item.get("image_url") or "",
                    thumb_url=menu_item.get("image_thumb_url") or "",
                    was_duplicate=True,
                    raw_hash=processed.raw_hash,
                    processed_hash=processed.processed_hash,
                    dimensions=processed.dimensions,
                    size_main=len(processed.main_bytes),
                    size_thumb=len(processed.thumb_bytes),
                )

        # -------------------------------------------------------------------
        # 4. Upload main & thumbnail (async, each can raise UploadError)
        # -------------------------------------------------------------------
        try:
            main_url = await upload_file(product_code, processed.main_bytes, kind="main")
            thumb_url = await upload_file(product_code, processed.thumb_bytes, kind="thumb")
        except UploadError as exc:
            logger.error(
                "image_service.upload_failed",
                extra={"product_code": product_code, "error": str(exc)},
            )
            raise ImageServiceError(str(exc)) from exc

        # -------------------------------------------------------------------
        # 5. Archive any previously active image for this product
        # -------------------------------------------------------------------
        archived_rows = []
        try:
            # Mark previous DB rows as inactive / archived using db manager helper
            archived_rows = await db.archive_active_images(menu_item_id)
            
            # Archive the physical files in storage
            for prev in archived_rows:
                if prev.get("image_url"):
                    prev_path = _extract_storage_path(prev["image_url"])
                    if prev_path:
                        await archive_file(product_code, prev_path)
                if prev.get("thumb_url"):
                    prev_thumb_path = _extract_storage_path(prev["thumb_url"])
                    if prev_thumb_path:
                        await archive_file(product_code, prev_thumb_path)
        except (DeleteError, StorageError) as exc:
            # If archiving fails we must rollback the freshly uploaded files
            logger.error(
                "image_service.archive_failed_rollback",
                extra={"product_code": product_code, "error": str(exc)},
            )
            # Roll back by deleting the new uploads
            await asyncio.gather(
                delete_file(_extract_storage_path(main_url)),
                delete_file(_extract_storage_path(thumb_url)),
                return_exceptions=True,
            )
            # Restore the archived database rows to active
            for prev in archived_rows:
                await db._run_sync(
                    db.client.table("menu_item_images")
                    .update({"is_active": True, "is_archived": False, "archived_at": None})
                    .eq("id", prev["id"])
                    .execute
                )
            raise ImageServiceError("archive failure – uploads rolled back") from exc

        # -------------------------------------------------------------------
        # 6. Persist image record (DB) – wrap in a try/except to enable rollback
        # -------------------------------------------------------------------
        image_id = str(uuid.uuid4())
        record = {
            "id": image_id,
            "menu_item_id": menu_item_id,
            "image_type": "MAIN",
            "image_url": main_url,
            "thumb_url": thumb_url,
            "storage_path": f"products/{product_code}/main.webp",
            "thumb_path": f"products/{product_code}/thumb.webp",
            "image_hash": processed.raw_hash,
            "mime_type": "image/webp",
            "file_size": len(processed.main_bytes),
            "width": processed.dimensions[0],
            "height": processed.dimensions[1],
            "is_primary": True,
            "is_active": True,
            "is_archived": False,
            "is_deleted": False,
            "uploaded_by": uploaded_by,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            inserted = await db.insert_image_record(record)
            if not inserted:
                raise ImageServiceError("Failed to insert image record into DB")
        except Exception as exc:
            logger.error(
                "image_service.db_insert_failed_rollback",
                extra={"product_code": product_code, "error": str(exc)},
            )
            # Remove uploaded files to avoid orphan objects
            await asyncio.gather(
                delete_file(_extract_storage_path(main_url)),
                delete_file(_extract_storage_path(thumb_url)),
                return_exceptions=True,
            )
            # Restore the archived database rows to active
            for prev in archived_rows:
                await db._run_sync(
                    db.client.table("menu_item_images")
                    .update({"is_active": True, "is_archived": False, "archived_at": None})
                    .eq("id", prev["id"])
                    .execute
                )
            raise ImageServiceError("DB insert failed – uploads rolled back") from exc

        # -------------------------------------------------------------------
        # 7. Update the menu_items row with the new URLs
        # -------------------------------------------------------------------
        try:
            updated = await db.update_menu_item_image_urls(menu_item_id, main_url, thumb_url)
            if not updated:
                raise ImageServiceError("Failed to update menu_items URLs")
        except Exception as exc:
            logger.error(
                "image_service.menu_item_update_failed_rollback",
                extra={"product_code": product_code, "error": str(exc)},
            )
            # Clean up DB record
            await db._run_sync(
                db.client.table("menu_item_images").delete().eq("id", image_id).execute,
            )
            # Remove uploaded files to avoid orphan objects
            await asyncio.gather(
                delete_file(_extract_storage_path(main_url)),
                delete_file(_extract_storage_path(thumb_url)),
                return_exceptions=True,
            )
            # Restore the archived database rows to active
            for prev in archived_rows:
                await db._run_sync(
                    db.client.table("menu_item_images")
                    .update({"is_active": True, "is_archived": False, "archived_at": None})
                    .eq("id", prev["id"])
                    .execute
                )
            raise ImageServiceError("menu_items update failed – all changes rolled back") from exc

        # -------------------------------------------------------------------
        # 8. Return successful result
        # -------------------------------------------------------------------
        logger.info(
            "image_service.upload_success",
            extra={"product_code": product_code, "image_id": image_id},
        )
        return ImageUploadResult(
            main_url=main_url,
            thumb_url=thumb_url,
            was_duplicate=False,
            raw_hash=processed.raw_hash,
            processed_hash=processed.processed_hash,
            dimensions=processed.dimensions,
            size_main=len(processed.main_bytes),
            size_thumb=len(processed.thumb_bytes),
        )

