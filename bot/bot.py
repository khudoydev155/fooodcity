import asyncio
import logging
from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from bot.config import config
from bot.database import db
from bot.handlers import customer, admin, menu_wizard
from bot.middlewares.auth import AuthMiddleware
from bot.middlewares.throttle import ThrottleMiddleware
from bot.middlewares.i18n import I18nMiddleware
from bot.middlewares.license import LicenseCheckMiddleware
from bot.api.router import routes, setup_cors
from bot.api.admin_api import upload_menu_image
from aiogram.types import ErrorEvent
import os
import sentry_sdk

sentry_dsn = getattr(config, 'SENTRY_DSN', None) or os.getenv("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        traces_sample_rate=1.0,
        send_default_pii=True
    )

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

async def on_startup(bot: Bot) -> None:
    webhook_url = f"{config.WEBHOOK_URL}/webhook/{config.WEBHOOK_SECRET}"
    await bot.delete_webhook(drop_pending_updates=True)
    await bot.set_webhook(
        url=webhook_url,
        allowed_updates=["message", "callback_query", "web_app_data"],
        secret_token=config.WEBHOOK_SECRET # Security Fix: Enforce secret token header
    )
    logger.info(f"🚀 Webhook set to: {webhook_url}")

async def on_shutdown(bot: Bot):
    logger.info("🔻 Shutting down...")
    await bot.session.close()

async def health(request):
    return web.Response(text='{"status":"ok"}', content_type='application/json')

def main():
    # Initialize Bot & Dispatcher with FSM Storage
    from aiogram.fsm.storage.memory import MemoryStorage
    bot = Bot(token=config.BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=MemoryStorage())

    # Register Middlewares
    dp.update.outer_middleware(LicenseCheckMiddleware(cache_timeout=120))
    dp.message.outer_middleware(ThrottleMiddleware())
    dp.message.outer_middleware(AuthMiddleware())
    dp.message.outer_middleware(I18nMiddleware())
    
    # Register Routers (Admin first to catch /admin)
    dp.include_router(admin.router)
    dp.include_router(customer.router)
    dp.include_router(menu_wizard.router)

    @dp.errors()
    async def global_error_handler(event: ErrorEvent):
        logger.exception("Global exception handled: %s", event.exception)
        # Sentry captures it automatically via integration, but local log is needed.
        # Fallback response to user could be added here if needed.

    # Startup/Shutdown tasks
    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)
    
    # Setup Aiohttp App
    app = web.Application()
    # Register middlewares
    from bot.api.security import security_middleware
    from bot.utils.rate_limiter import rate_limit_middleware
    app.middlewares.append(security_middleware)
    app.middlewares.append(rate_limit_middleware)
    app.router.add_get('/health', health)
    app.router.add_post('/api/admin/menu/upload', upload_menu_image)
    
    # Mount REST API
    app.add_routes(routes)
    setup_cors(app)
    # Configure Webhook handler with Secret Token Security
    webhook_path = f"/webhook/{config.WEBHOOK_SECRET}"
    handler = SimpleRequestHandler(
        dispatcher=dp, 
        bot=bot,
        secret_token=config.WEBHOOK_SECRET # Security Fix: Check X-Telegram-Bot-Api-Secret-Token
    )
    handler.register(app, path=webhook_path)
    setup_application(app, dp, bot=bot)
    app['bot'] = bot  # Expose bot to aiohttp routes for broadcast
    
    # Start Server
    logger.info(f"✨ Starting server on port {config.PORT}")
    web.run_app(app, host='0.0.0.0', port=config.PORT)

if __name__ == "__main__":
    main()
