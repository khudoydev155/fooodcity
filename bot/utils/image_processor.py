import io
import asyncio
import hashlib
import mimetypes
from dataclasses import dataclass
from enum import Enum
from typing import Tuple

from PIL import Image, ExifTags, UnidentifiedImageError

# ---------------------------------------------------------------------------
# Constants & configuration
# ---------------------------------------------------------------------------
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MiB
MAX_IMAGE_PIXELS = 12_000_000  # safety cap for decompression bomb protection
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

MAIN_MAX_SIZE = (800, 800)
THUMB_SIZE = (300, 300)
WEBP_QUALITY = 82

# Robust fallback mapping in case Image.MIME is incomplete
FALLBACK_MIME = {
    "JPEG": "image/jpeg",
    "JPG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
}

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class ImageValidationError(Exception):
    """Raised when an image fails validation checks."""

class ImageProcessingError(Exception):
    """Raised when processing (orientation, conversion, etc.) fails."""

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
class ImageMime(Enum):
    JPEG = "image/jpeg"
    PNG = "image/png"
    WEBP = "image/webp"

@dataclass(frozen=True)
class ImageValidationResult:
    mime: str
    width: int
    height: int
    size_bytes: int

@dataclass(frozen=True)
class ProcessedImage:
    main_bytes: bytes
    thumb_bytes: bytes
    mime: str
    dimensions: Tuple[int, int]
    raw_hash: str
    processed_hash: str
    main_size: int
    thumb_size: int

# ---------------------------------------------------------------------------
# Helper functions – pure, no I/O beyond provided bytes
# ---------------------------------------------------------------------------
def _get_mime_type(data: bytes) -> str:
    """Return a MIME type based on magic bytes using Pillow.
    Falls back to generic binary if Pillow cannot guess.
    """
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            if not fmt:
                return "application/octet-stream"
            detected_mime = None
            if hasattr(Image, "MIME") and isinstance(Image.MIME, dict):
                detected_mime = Image.MIME.get(fmt)
            if not detected_mime:
                detected_mime = FALLBACK_MIME.get(fmt.upper())
            return detected_mime or "application/octet-stream"
    except Exception:
        return "application/octet-stream"

def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

# ---------------------------------------------------------------------------
# Validation pipeline
# ---------------------------------------------------------------------------
def validate_image(data: bytes) -> ImageValidationResult:
    """Validate raw image bytes.

    Checks performed:
    * Size limit (10 MiB)
    * Pillow can open the image (detects non‑image blobs)
    * Not an animated GIF or WebP (single frame only)
    * Decompression bomb protection via Pillow's MAX_IMAGE_PIXELS
    * Returns mime, dimensions and size for downstream use.
    """
    if len(data) > MAX_FILE_SIZE:
        raise ImageValidationError(f"File exceeds maximum allowed size of {MAX_FILE_SIZE // (1024 * 1024)} MiB")

    try:
        # Pillow will raise an exception for corrupted/fake images
        with Image.open(io.BytesIO(data)) as img:
            img.verify()  # verify integrity without loading pixel data
    except (UnidentifiedImageError, OSError, ValueError, TypeError) as exc:
        raise ImageValidationError("File is not a recognizable image or is corrupted") from exc

    # Re‑open for attribute inspection (verify() leaves file in closed/invalidated state)
    try:
        with Image.open(io.BytesIO(data)) as img:
            # Reject animated formats – GIF/WebP with multiple frames
            if getattr(img, "is_animated", False) or getattr(img, "n_frames", 1) > 1:
                raise ImageValidationError("Animated images are not supported")

            fmt = img.format
            if not fmt:
                raise ImageValidationError("Unable to determine image format")

            # Compare Pillow-detected format with actual MIME from Image.MIME / FALLBACK_MIME
            detected_mime = None
            if hasattr(Image, "MIME") and isinstance(Image.MIME, dict):
                detected_mime = Image.MIME.get(fmt)
            if not detected_mime:
                detected_mime = FALLBACK_MIME.get(fmt.upper())

            if not detected_mime:
                raise ImageValidationError(f"Unsupported or fake image format: {fmt}")

            # Verify that the image is not a renamed non-image payload.
            try:
                img.load()
            except Exception as load_exc:
                raise ImageValidationError("Corrupted image structure or renamed non-image payload") from load_exc

            width, height = img.size
            if width <= 0 or height <= 0:
                raise ImageValidationError("Invalid image dimensions")

            return ImageValidationResult(
                mime=detected_mime,
                width=width,
                height=height,
                size_bytes=len(data)
            )
    except ImageValidationError:
        raise
    except Exception as exc:
        raise ImageValidationError("Failed to validate image structure") from exc

