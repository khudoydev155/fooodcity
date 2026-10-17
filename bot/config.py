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
    LOCAL_API_ONLY: bool = False
    LOCAL_POLLING: bool = False

    # ── Admin ──────────────────────────────────────────────────
    ADMIN_CHAT_ID: int = 0
    SUPERADMIN_IDS: List[int] = []
    ADMIN_PIN: str = "111111"

    # ── Business Rules ─────────────────────────────────────────
    LOYALTY_POINTS_PER_ORDER: int = 10
    LOYALTY_POINTS_VALUE: int = 10
    DELIVERY_FEE: int = 15000
    PORT: int = 8000

    # ── Click & Payme Payment Settings ─────────────────────────
    CLICK_SERVICE_ID: str = ""
    CLICK_MERCHANT_ID: str = ""
    CLICK_SECRET_KEY: str = ""
    CLICK_MERCHANT_USER_ID: str = ""

    PAYME_MERCHANT_ID: str = ""
    PAYME_SECRET_KEY: str = ""
    PAYME_TEST_MODE: bool = True

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


def validate_startup_config(cfg: "Settings") -> None:
    """
    Bot ishga tushishidan OLDIN kritik sozlamalarni tekshiradi.

    MUHIM: bu funksiya bo'lmasa, noto'g'ri/bo'sh konfiguratsiya bilan ham
    process "muvaffaqiyatli" ishga tushadi — masalan SUPABASE_URL bo'sh
    bo'lsa, ``DatabaseManager`` buni faqat log'ga yozib, ``db.client = None``
    holatida davom etadi. Natijada Railway health-check "OK" ko'rsatadi,
    lekin HAR BIR so'rov aslida ishlamaydi — muammo faqat foydalanuvchi
    shikoyat qilgandan keyin bilinadi. Fail-fast (darhol to'xtash) bunday
    "yarim ishlaydigan" holatning oldini oladi.
    """
    errors = []

    if not cfg.BOT_TOKEN:
        errors.append("BOT_TOKEN bo'sh — .env faylida BOT_TOKEN ni to'ldiring")
    if not cfg.SUPABASE_URL:
        errors.append("SUPABASE_URL bo'sh — .env (yoki PROJECT_URL) orqali to'ldiring")
    if not cfg.SUPABASE_SERVICE_KEY:
        errors.append("SUPABASE_SERVICE_KEY bo'sh — .env (yoki SERVICE_ROLE) orqali to'ldiring")
    if not cfg.WEBHOOK_URL and not (cfg.LOCAL_API_ONLY or cfg.LOCAL_POLLING):
        errors.append("WEBHOOK_URL bo'sh — Telegram webhook o'rnatib bo'lmaydi")

    # Standart qiymatlar — ular xavfsizlik uchun ATAYLAB zaif, faqat
    # local/dev muhitda ishlatish uchun. Production'da qoldirilsa, bu
    # butun himoyani (webhook imzosi / admin panel) bekor qiladi.
    if cfg.WEBHOOK_SECRET == "default_secret":
        errors.append(
            "WEBHOOK_SECRET hali standart qiymatda ('default_secret') — "
            "buni maxfiy, tasodifiy qatorga almashtiring, aks holda "
            "webhook xavfsizlik tekshiruvi ishlamaydi"
        )
    if cfg.ADMIN_PIN == "111111":
        errors.append(
            "ADMIN_PIN hali standart qiymatda ('111111') — bu admin "
            "panelni himoyasiz qoldiradi, .env orqali kuchli PIN o'rnating"
        )

    if errors:
        details = "\n".join(f"  • {e}" for e in errors)
        raise RuntimeError(
            f"❌ Konfiguratsiya xatosi — bot ISHGA TUSHMAYDI, avval tuzating:\n{details}"
        )
