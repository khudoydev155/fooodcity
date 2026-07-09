from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    # ── Core ──────────────────────────────────────────────────
    BOT_TOKEN: str = ""
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_ANON_KEY: str = ""

    # ── App URLs ───────────────────────────────────────────────
    MINI_APP_URL: str = ""
    ADMIN_PANEL_URL: str = ""
    WEBHOOK_URL: str = ""
    WEBHOOK_SECRET: str = "default_secret"

    # ── Admin ──────────────────────────────────────────────────
    ADMIN_CHAT_ID: int = 0
    SUPERADMIN_IDS: List[int] = []
    ADMIN_PIN: str = "123456"

    # ── Business Rules ─────────────────────────────────────────
    LOYALTY_POINTS_PER_ORDER: int = 10
    LOYALTY_POINTS_VALUE: int = 10
    DELIVERY_FEE: int = 15000
    PORT: int = 8000

    # ── Storage (Phase 2) ──────────────────────────────────────
    # Supabase Storage bucket name — must be created manually in dashboard
    STORAGE_BUCKET: str = "menu-images"

    # ── Image Pipeline (Phase 2) ───────────────────────────────
    IMAGE_MAX_SIZE_MB: int = 10
    IMAGE_MAIN_MAX_PX: int = 800       # max dimension for main image
    IMAGE_THUMB_PX: int = 300          # exact size for square thumbnail
    IMAGE_WEBP_QUALITY: int = 82       # WebP quality (82 = best size/quality tradeoff)
    IMAGE_ARCHIVE_RETENTION_DAYS: int = 30   # days before archived images are purged

    # ── Upload Rate Limiting (Phase 2) ─────────────────────────
    UPLOAD_RATE_LIMIT: int = 10        # uploads per admin per minute
    UPLOAD_LOCK_TTL_SECONDS: int = 120 # max seconds an upload lock is held

    def __init__(self, **values):
        super().__init__(**values)
        import os
        if not self.SUPABASE_URL:
            self.SUPABASE_URL = os.getenv("PROJECT_URL", "")
        if not self.SUPABASE_SERVICE_KEY:
            self.SUPABASE_SERVICE_KEY = os.getenv("SERVICE_ROLE", "")
        if not self.SUPABASE_ANON_KEY:
            self.SUPABASE_ANON_KEY = os.getenv("ANON_PUBLIC", "")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


config = Settings()