# ---------------------------------------------------------------------------
# Processing pipeline (async‑friendly)
# ---------------------------------------------------------------------------
def _process_image_sync(data: bytes) -> ProcessedImage:
    """Synchronous implementation used by the async wrapper.
    Returns ProcessedImage containing webp payloads, hashes and sizes.
    """
    raw_hash = _hash_bytes(data)
    try:
        in_buf = io.BytesIO(data)
        try:
            with Image.open(in_buf) as img:
                # Normalise orientation using EXIF tag if present
                try:
                    for orientation in ExifTags.TAGS.keys():
                        if ExifTags.TAGS[orientation] == "Orientation":
                            break
                    exif = img._getexif()
                    if exif and orientation in exif:
                        ori = exif[orientation]
                        method = {
                            2: Image.FLIP_LEFT_RIGHT,
                            3: Image.ROTATE_180,
                            4: Image.FLIP_TOP_BOTTOM,
                            5: (Image.FLIP_LEFT_RIGHT, Image.ROTATE_90),
                            6: Image.ROTATE_270,
                            7: (Image.FLIP_LEFT_RIGHT, Image.ROTATE_270),
                            8: Image.ROTATE_90,
                        }.get(ori)
                        if method:
                            if isinstance(method, tuple):
                                for m in method:
                                    img = img.transpose(m)
                            else:
                                img = img.transpose(method)
                except Exception:
                    # If EXIF handling fails we continue without orientation fix
                    pass

                # Strip EXIF – convert to RGB which drops most metadata
                img_rgb = img.convert("RGB")

                # Resize preserving aspect ratio for main image
                main_img = img_rgb.copy()
                main_img.thumbnail(MAIN_MAX_SIZE, Image.LANCZOS)

                # Create thumbnail (exact 300x300 center-crop)
                # Resize shortest side first, then center-crop to exact 300x300
                w, h = img_rgb.size
                if w > h:
                    new_h = 300
                    new_w = int(w * (300 / h))
                    thumb_img = img_rgb.resize((new_w, new_h), Image.LANCZOS)
                    left = (new_w - 300) // 2
                    thumb_img = thumb_img.crop((left, 0, left + 300, 300))
                else:
                    new_w = 300
                    new_h = int(h * (300 / w))
                    thumb_img = img_rgb.resize((new_w, new_h), Image.LANCZOS)
                    top = (new_h - 300) // 2
                    thumb_img = thumb_img.crop((0, top, 300, top + 300))

                # Helper to save to BytesIO as WebP
                def _save_webp(pil_img: Image.Image) -> bytes:
                    buf = io.BytesIO()
                    try:
                        pil_img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
                        return buf.getvalue()
                    finally:
                        buf.close()

                main_bytes = _save_webp(main_img)
                thumb_bytes = _save_webp(thumb_img)

                # Close all Pillow images explicitly to prevent memory leaks
                main_img.close()
                thumb_img.close()
                img_rgb.close()

                processed_hash = _hash_bytes(main_bytes + thumb_bytes)
                return ProcessedImage(
                    main_bytes=main_bytes,
                    thumb_bytes=thumb_bytes,
                    mime=ImageMime.WEBP.value,
                    dimensions=main_img.size,
                    raw_hash=raw_hash,
                    processed_hash=processed_hash,
                    main_size=len(main_bytes),
                    thumb_size=len(thumb_bytes),
                )
        finally:
            in_buf.close()
    except Exception as exc:
        raise ImageProcessingError("Failed to process image") from exc

async def process_image(data: bytes) -> ProcessedImage:
    """Async wrapper that runs the heavy Pillow work in a thread pool.
    This guarantees the event loop stays responsive on Railway / Heroku‑style runtimes.
    """
    return await asyncio.to_thread(_process_image_sync, data)

# ---------------------------------------------------------------------------
# Public API – combines validation and processing
# ---------------------------------------------------------------------------
async def validate_and_process(data: bytes) -> ProcessedImage:
    """Validate the raw image and, if it passes, process it.
    Raises ImageValidationError or ImageProcessingError.
    """
    # Validation is cheap; we run it synchronously before off‑loading heavy work.
    validate_image(data)
    return await process_image(data)

__all__ = [
    "ImageValidationError",
    "ImageProcessingError",
    "ImageValidationResult",
    "ProcessedImage",
    "validate_image",
    "process_image",
    "validate_and_process",
]
