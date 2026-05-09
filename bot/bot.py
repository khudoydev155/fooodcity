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
from bot.api.router import routes, setup_cors
import bot.api.auth_api
import bot.api.admin_api
import bot.api.health_api

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

async def on_startup(bot: Bot):
    logger.info("Bot starting up...")
    try:
        # Check DB connection
        test_cats = await db.get_categories()
        logger.info(f"DB Connected! Categories found: {len(test_cats)}")
    except Exception as e:
        logger.error(f"Failed to connect to DB: {e}")
        
    await bot.set_webhook(f"{config.WEBHOOK_URL}/webhook/{config.WEBHOOK_SECRET}", drop_pending_updates=True)
    logger.info(f"Webhook set to {config.WEBHOOK_URL}/webhook/{config.WEBHOOK_SECRET}")

async def on_shutdown(bot: Bot):
    logger.info("Bot shutting down...")
    await bot.delete_webhook(drop_pending_updates=True)

def main():
    bot = Bot(token=config.BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()

    dp.message.outer_middleware(ThrottleMiddleware())
    dp.message.outer_middleware(AuthMiddleware())
    dp.message.outer_middleware(I18nMiddleware())
    
    dp.callback_query.outer_middleware(ThrottleMiddleware())
    dp.callback_query.outer_middleware(AuthMiddleware())
    dp.callback_query.outer_middleware(I18nMiddleware())

    dp.include_router(customer.router)
    dp.include_router(menu_wizard.router)
    dp.include_router(admin.router)

    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)

    app = web.Application()
    
    # Mount bot webhook
    webhook_requests_handler = SimpleRequestHandler(
        dispatcher=dp,
        bot=bot,
        secret_token=config.WEBHOOK_SECRET
    )
    webhook_requests_handler.register(app, path=f"/webhook/{config.WEBHOOK_SECRET}")
    setup_application(app, dp, bot=bot)
    
    # Mount REST API
    app.add_routes(routes)
    setup_cors(app)
    
    # Run aiohttp server
    web.run_app(app, host="0.0.0.0", port=config.PORT)

if __name__ == "__main__":
    main()
