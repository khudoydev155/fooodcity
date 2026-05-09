from supabase import create_client, Client
from bot.config import config
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class Database:
    def __init__(self):
        self.client: Client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)

    # USERS
    async def get_or_create_user(self, tg_user):
        try:
            res = self.client.table("users").select("*").eq("id", tg_user.id).execute()
            if res.data:
                self.client.table("users").update({"last_active": "now()"}).eq("id", tg_user.id).execute()
                return res.data[0]
            
            new_user = {
                "id": tg_user.id,
                "username": tg_user.username,
                "full_name": tg_user.full_name,
                "language": tg_user.language_code if tg_user.language_code in ['uz', 'ru', 'en'] else 'uz'
            }
            res = self.client.table("users").insert(new_user).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"DB Error get_or_create_user: {e}")
            return None

    async def get_user(self, user_id: int):
        res = self.client.table("users").select("*").eq("id", user_id).execute()
        return res.data[0] if res.data else None

    async def update_user_language(self, user_id: int, lang: str):
        self.client.table("users").update({"language": lang}).eq("id", user_id).execute()

    async def update_user_activity(self, user_id: int):
        self.client.table("users").update({"last_active": "now()"}).eq("id", user_id).execute()

    async def block_user(self, user_id: int):
        self.client.table("users").update({"is_blocked": True}).eq("id", user_id).execute()

    async def unblock_user(self, user_id: int):
        self.client.table("users").update({"is_blocked": False}).eq("id", user_id).execute()

    async def get_all_users(self, limit: int = 50, offset: int = 0, search: str = ""):
        query = self.client.table("users").select("*")
        if search:
            query = query.or_(f"username.ilike.%{search}%,full_name.ilike.%{search}%")
        res = query.range(offset, offset + limit - 1).execute()
        return res.data

    async def get_user_stats(self, user_id: int):
        user = await self.get_user(user_id)
        if not user:
            return {"total_orders": 0, "total_spent": 0, "points": 0}
        return {
            "total_orders": user.get("total_orders", 0),
            "total_spent": user.get("total_spent", 0),
            "points": user.get("loyalty_points", 0)
        }

    # ADMINS
    async def is_admin(self, user_id: int) -> bool:
        if user_id in config.SUPERADMIN_IDS:
            return True
        res = self.client.table("admins").select("*").eq("user_id", user_id).execute()
        return len(res.data) > 0

    async def get_admin_role(self, user_id: int) -> str:
        if user_id in config.SUPERADMIN_IDS:
            return "superadmin"
        res = self.client.table("admins").select("role").eq("user_id", user_id).execute()
        return res.data[0]["role"] if res.data else ""

    # MENU
    async def get_categories(self, active_only: bool = True):
        query = self.client.table("categories").select("*")
        if active_only:
            query = query.eq("is_active", True)
        res = query.order("sort_order").execute()
        return res.data

    async def get_menu_items(self, category_id=None, available_only: bool = True):
        query = self.client.table("menu_items").select("*")
        if category_id:
            query = query.eq("category_id", category_id)
        if available_only:
            query = query.eq("is_available", True)
        res = query.order("sort_order").execute()
        return res.data

    async def get_menu_item(self, item_id: str):
        res = self.client.table("menu_items").select("*").eq("id", item_id).execute()
        return res.data[0] if res.data else None

    async def create_menu_item(self, data: dict, created_by: int):
        data["created_by"] = created_by
        res = self.client.table("menu_items").insert(data).execute()
        return res.data[0] if res.data else None

    async def update_menu_item(self, item_id: str, data: dict):
        res = self.client.table("menu_items").update(data).eq("id", item_id).execute()
        return res.data[0] if res.data else None

    async def toggle_item_availability(self, item_id: str) -> bool:
        item = await self.get_menu_item(item_id)
        if item:
            new_val = not item["is_available"]
            self.client.table("menu_items").update({"is_available": new_val}).eq("id", item_id).execute()
            return new_val
        return False

    async def delete_menu_item(self, item_id: str):
        self.client.table("menu_items").delete().eq("id", item_id).execute()

    async def increment_item_ordered(self, item_ids: list):
        for i_id in item_ids:
            item = await self.get_menu_item(i_id)
            if item:
                self.client.table("menu_items").update({"total_ordered": item.get("total_ordered", 0) + 1}).eq("id", i_id).execute()

    # ORDERS
    async def create_order(self, user_id: int, payload: dict) -> dict:
        payload["user_id"] = user_id
        res = self.client.table("orders").insert(payload).execute()
        
        # update user stats
        user = await self.get_user(user_id)
        if user:
            new_orders = user.get("total_orders", 0) + 1
            new_spent = user.get("total_spent", 0) + payload.get("total", 0)
            self.client.table("users").update({"total_orders": new_orders, "total_spent": new_spent}).eq("id", user_id).execute()
            
        return res.data[0] if res.data else None

    async def get_order(self, order_id: str):
        res = self.client.table("orders").select("*").eq("id", order_id).execute()
        return res.data[0] if res.data else None

    async def get_user_orders(self, user_id: int, limit: int = 10):
        res = self.client.table("orders").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
        return res.data

    async def get_orders_by_status(self, status: str):
        res = self.client.table("orders").select("*").eq("status", status).order("created_at", desc=False).execute()
        return res.data

    async def update_order_status(self, order_id: str, status: str):
        res = self.client.table("orders").update({"status": status}).eq("id", order_id).execute()
        return res.data[0] if res.data else None

    async def get_all_orders(self, status=None, limit=10, offset=0):
        query = self.client.table("orders").select("*")
        if status:
            query = query.eq("status", status)
        res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return res.data

    # COUPONS
    async def validate_coupon(self, code: str, user_id: int, subtotal: int):
        res = self.client.table("coupons").select("*").eq("code", code).eq("is_active", True).execute()
        if not res.data:
            return {"valid": False, "discount": 0, "message": "not_found"}
        coupon = res.data[0]
        
        if coupon.get("min_order_amount", 0) > subtotal:
            return {"valid": False, "discount": 0, "message": "min_amount"}
            
        if coupon.get("used_count", 0) >= coupon.get("max_uses", 100):
            return {"valid": False, "discount": 0, "message": "max_uses"}
            
        usage = self.client.table("coupon_usage").select("*").eq("coupon_id", coupon["id"]).eq("user_id", user_id).execute()
        if usage.data:
            return {"valid": False, "discount": 0, "message": "already_used"}
            
        discount = coupon["discount_value"]
        if coupon["discount_type"] == "percent":
            discount = int(subtotal * (discount / 100.0))
            
        return {"valid": True, "discount": discount, "message": "ok", "coupon": coupon}

    async def mark_coupon_used(self, coupon_id: str, user_id: int, order_id: str):
        self.client.table("coupon_usage").insert({
            "coupon_id": coupon_id,
            "user_id": user_id,
            "order_id": order_id
        }).execute()
        
        coupon_res = self.client.table("coupons").select("used_count").eq("id", coupon_id).execute()
        if coupon_res.data:
            current_uses = coupon_res.data[0].get("used_count", 0)
            self.client.table("coupons").update({"used_count": current_uses + 1}).eq("id", coupon_id).execute()

    async def create_coupon(self, data: dict, created_by: int):
        data["created_by"] = created_by
        res = self.client.table("coupons").insert(data).execute()
        return res.data[0] if res.data else None

    async def get_all_coupons(self):
        res = self.client.table("coupons").select("*").order("created_at", desc=True).execute()
        return res.data

    async def toggle_coupon(self, coupon_id: str) -> bool:
        res = self.client.table("coupons").select("is_active").eq("id", coupon_id).execute()
        if res.data:
            new_val = not res.data[0]["is_active"]
            self.client.table("coupons").update({"is_active": new_val}).eq("id", coupon_id).execute()
            return new_val
        return False

    # LOYALTY
    async def get_points_balance(self, user_id: int) -> int:
        user = await self.get_user(user_id)
        return user.get("loyalty_points", 0) if user else 0

    async def add_points(self, user_id: int, points: int, order_id: str, reason: str):
        if points <= 0: return
        self.client.table("loyalty_transactions").insert({
            "user_id": user_id, "order_id": order_id, "points": points, "reason": reason
        }).execute()
        balance = await self.get_points_balance(user_id)
        self.client.table("users").update({"loyalty_points": balance + points}).eq("id", user_id).execute()

    async def deduct_points(self, user_id: int, points: int, order_id: str, reason: str):
        if points <= 0: return
        self.client.table("loyalty_transactions").insert({
            "user_id": user_id, "order_id": order_id, "points": -points, "reason": reason
        }).execute()
        balance = await self.get_points_balance(user_id)
        self.client.table("users").update({"loyalty_points": max(0, balance - points)}).eq("id", user_id).execute()

    async def get_loyalty_history(self, user_id: int):
        res = self.client.table("loyalty_transactions").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(5).execute()
        return res.data

db = Database()
