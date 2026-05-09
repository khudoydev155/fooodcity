from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    BOT_TOKEN: str
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_ANON_KEY: str
    MINI_APP_URL: str
    ADMIN_PANEL_URL: str
    ADMIN_CHAT_ID: int
    SUPERADMIN_IDS: List[int] = []
    WEBHOOK_URL: str = ""
    WEBHOOK_SECRET: str = "default_secret"
    LOYALTY_POINTS_PER_ORDER: int = 10
    LOYALTY_POINTS_VALUE: int = 10
    DELIVERY_FEE: int = 15000
    PORT: int = 8000

    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

config = Settings()
