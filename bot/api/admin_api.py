from aiohttp import web
from bot.api.router import routes, check_auth
from bot.database import db

@routes.get("/api/admin/stats")
async def get_stats(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    
    # Mocked stats for demo
    stats = {
        "today": {"orders": 12, "revenue": 1500000, "new_users": 5, "cancelled": 1},
        "revenue_7_days": [1000000, 1200000, 1500000, 900000, 1100000, 1600000, 1500000],
        "top_items": [
            {"name": "Pepperoni", "count": 45},
            {"name": "Klassik Burger", "count": 30},
            {"name": "Klassik Kombo", "count": 25}
        ]
    }
    return web.json_response(stats)

@routes.get("/api/admin/orders")
async def get_admin_orders(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    status = request.query.get("status")
    if status == "Hammasi":
        status = None
        
    orders = await db.get_all_orders(status=status)
    return web.json_response(orders)

@routes.post("/api/admin/orders/{id}/status")
async def update_admin_order_status(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    order_id = request.match_info["id"]
    data = await request.json()
    res = await db.update_order_status(order_id, data.get("status"))
    return web.json_response({"success": True})

@routes.get("/api/admin/menu")
async def get_admin_menu(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    items = await db.get_menu_items(available_only=False)
    return web.json_response(items)

@routes.post("/api/admin/menu")
async def create_admin_menu(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    # Assume parsed admin user ID is 0 for simplicity here
    res = await db.create_menu_item(data, 0)
    return web.json_response(res)

@routes.put("/api/admin/menu/{id}")
async def update_admin_menu(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    item_id = request.match_info["id"]
    data = await request.json()
    res = await db.update_menu_item(item_id, data)
    return web.json_response(res)

@routes.delete("/api/admin/menu/{id}")
async def delete_admin_menu(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    item_id = request.match_info["id"]
    await db.delete_menu_item(item_id)
    return web.json_response({"success": True})

@routes.get("/api/admin/users")
async def get_admin_users(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    users = await db.get_all_users()
    return web.json_response(users)

@routes.post("/api/admin/users/{id}/block")
async def block_admin_user(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    user_id = int(request.match_info["id"])
    await db.block_user(user_id)
    return web.json_response({"success": True})

@routes.post("/api/admin/users/{id}/unblock")
async def unblock_admin_user(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    user_id = int(request.match_info["id"])
    await db.unblock_user(user_id)
    return web.json_response({"success": True})

@routes.get("/api/admin/coupons")
async def get_admin_coupons(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    coupons = await db.get_all_coupons()
    return web.json_response(coupons)

@routes.post("/api/admin/coupons")
async def create_admin_coupon(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    data = await request.json()
    res = await db.create_coupon(data, 0)
    return web.json_response(res)

@routes.put("/api/admin/coupons/{id}")
async def toggle_admin_coupon(request: web.Request):
    if not check_auth(request): return web.json_response({"error": "Unauthorized"}, status=401)
    coupon_id = request.match_info["id"]
    res = await db.toggle_coupon(coupon_id)
    return web.json_response({"is_active": res})
