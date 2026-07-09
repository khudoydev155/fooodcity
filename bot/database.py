import asyncio
from supabase import create_client, Client
from bot.config import config
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class DatabaseManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DatabaseManager, cls).__new__(cls)
            cls._instance._init_db()
        return cls._instance

    def _init_db(self):
        if config.SUPABASE_URL and config.SUPABASE_SERVICE_KEY:
            self.client: Client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
        else:
            self.client = None
            logger.error("Supabase credentials missing!")

    async def _run_sync(self, func, *args, **kwargs):
        """Runs synchronous Supabase calls in a separate thread to prevent blocking."""
        def wrapper():
            import time
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if 'Name or service not known' in str(e) or 'Connection' in str(e) or 'connection' in str(e).lower():
                        if attempt < max_retries - 1:
                            time.sleep(1)
                            continue
                    raise e
            return None
        return await asyncio.to_thread(wrapper)

    # USERS
    async def get_or_create_user(self, tg_user):
        try:
            user_data = {
                "id": tg_user.id,
                "username": tg_user.username,
                "full_name": tg_user.full_name,
                "last_active": datetime.now().isoformat()
            }
            res = await self._run_sync(self.client.table("users").upsert(user_data, on_conflict="id").execute)
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"DB Error upsert_user: {e}")
            return None

    async def get_user(self, user_id: int):
        try:
            res = await self._run_sync(self.client.table("users").select("*").eq("id", user_id).execute)
            return res.data[0] if res.data else None
        except: return None

    async def update_user_location(self, user_id: int, lat: float, lon: float, address: str):
        try:
            data = {
                "last_lat": lat, "last_lon": lon,
                "cached_address": address, "last_active": datetime.now().isoformat()
            }
            await self._run_sync(self.client.table("users").update(data).eq("id", user_id).execute)
        except Exception as e:
            logger.error(f"Error caching location: {e}")

    # MENU
    async def get_public_menu(self):
        try:
            res = await self._run_sync(
                self.client.table("menu_items")
                .select("*, categories(*)")
                .eq("is_available", True)
                .order("sort_order")
                .execute
            )
            # Filter out items where the parent category is soft-deleted or inactive
            filtered = []
            for item in (res.data if res.data else []):
                cat = item.get("categories")
                if cat and not cat.get("is_deleted") and cat.get("is_active"):
                    filtered.append(item)
            return filtered
        except Exception as e:
            logger.error(f"Error get_public_menu: {e}")
            return []

    async def get_menu_item(self, item_id: str):
        try:
            res = await self._run_sync(
                self.client.table("menu_items")
                .select("*")
                .eq("id", item_id)
                .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error get_menu_item: {e}")
            return None

    # ORDERS
    async def create_order(self, user_id: int, payload: dict) -> dict:
        """
        Creates an order using the Atomic RPC Transaction 'create_order_atomic'.
        Ensures all DB updates (orders, users, coupons, stats) happen in one step.
        """
        try:
            # 1. Price Validation & Item Preparation
            validated_items = []
            calculated_subtotal = 0
            
            for item in payload.get("items", []):
                db_item = await self.get_menu_item(item["id"])
                if not db_item: continue
                
                actual_price = int(float(db_item["price"]))
                qty = int(float(item["qty"]))
                validated_items.append({
                    "id": item["id"],
                    "qty": qty,
                    "price": actual_price,
                    "name_uz": db_item.get("name_uz"),
                    "name_ru": db_item.get("name_ru"),
                    "name_en": db_item.get("name_en"),
                    "emoji": db_item.get("emoji")
                })
                calculated_subtotal += actual_price * qty

            # 2. Generate Sequential Daily Order ID
            from datetime import date
            today_str = date.today().strftime('%y%m%d') # e.g. "250516"
            
            # Count today's orders using .like() for sequential numbering
            # We count orders starting with today's date prefix
            count_res = await self._run_sync(
                self.client.table('orders')
                    .select('id', count='exact')
                    .like('id', f'{today_str}-%')
                    .execute
            )
            next_num = (count_res.count or 0) + 1
            order_id = f"{today_str}-{next_num:03d}" # e.g. "250516-001"

            
            # 3. Calculate Points & Totals
            delivery_fee = int(float(payload.get("delivery_fee", 0) or 0))
            discount = int(float(payload.get("discount", 0) or 0))
            points_used = int(float(payload.get("loyalty_points_used", 0) or 0))
            calculated_subtotal = int(float(calculated_subtotal))
            final_total = calculated_subtotal + delivery_fee - discount - points_used
            
            points_earned = calculated_subtotal // 1000 # 1 point per 1000 sum
            
            # 4. Atomic Transaction via RPC
            rpc_params = {
                "p_order_id": str(order_id),
                "p_user_id": int(user_id),
                "p_items": validated_items,
                "p_subtotal": calculated_subtotal,
                "p_delivery_fee": delivery_fee,
                "p_discount": discount,
                "p_total": int(float(final_total)),
                "p_delivery_address": str(payload.get("delivery_address", "") or ""),
                "p_location": payload.get("location", {}),
                "p_note": str(payload.get("note", "") or ""),
                "p_coupon_code": str(payload.get("coupon_code", "") or ""),
                "p_points_used": points_used,
                "p_points_earned": points_earned,
                "p_language": str(payload.get("language", "uz") or "uz")
            }
            
            res = await self._run_sync(self.client.rpc("create_order_atomic", rpc_params).execute)
            
            if res.data and res.data.get("success"):
                # Return the order details for the frontend/bot notifications
                return {
                    "id": order_id,
                    "total": final_total,
                    "points_earned": points_earned,
                    **res.data
                }
            return None
            
        except Exception as e:
            logger.error(f"Atomic Transaction Error: {e}")
            return None

    async def get_admin_stats(self, start_date=None, end_date=None):
        try:
            now = datetime.now()
            # Parse start_date and end_date
            try:
                start_dt = datetime.fromisoformat(start_date) if start_date else now.replace(hour=0, minute=0, second=0, microsecond=0)
            except: start_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
            try:
                end_dt = datetime.fromisoformat(end_date) if end_date else now
            except: end_dt = now

            # Compute prior period start and end for percentage diffs
            diff = end_dt - start_dt
            prior_start_dt = start_dt - diff
            prior_end_dt = start_dt

            # Current Period Stats
            orders_q = self.client.table("orders").select("total").gte("created_at", start_dt.isoformat()).lte("created_at", end_dt.isoformat())
            users_q = self.client.table("users").select("id", count="exact")

            orders = await self._run_sync(orders_q.execute)
            users = await self._run_sync(users_q.execute)

            curr_count = len(orders.data) if orders.data else 0
            curr_rev = sum(o["total"] for o in orders.data) if orders.data else 0

            # Prior Period Stats
            prior_orders_q = self.client.table("orders").select("total").gte("created_at", prior_start_dt.isoformat()).lt("created_at", prior_end_dt.isoformat())
            prior_orders = await self._run_sync(prior_orders_q.execute)

            prior_count = len(prior_orders.data) if prior_orders.data else 0
            prior_rev = sum(o["total"] for o in prior_orders.data) if prior_orders.data else 0

            # Compute Percentages
            def calc_diff(curr, prior):
                if prior == 0: return 100 if curr > 0 else 0
                return round(((curr - prior) / prior) * 100)

            return {
                "today_count": curr_count,
                "today_count_diff": calc_diff(curr_count, prior_count),
                "today_revenue": curr_rev,
                "today_revenue_diff": calc_diff(curr_rev, prior_rev),
                "total_users": users.count if users.count is not None else 0,
                "top_items": []
            }
        except Exception as e:
            logger.error(f"Error get_admin_stats: {e}")
            return {"today_count": 0, "today_count_diff": 0, "today_revenue": 0, "today_revenue_diff": 0, "total_users": 0, "top_items": []}

    async def get_admin_role(self, user_id: int):
        if user_id in config.SUPERADMIN_IDS: return "superadmin"
        try:
            res = await self._run_sync(self.client.table("admins").select("role").eq("user_id", user_id).execute)
            return res.data[0]["role"] if res.data else None
        except: return None

    async def get_user_orders(self, user_id: int, limit: int = 10) -> list:
        try:
            res = await self._run_sync(
                self.client.table("orders")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute
            )
            return res.data if res.data else []
        except: return []

    # ADMIN: ORDERS
    async def get_admin_orders(self, status=None, search=None, limit=20, offset=0, start_date=None, end_date=None):
        try:
            query = self.client.table("orders").select("*, users(full_name, username)").order("created_at", desc=True)
            if status:
                if isinstance(status, list):
                    query = query.in_("status", status)
                else:
                    query = query.eq("status", status)
            if search: query = query.ilike("id", f"%{search}%")
            if start_date: query = query.gte("created_at", start_date)
            if end_date: query = query.lte("created_at", end_date)
            res = await self._run_sync(query.range(offset, offset + limit - 1).execute)
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"Error get_admin_orders: {e}")
            return []

    async def get_admin_analytics(self, start_date=None, end_date=None):
        """Returns aggregated analytics for Chart.js.
        Generates revenue over time (hourly if range < 1 day, else daily) and top 5 sold items.
        """
        try:
            now = datetime.now()
            # Default to today
            if start_date:
                start_dt = datetime.fromisoformat(start_date)
            else:
                start_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
            if end_date:
                end_dt = datetime.fromisoformat(end_date)
            else:
                end_dt = now

            # Ensure proper ordering
            if end_dt < start_dt:
                start_dt, end_dt = end_dt, start_dt

            # Fetch orders in range
            orders_res = await self._run_sync(
                self.client.table("orders")
                .select("created_at,total,items")
                .gte("created_at", start_dt.isoformat())
                .lte("created_at", end_dt.isoformat())
                .execute
            )
            orders = orders_res.data if orders_res.data else []

            # Determine grouping granularity
            diff_seconds = (end_dt - start_dt).total_seconds()
            hourly = diff_seconds <= 24 * 60 * 60  # <= 1 day

            # Build revenue buckets
            revenue_by_bucket = {}
            if hourly:
                # Initialize each hour bucket for the date range
                current = start_dt.replace(minute=0, second=0, microsecond=0)
                while current <= end_dt:
                    label = current.strftime('%H:%M')
                    revenue_by_bucket[label] = 0
                    current += timedelta(hours=1)
                for o in orders:
                    dt = datetime.fromisoformat(o["created_at"])
                    bucket_label = dt.strftime('%H:%M')
                    revenue_by_bucket[bucket_label] = revenue_by_bucket.get(bucket_label, 0) + o.get("total", 0)
                # Preserve chronological order
                sorted_labels = sorted(revenue_by_bucket.keys())
                chart_revenue = {
                    "labels": sorted_labels,
                    "data": [revenue_by_bucket[l] for l in sorted_labels]
                }
            else:
                # Daily buckets
                for o in orders:
                    d = o["created_at"][:10]  # YYYY-MM-DD
                    revenue_by_bucket[d] = revenue_by_bucket.get(d, 0) + o.get("total", 0)
                sorted_dates = sorted(revenue_by_bucket.keys())
                chart_revenue = {
                    "labels": sorted_dates,
                    "data": [revenue_by_bucket[d] for d in sorted_dates]
                }

            # Top items aggregation
            item_counts = {}
            for o in orders:
                for item in o.get("items", []):
                    name = item.get("name_uz") or item.get("name_ru") or item.get("name_en") or item.get("id")
                    qty = int(item.get("qty", 1))
                    item_counts[name] = item_counts.get(name, 0) + qty
            top_items = sorted(item_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
            chart_top_items = {
                "labels": [i[0] for i in top_items],
                "data": [i[1] for i in top_items]
            }

            # Returning customers percent (optional, keep as before)
            users_all_res = await self._run_sync(self.client.table("users").select("id", count="exact").execute)
            total_users = users_all_res.count if users_all_res.count else 0
            users_returning_res = await self._run_sync(self.client.table("users").select("id", count="exact").gt("total_orders", 1).execute)
            returning_users = users_returning_res.count if users_returning_res.count else 0
            returning_percent = round((returning_users / total_users) * 100) if total_users > 0 else 0

            return {
                "revenue_chart": chart_revenue,
                "top_items_chart": chart_top_items,
                "returning_percent": returning_percent
            }
        except Exception as e:
            logger.error(f"Analytics Error: {e}")
            return {
                "revenue_chart": {"labels": [], "data": []},
                "top_items_chart": {"labels": [], "data": []},
                "returning_percent": 0
            }


    async def update_order_status(self, order_id: str, status: str):
        try:
            await self._run_sync(self.client.table("orders").update({"status": status}).eq("id", order_id).execute)
            return True
        except: return False

    # ADMIN: MENU
    async def get_all_menu(self):
        try:
            res = await self._run_sync(
                self.client.table("menu_items")
                .select("*")
                .order("sort_order")
                .execute
            )
            return res.data if res.data else []
        except: return []

    async def get_menu_items(self, available_only: bool = False):
        try:
            query = self.client.table("menu_items").select("*")
            if available_only:
                query = query.eq("is_available", True)
            res = await self._run_sync(query.order("sort_order").execute)
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"Error get_menu_items: {e}")
            return []

    async def add_menu_item(self, data: dict):
        try:
            if not data.get("product_code"):
                category = await self.get_category(data.get("category_id"))
                cat_code = category.get("category_code", "GEN") if category else "GEN"
                product_code = await self.generate_product_code(cat_code)
                data["product_code"] = product_code
            res = await self._run_sync(self.client.table("menu_items").insert(data).execute)
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error add_menu_item: {e}")
            return None

    async def create_menu_item(self, data: dict, created_by: int = 0):
        try:
            import uuid
            item_id = data.get("id") or str(uuid.uuid4())
            
            product_code = data.get("product_code")
            if not product_code:
                category = await self.get_category(data.get("category_id"))
                cat_code = category.get("category_code", "GEN") if category else "GEN"
                product_code = await self.generate_product_code(cat_code)

            new_item = {
                "id": item_id,
                "category_id": data.get("category_id"),
                "name_uz": data.get("name_uz"),
                "name_ru": data.get("name_ru", data.get("name_uz")),
                "name_en": data.get("name_en", data.get("name_uz")),
                "description_uz": data.get("description_uz") or data.get("description", ""),
                "description_ru": data.get("description_ru") or data.get("description", ""),
                "description_en": data.get("description_en") or data.get("description", ""),
                "price": int(data.get("price", 0)),
                "image_url": data.get("image_url"),
                "image_thumb_url": data.get("image_thumb_url") or data.get("image_url"),
                "emoji": data.get("emoji", "🍽"),
                "badge": data.get("badge", ""),
                "is_available": data.get("is_available", True),
                "sort_order": int(data.get("sort_order", 99)),
                "product_code": product_code,
                "created_by": created_by
            }
            res = await self._run_sync(self.client.table("menu_items").insert(new_item).execute)
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error create_menu_item: {e}")
            return None

    async def update_menu_item(self, item_id: str, data: dict):
        try:
            # Prevent modifying immutable columns
            safe_data = {k: v for k, v in data.items() if k not in ("product_code", "id", "created_at")}
            res = await self._run_sync(self.client.table("menu_items").update(safe_data).eq("id", item_id).execute)
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error update_menu_item: {e}")
            return None

    async def delete_menu_item(self, item_id: str):
        try:
            # Perform soft delete by setting is_deleted=True
            await self._run_sync(
                self.client.table("menu_items")
                .update({
                    "is_deleted": True,
                    "deleted_at": datetime.utcnow().isoformat(),
                    "is_available": False
                })
                .eq("id", item_id)
                .execute
            )
            return True
        except Exception as e:
            logger.error(f"Error delete_menu_item: {e}")
            return False

    # ADMIN: USERS
    async def get_all_users(self, search=None):
        try:
            query = self.client.table("users").select("*").order("created_at", desc=True)
            if search: query = query.ilike("full_name", f"%{search}%")
            res = await self._run_sync(query.limit(50).execute)
            return res.data if res.data else []
        except: return []

    async def update_user_block(self, user_id: int, is_blocked: bool):
        try:
            await self._run_sync(self.client.table("users").update({"is_blocked": is_blocked}).eq("id", user_id).execute)
            return True
        except: return False

    # ADMIN: COUPONS
    async def get_all_coupons(self):
        try:
            res = await self._run_sync(self.client.table("coupons").select("*").order("created_at", desc=True).execute)
            return res.data if res.data else []
        except: return []

    async def create_coupon(self, data: dict):
        try:
            res = await self._run_sync(self.client.table("coupons").insert(data).execute)
            return res.data[0] if res.data else None
        except: return None

    async def delete_coupon(self, coupon_id: str):
        try:
            await self._run_sync(self.client.table("coupons").delete().eq("id", coupon_id).execute)
            return True
        except: return False

    # CATEGORY FOUNDATION API
    async def get_categories(self, active_only: bool = False):
        try:
            query = self.client.table("categories").select("*")
            if active_only:
                query = query.eq("is_active", True)
            res = await self._run_sync(query.order("sort_order").execute)
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"Error get_categories: {e}")
            return []

    async def get_category(self, category_id: str):
        try:
            res = await self._run_sync(
                self.client.table("categories")
                .select("*")
                .eq("id", category_id)
                .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error get_category: {e}")
            return None

    # CODE SYSTEM
    async def generate_product_code(self, category_code: str) -> str:
        try:
            res = await self._run_sync(
                self.client.rpc("generate_product_code", {"p_category_code": category_code.upper()}).execute
            )
            return res.data if res.data else None
        except Exception as e:
            logger.error(f"Error generate_product_code: {e}")
            return None

    # RELATIONAL IMAGE ARCHITECTURE HELPERS
    async def get_menu_item_by_short_id(self, short_id: str) -> dict | None:
        try:
            res = await self._run_sync(
                self.client.table("menu_items")
                .select("*")
                .like("id", f"{short_id}%")
                .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error get_menu_item_by_short_id: {e}")
            return None

    async def get_menu_item_by_product_code(self, product_code: str) -> dict | None:
        try:
            res = await self._run_sync(
                self.client.table("menu_items")
                .select("*")
                .eq("product_code", product_code)
                .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error get_menu_item_by_product_code: {e}")
            return None

    async def insert_image_record(self, record: dict) -> dict | None:
        try:
            res = await self._run_sync(
                self.client.table("menu_item_images")
                .insert(record)
                .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error insert_image_record: {e}")
            return None

    async def archive_active_images(self, menu_item_id: str) -> list[dict]:
        try:
            res = await self._run_sync(
                self.client.table("menu_item_images")
                .update({
                    "is_active": False,
                    "is_archived": True,
                    "archived_at": datetime.utcnow().isoformat()
                })
                .eq("menu_item_id", menu_item_id)
                .eq("is_active", True)
                .eq("is_deleted", False)
                .execute
            )
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"Error archive_active_images: {e}")
            return []

    async def update_menu_item_image_urls(self, item_id: str, image_url: str, thumb_url: str) -> bool:
        try:
            await self._run_sync(
                self.client.table("menu_items")
                .update({
                    "image_url": image_url,
                    "image_thumb_url": thumb_url,
                    "image_updated_at": datetime.utcnow().isoformat()
                })
                .eq("id", item_id)
                .execute
            )
            return True
        except Exception as e:
            logger.error(f"Error update_menu_item_image_urls: {e}")
            return False

    async def get_archived_images_older_than(self, days: int) -> list[dict]:
        try:
            from datetime import timedelta
            cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
            res = await self._run_sync(
                self.client.table("menu_item_images")
                .select("*")
                .eq("is_archived", True)
                .eq("is_deleted", False)
                .lt("archived_at", cutoff)
                .execute
            )
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"Error get_archived_images_older_than: {e}")
            return []

    async def delete_image_records(self, image_ids: list[str]) -> bool:
        try:
            await self._run_sync(
                self.client.table("menu_item_images")
                .update({
                    "is_deleted": True,
                    "deleted_at": datetime.utcnow().isoformat()
                })
                .in_("id", image_ids)
                .execute
            )
            return True
        except Exception as e:
            logger.error(f"Error delete_image_records: {e}")
            return False

    # BACKWARD COMPATIBILITY ALIASES
    async def get_all_orders(self, status: str = None):
        return await self.get_admin_orders(status=status)

    async def block_user(self, user_id: int):
        return await self.update_user_block(user_id, True)

    async def unblock_user(self, user_id: int):
        return await self.update_user_block(user_id, False)

db = DatabaseManager()
