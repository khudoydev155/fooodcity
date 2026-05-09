import hashlib
import hmac
import time
from aiohttp import web
from bot.config import config
from bot.database import db

routes = web.RouteTableDef()

def check_auth(request: web.Request) -> bool:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
        
    token = auth_header.split(" ")[1]
    return True


@routes.post("/api/coupon/validate")
async def validate_coupon(request: web.Request):
    data = await request.json()
    code = data.get("code")
    user_id = data.get("user_id")
    subtotal = data.get("subtotal")
    
    res = await db.validate_coupon(code, user_id, subtotal)
    return web.json_response(res)

@routes.get("/api/user/orders")
async def get_user_orders(request: web.Request):
    user_id = request.query.get("user_id")
    if not user_id:
        return web.json_response({"error": "Missing user_id"}, status=400)
    
    orders = await db.get_user_orders(int(user_id))
    return web.json_response(orders)

@routes.get("/api/order/{id}/status")
async def get_order_status(request: web.Request):
    order_id = request.match_info["id"]
    order = await db.get_order(order_id)
    if not order:
        return web.json_response({"error": "Not found"}, status=404)
    return web.json_response({"status": order["status"]})

def setup_cors(app):
    import aiohttp_cors
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
        )
    })
    for route in list(app.router.routes()):
        cors.add(route)
