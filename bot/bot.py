import asyncio
import logging
from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from bot.config import config, validate_startup_config
from bot.database import db
from bot.handlers import customer, admin, menu_wizard, courier
from bot.middlewares.auth import AuthMiddleware
from bot.middlewares.throttle import ThrottleMiddleware
from bot.middlewares.i18n import I18nMiddleware
from bot.middlewares.license import LicenseCheckMiddleware
from bot.api.router import MAX_RECEIPT_UPLOAD_BYTES, routes, setup_cors
from bot.api import admin_api  # noqa: F401 — import triggers /api/admin/analytics route registration
from bot.api import promo_api  # noqa: F401 — registers public and admin promo routes
from bot.api import payments_api  # noqa: F401 — registers Click & Payme webhook and customer routes
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

async def setup_chat_menu_button(bot: Bot) -> None:
    if config.MINI_APP_URL:
        try:
            from aiogram.types import MenuButtonWebApp, WebAppInfo
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="🍽 Menyu",
                    web_app=WebAppInfo(url=config.MINI_APP_URL)
                )
            )
            logger.info("Telegram Chat Menu Button configured: %s", config.MINI_APP_URL)
        except Exception as e:
            logger.warning("Failed to configure chat menu button: %s", e)

async def on_startup(bot: Bot) -> None:
    await setup_chat_menu_button(bot)
    if config.LOCAL_API_ONLY or config.LOCAL_POLLING:
        logger.info("Local mode: Telegram webhook was left unchanged.")
        return

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
    # MUHIM: ilgari bu doim, hech narsani tekshirmasdan "ok" qaytarardi —
    # Railway health-check shu javobga qarab deploy'ni "muvaffaqiyatli"
    # deb hisoblaydi. Agar Supabase kalitlari xato/eskirgan bo'lsa ham,
    # bunday "hamma narsa yaxshi" ko'rinishi haqiqatni yashirar edi. Endi
    # DB haqiqatan ham ulanganini tekshiradi.
    if db.client is None:
        return web.json_response({"status": "error", "detail": "database not configured"}, status=503)
    try:
        await asyncio.wait_for(
            asyncio.to_thread(lambda: db.client.table("categories").select("id").limit(1).execute()),
            timeout=5,
        )
    except Exception as e:
        logger.error(f"health check: database unreachable: {e}")
        return web.json_response({"status": "error", "detail": "database unreachable"}, status=503)
    return web.json_response({"status": "ok"})

def main():
    # MUHIM: konfiguratsiya tekshiruvi ENG BIRINCHI — Bot/Dispatcher
    # yaratilishidan oldin. Xato/yetishmagan sozlama bilan "yarim
    # ishlagan" process ko'tarilishining oldini oladi.
    validate_startup_config(config)

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
    dp.include_router(courier.router)
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
    app = web.Application(client_max_size=MAX_RECEIPT_UPLOAD_BYTES + 1024 * 1024)
    # Register middlewares
    from bot.api.security import security_middleware
    from bot.utils.rate_limiter import rate_limit_middleware
    app.middlewares.append(security_middleware)
    app.middlewares.append(rate_limit_middleware)
    app.router.add_get('/health', health)
    
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
    if not config.LOCAL_POLLING:
        setup_application(app, dp, bot=bot)
    app['bot'] = bot  # Expose bot to aiohttp routes for broadcast
    
    if config.LOCAL_POLLING:
        async def run_local() -> None:
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, host="127.0.0.1", port=config.PORT)
            await site.start()
            logger.info("Local API server started; Telegram bot is polling for updates.")
            try:
                await setup_chat_menu_button(bot)
                await dp.start_polling(bot)
            finally:
                await runner.cleanup()

        asyncio.run(run_local())
        return

    # Start Server
    logger.info(f"✨ Starting server on port {config.PORT}")
    web.run_app(app, host='0.0.0.0', port=config.PORT)

if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        # validate_startup_config() shu yerga tushadi — chiroyli, aniq
        # xabar bilan to'xtaydi (chalkash Python traceback o'rniga).
        logger.critical(str(e))
        raise SystemExit(1)
