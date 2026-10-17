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

    async def _fetch_all(self, query_factory, page_size=1000):
        """Fetch every matching row in bounded pages, avoiding PostgREST's row cap."""
        rows = []
        offset = 0
        while True:
            result = await self._run_sync(
                query_factory().range(offset, offset + page_size - 1).execute
            )
            batch = result.data or []
            rows.extend(batch)
            if len(batch) < page_size:
                return rows
            offset += page_size

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
        except Exception as e:
            logger.error(f"get_user({user_id}) failed: {e}")
            return None

    async def verify_user_phone(self, user_id: int, phone: str) -> bool:
        try:
            now = datetime.now().astimezone().isoformat()
            res = await self._run_sync(
                self.client.table("users")
                .update({"phone": phone, "phone_verified_at": now})
                .eq("id", user_id)
                .execute
            )
            return bool(res.data)
        except Exception as e:
            logger.error("Phone verification save failed for user %s: %s", user_id, e)
            return False

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

            # 3. Calculate Points & Totals
            delivery_fee = int(float(payload.get("delivery_fee", 0) or 0))
            discount = int(float(payload.get("discount", 0) or 0))
            points_used = int(float(payload.get("loyalty_points_used", 0) or 0))
            calculated_subtotal = int(float(calculated_subtotal))
            final_total = calculated_subtotal + delivery_fee - discount - points_used

            points_earned = calculated_subtotal // 1000 # 1 point per 1000 sum

            # To'lov usuli — cash, click, payme (P2P card_transfer olib tashlandi)
            payment_method = str(payload.get("payment_method") or "cash").lower().strip()
            if payment_method not in ("cash", "click", "payme"):
                payment_method = "cash"

            # 4. Atomic Transaction via RPC
            # MUHIM: bu yerda ilgari ID faqat BITTA marta — COUNT so'rovi
            # asosida — hisoblanib, keyin RPC'ga uzatilardi. Agar ikki
            # mijoz DEYARLI bir vaqtda buyurtma bersa (tushlik payti juda
            # oddiy holat), ikkalasi ham COUNT'ni bir xil qiymatda o'qib,
            # BIR XIL order_id (masalan "250516-001") hisoblab olishi
            # mumkin edi — natijada PRIMARY KEY to'qnashuvi tufayli
            # ikkinchi mijozning buyurtmasi butunlay yo'qolar edi. Endi
            # to'qnashuv aniqlansa, ID qayta hisoblab, qayta urinib
            # ko'riladi (bosqichma-bosqich, bir necha marta).
            #
            # MUHIM (2): create_order_atomic RPC funksiyasi ICHKARIDA
            # "EXCEPTION WHEN OTHERS" bilan xatoni tutib, Python'ga
            # exception sifatida EMAS, oddiy {"success": false, "error":
            # ...} JSON javob sifatida qaytaradi. Ya'ni PRIMARY KEY
            # to'qnashuvi bo'lganda ham .execute() hech qanday exception
            # tashlamaydi — u faqat res.data["success"] = False qaytaradi.
            # Bu yerda ilgari faqat "except Exception" orqali to'qnashuvni
            # tutishga urinilgan edi, ammo bu yo'l HECH QACHON ishlamas
            # edi (chunki exception umuman tashlanmaydi) — retry mantig'i
            # amalda ishlamay, birinchi to'qnashuvdayoq buyurtma yo'qolib
            # qolardi. Endi ikkala holat ham (haqiqiy exception VA
            # success=false javob) tekshiriladi.
            max_attempts = 5
            last_error = None
            for attempt in range(max_attempts):
                count_res = await self._run_sync(
                    self.client.table('orders')
                        .select('id', count='exact')
                        .like('id', f'{today_str}-%')
                        .execute
                )
                next_num = (count_res.count or 0) + 1
                order_id = f"{today_str}-{next_num:03d}" # e.g. "250516-001"

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
                    "p_language": str(payload.get("language", "uz") or "uz"),
                    "p_payment_method": payment_method,
                }

                try:
                    res = await self._run_sync(self.client.rpc("create_order_atomic", rpc_params).execute)
                except Exception as e:
                    err_str = str(e).lower()
                    is_id_collision = "duplicate" in err_str or "23505" in err_str or "already exists" in err_str
                    if is_id_collision and attempt < max_attempts - 1:
                        last_error = str(e)
                        logger.warning(f"create_order: order_id {order_id} to'qnashdi (exception), qayta urinilmoqda ({attempt + 1}/{max_attempts})")
                        continue
                    raise

                if res.data and res.data.get("success"):
                    # Return the order details for the frontend/bot notifications
                    return {
                        "id": order_id,
                        "total": final_total,
                        "points_earned": points_earned,
                        "payment_method": payment_method,
                        **res.data
                    }

                # success=false — RPC ichida ushlangan xato. Agar bu ID
                # to'qnashuvi bo'lsa, qayta uriniladi; aks holda (masalan
                # "ball yetarli emas") qayta urinish foyda bermaydi.
                err_msg = (res.data or {}).get("error", "") if res.data else "noma'lum xato"
                is_id_collision = any(s in err_msg.lower() for s in ("duplicate", "unique constraint", "orders_pkey"))
                if is_id_collision and attempt < max_attempts - 1:
                    last_error = err_msg
                    logger.warning(f"create_order: order_id {order_id} to'qnashdi (RPC javobi), qayta urinilmoqda ({attempt + 1}/{max_attempts})")
                    continue

                if err_msg:
                    logger.warning(f"create_order: RPC muvaffaqiyatsiz yakunlandi: {err_msg}")
                return None

            logger.error(f"create_order: {max_attempts} urinishdan keyin ham ID to'qnashuvi hal bo'lmadi: {last_error}")
            return None

        except Exception as e:
            logger.error(f"Atomic Transaction Error: {e}")
            return None

    async def get_admin_stats(self, start_date=None, end_date=None):
        try:
            now = datetime.now().astimezone()
            # Parse start_date and end_date
            try:
                start_dt = datetime.fromisoformat(start_date) if start_date else now.replace(hour=0, minute=0, second=0, microsecond=0)
            except Exception:
                logger.debug(f"get_admin_stats: invalid start_date={start_date!r}, using today")
                start_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
            try:
                end_dt = datetime.fromisoformat(end_date) if end_date else now
            except Exception:
                logger.debug(f"get_admin_stats: invalid end_date={end_date!r}, using now")
                end_dt = now

            # Compute prior period start and end for percentage diffs
            diff = end_dt - start_dt
            prior_start_dt = start_dt - diff
            prior_end_dt = start_dt

            # Current period values are paged so totals remain exact above the
            # default PostgREST response limit.
            orders = await self._fetch_all(
                lambda: self.client.table("orders").select(
                    "total,status,payment_status,user_id"
                )
                    .gte("created_at", start_dt.isoformat())
                    .lte("created_at", end_dt.isoformat())
            )
            users = await self._run_sync(
                self.client.table("users").select("id", count="exact").limit(1).execute
            )
            curr_count = len(orders)
            status_counts = {}
            for order in orders:
                status = order.get("status") or "unknown"
                status_counts[status] = status_counts.get(status, 0) + 1
            valid_orders = [o for o in orders if o.get("status") != "cancelled"]
            paid_orders = [o for o in valid_orders if o.get("payment_status") == "paid"]
            pending_orders = [o for o in valid_orders if o.get("payment_status") != "paid"]
            curr_rev = sum(o.get("total") or 0 for o in paid_orders)
            pending_amount = sum(o.get("total") or 0 for o in pending_orders)
            paid_order_count = len(paid_orders)
            unique_customers = len({o.get("user_id") for o in valid_orders if o.get("user_id") is not None})

            # Prior Period Stats
            prior_orders = await self._fetch_all(
                lambda: self.client.table("orders").select("total,status,payment_status")
                    .gte("created_at", prior_start_dt.isoformat())
                    .lt("created_at", prior_end_dt.isoformat())
            )

            prior_count = len(prior_orders)
            prior_rev = sum(
                o.get("total") or 0 for o in prior_orders
                if o.get("status") != "cancelled" and o.get("payment_status") == "paid"
            )

            # Compute Percentages
            def calc_diff(curr, prior):
                if prior == 0: return 100 if curr > 0 else 0
                return round(((curr - prior) / prior) * 100)

            today = {
                "orders": curr_count,
                "orders_diff": calc_diff(curr_count, prior_count),
                "revenue": curr_rev,
                "revenue_diff": calc_diff(curr_rev, prior_rev),
                "average_order_value": round(curr_rev / paid_order_count) if paid_order_count else 0,
                "active_orders": sum(status_counts.get(status, 0) for status in ("new", "confirmed", "cooking", "delivering")),
                "delivered_orders": status_counts.get("delivered", 0),
                "cancelled_orders": status_counts.get("cancelled", 0),
                "paid_orders": paid_order_count,
                "pending_payment_orders": len(pending_orders),
                "pending_payment_amount": pending_amount,
                "unique_customers": unique_customers,
                "cancellation_rate": round(status_counts.get("cancelled", 0) / curr_count * 100) if curr_count else 0,
                "delivery_rate": round(status_counts.get("delivered", 0) / curr_count * 100) if curr_count else 0,
            }
            return {
                "today": today,
                "total_users": users.count if users.count is not None else 0,
                # Keep the original fields for any older admin clients.
                "today_count": curr_count,
                "today_count_diff": calc_diff(curr_count, prior_count),
                "today_revenue": curr_rev,
                "today_revenue_diff": calc_diff(curr_rev, prior_rev),
                "top_items": []
            }
        except Exception as e:
            logger.exception("Error get_admin_stats: %s", e)
            raise

    async def get_admin_role(self, user_id: int):
        if user_id in config.SUPERADMIN_IDS: return "superadmin"
        try:
            res = await self._run_sync(self.client.table("admins").select("role").eq("user_id", user_id).execute)
            return res.data[0]["role"] if res.data else None
        except Exception as e:
            logger.error(f"get_admin_role({user_id}) failed: {e}")
            return None

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
        except Exception as e:
            logger.error(f"get_user_orders({user_id}) failed: {e}")
            return []

    # ADMIN: ORDERS
    async def get_admin_orders(self, status=None, search=None, limit=20, offset=0, start_date=None, end_date=None):
        def build_base():
            q = self.client.table("orders").select(
                "*, users!orders_user_id_fkey(full_name, username, phone)"
            ).order("created_at", desc=True)
            if status:
                if isinstance(status, list):
                    q = q.in_("status", status)
                else:
                    q = q.eq("status", status)
            if start_date: q = q.gte("created_at", start_date)
            if end_date: q = q.lte("created_at", end_date)
            return q

        try:
            limit = max(1, min(int(limit), 1000))
            offset = max(0, int(offset))

            async def enrich_orders(orders):
                courier_ids = {
                    order.get("courier_id")
                    for order in orders
                    if order.get("courier_id") is not None
                }
                if not courier_ids:
                    return orders
                courier_res = await self._run_sync(
                    self.client.table("users")
                        .select("id,full_name,username")
                        .in_("id", list(courier_ids))
                        .execute
                )
                couriers = {user["id"]: user for user in (courier_res.data or [])}
                for order in orders:
                    order["courier"] = couriers.get(order.get("courier_id"))
                return orders

            if search:
                # MUHIM: ilgari qidiruv faqat buyurtma ID'si bo'yicha ishlar edi,
                # lekin admin panelda "ID yoki ism bo'yicha qidirish" deb yozilgan —
                # ismi/username bo'yicha qidirish aslida hech qachon ishlamas edi.
                # PostgREST orqali join qilingan (users) jadval ustuniga bevosita
                # OR-filter qo'yib bo'lmagani uchun ikkita so'rov qilib, natijani
                # birlashtiramiz: (1) ID mos kelganlar, (2) mijoz ismi/username
                # mos kelgan foydalanuvchilarning buyurtmalari.
                safe_search = search.replace(",", " ").replace("%", "")

                id_res = await self._run_sync(
                    build_base().ilike("id", f"%{safe_search}%").range(offset, offset + limit - 1).execute
                )
                orders_by_id = id_res.data or []

                user_res = await self._run_sync(
                    self.client.table("users").select("id")
                        .or_(
                            f"full_name.ilike.%{safe_search}%,"
                            f"username.ilike.%{safe_search}%,"
                            f"phone.ilike.%{safe_search}%"
                        )
                        .execute
                )
                matched_user_ids = [u["id"] for u in (user_res.data or [])]

                orders_by_user = []
                if matched_user_ids:
                    user_orders_res = await self._run_sync(
                        build_base().in_("user_id", matched_user_ids).range(offset, offset + limit - 1).execute
                    )
                    orders_by_user = user_orders_res.data or []

                seen = set()
                merged = []
                for o in orders_by_id + orders_by_user:
                    if o["id"] not in seen:
                        seen.add(o["id"])
                        merged.append(o)
                merged.sort(key=lambda o: o.get("created_at") or "", reverse=True)
                return await enrich_orders(merged[:limit])

            res = await self._run_sync(build_base().range(offset, offset + limit - 1).execute)
            return await enrich_orders(res.data or [])
        except Exception as e:
            logger.exception("Error get_admin_orders: %s", e)
            raise

    async def get_admin_analytics(self, start_date=None, end_date=None):
        """Returns aggregated analytics for Chart.js.
        Generates revenue over time (hourly if range < 1 day, else daily) and top 5 sold items.
        """
        try:
            now = datetime.now().astimezone()
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
            orders = await self._fetch_all(
                lambda: self.client.table("orders")
                    .select("created_at,total,items,status,payment_status")
                    .gte("created_at", start_dt.isoformat())
                    .lte("created_at", end_dt.isoformat())
            )

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
                    if o.get("status") == "cancelled" or o.get("payment_status") != "paid":
                        continue
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
                    if o.get("status") == "cancelled" or o.get("payment_status") != "paid":
                        continue
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
                if o.get("status") == "cancelled":
                    continue
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
            logger.exception("Analytics Error: %s", e)
            raise


    async def update_order_status(self, order_id: str, status: str):
        try:
            await self._run_sync(self.client.table("orders").update({"status": status}).eq("id", order_id).execute)
            return True
        except Exception as e:
            logger.error(f"update_order_status({order_id}, {status}) failed: {e}")
            return False

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
        except Exception as e:
            logger.error(f"get_all_menu() failed: {e}")
            return []

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

    def _build_menu_item_row(self, data: dict, created_by: int = 0, item_id: str | None = None) -> dict:
        """Menu item uchun bitta, markazlashtirilgan normalizatsiya qoidasi.

        MUHIM: ilgari bu mantiq (RU/EN nomi berilmasa UZ nomiga tushishi,
        price/sort_order default qiymatlari va h.k.) HAM shu yerda
        (avvalgi create_menu_item ichida), HAM bot/api/router.py'da
        (add_menu_item_api ichida) mustaqil, ikki xil ko'rinishda yozilgan
        edi. Ikkita joy vaqt o'tishi bilan sinxronlashmasdan qolib ketishi
        (masalan biri yangilanib, ikkinchisi eskirib qolishi) — real
        xavf edi. Endi qoida yagona manbada, shu yerda.
        """
        import uuid
        name_uz = data.get("name_uz") or data.get("name", "")
        return {
            "id": item_id or data.get("id") or str(uuid.uuid4()),
            "category_id": data.get("category_id"),
            "name_uz": name_uz,
            "name_ru": data.get("name_ru") or name_uz,
            "name_en": data.get("name_en") or name_uz,
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
            "created_by": created_by,
        }

    async def add_menu_item(self, data: dict, created_by: int = 0):
        try:
            row = self._build_menu_item_row(data, created_by=created_by)
            if not row.get("product_code"):
                category = await self.get_category(row.get("category_id"))
                cat_code = category.get("category_code", "GEN") if category else "GEN"
                row["product_code"] = await self.generate_product_code(cat_code)
            res = await self._run_sync(self.client.table("menu_items").insert(row).execute)
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Error add_menu_item: {e}")
            return None

    async def create_menu_item(self, data: dict, created_by: int = 0):
        # Telegram wizard (bot/handlers/menu_wizard.py) shu nom bilan chaqiradi —
        # ortiqcha ikkilanish bo'lmasligi uchun bevosita add_menu_item'ga yo'naltiradi.
        return await self.add_menu_item(data, created_by=created_by)

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

    # PAYMENTS (naqd / karta-kartaga o'tkazma)
    async def get_payment_settings(self) -> dict:
        """Do'konning karta-kartaga o'tkazma uchun rekvizitlarini qaytaradi."""
        try:
            res = await self._run_sync(
                self.client.table("system_settings")
                    .select("payment_card_number, payment_card_holder")
                    .eq("id", "foodcity_bot")
                    .single()
                    .execute
            )
            return res.data or {}
        except Exception as e:
            logger.error(f"get_payment_settings() failed: {e}")
            return {}

    async def update_payment_settings(self, card_number: str, card_holder: str) -> bool:
        try:
            await self._run_sync(
                self.client.table("system_settings")
                    .update({"payment_card_number": card_number, "payment_card_holder": card_holder})
                    .eq("id", "foodcity_bot")
                    .execute
            )
            return True
        except Exception as e:
            logger.error(f"update_payment_settings() failed: {e}")
            return False

    async def get_click_and_payme_settings(self) -> dict:
        """Kafolatli: avval system_settings dan, bo'sh bo'lsa config (.env) dan oladi."""
        db_settings = {}
        try:
            res = await self._run_sync(
                self.client.table("system_settings")
                    .select("click_service_id, click_merchant_id, click_secret_key, click_merchant_user_id, payme_merchant_id, payme_secret_key, payme_test_mode")
                    .eq("id", "foodcity_bot")
                    .single()
                    .execute
            )
            if res.data:
                db_settings = res.data
        except Exception as e:
            logger.warning(f"get_click_and_payme_settings from DB failed: {e}")

        return {
            "click_service_id": str(db_settings.get("click_service_id") or config.CLICK_SERVICE_ID or "").strip(),
            "click_merchant_id": str(db_settings.get("click_merchant_id") or config.CLICK_MERCHANT_ID or "").strip(),
            "click_secret_key": str(db_settings.get("click_secret_key") or config.CLICK_SECRET_KEY or "").strip(),
            "click_merchant_user_id": str(db_settings.get("click_merchant_user_id") or config.CLICK_MERCHANT_USER_ID or "").strip(),
            "payme_merchant_id": str(db_settings.get("payme_merchant_id") or config.PAYME_MERCHANT_ID or "").strip(),
            "payme_secret_key": str(db_settings.get("payme_secret_key") or config.PAYME_SECRET_KEY or "").strip(),
            "payme_test_mode": bool(db_settings.get("payme_test_mode") if db_settings.get("payme_test_mode") is not None else config.PAYME_TEST_MODE),
        }

    async def get_order_by_id(self, order_id: str) -> dict | None:
        """Buyurtmani to'liq ma'lumotlari bilan qaytaradi."""
        try:
            res = await self._run_sync(
                self.client.table("orders").select("*").eq("id", order_id).limit(1).execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"get_order_by_id({order_id}) failed: {e}")
            return None

    async def get_payment_transaction(self, provider: str, transaction_id: str) -> dict | None:
        try:
            res = await self._run_sync(
                self.client.table("payment_transactions")
                    .select("*")
                    .eq("provider", provider)
                    .eq("transaction_id", str(transaction_id))
                    .limit(1)
                    .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"get_payment_transaction({provider}, {transaction_id}) failed: {e}")
            return None

    async def create_payment_transaction(self, data: dict) -> dict | None:
        try:
            res = await self._run_sync(
                self.client.table("payment_transactions")
                    .insert(data)
                    .execute
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"create_payment_transaction failed: {e}")
            return None

    async def update_payment_transaction(self, provider: str, transaction_id: str, updates: dict) -> bool:
        try:
            updates["updated_at"] = datetime.utcnow().isoformat()
            res = await self._run_sync(
                self.client.table("payment_transactions")
                    .update(updates)
                    .eq("provider", provider)
                    .eq("transaction_id", str(transaction_id))
                    .execute
            )
            return bool(res.data)
        except Exception as e:
            logger.error(f"update_payment_transaction failed: {e}")
            return False

    async def mark_order_paid(self, order_id: str, provider: str, transaction_id: str) -> bool:
        """Buyurtmani to'langan deb belgilaydi (atomar va xavfsiz)."""
        try:
            now_str = datetime.utcnow().isoformat()
            res = await self._run_sync(
                self.client.table("orders")
                    .update({
                        "payment_status": "paid",
                        "payment_method": provider,
                        "payment_confirmed_at": now_str,
                    })
                    .eq("id", order_id)
                    .execute
            )
            return bool(res.data)
        except Exception as e:
            logger.error(f"mark_order_paid({order_id}) failed: {e}")
            return False

    async def get_order_owner(self, order_id: str) -> int | None:
        """Buyurtmaning user_id'sini qaytaradi — mulkchilikni tekshirish uchun."""
        try:
            res = await self._run_sync(
                self.client.table("orders").select("user_id, payment_method, payment_status").eq("id", order_id).single().execute
            )
            return res.data
        except Exception as e:
            logger.error(f"get_order_owner({order_id}) failed: {e}")
            return None

    async def save_payment_receipt(self, order_id: str, receipt_url: str) -> bool:
        try:
            # MUHIM: .neq("payment_status", "paid") — admin allaqachon "to'landi"
            # deb tasdiqlagan buyurtmaning holatini mijoz qayta chek yuklab
            # "kutilmoqda"ga qaytarib yubora olmasligi uchun (DB darajasida himoya).
            res = await self._run_sync(
                self.client.table("orders")
                    .update({
                        "payment_receipt_url": receipt_url,
                        "payment_receipt_uploaded_at": datetime.utcnow().isoformat(),
                        "payment_status": "pending",  # "rad etildi"dan keyin qayta yuklashda yana kutishga qaytadi
                    })
                    .eq("id", order_id)
                    .neq("payment_status", "paid")
                    .execute
            )
            return bool(res.data)
        except Exception as e:
            logger.error(f"save_payment_receipt({order_id}) failed: {e}")
            return False

    async def confirm_payment(self, order_id: str, admin_id: int) -> bool:
        try:
            order_res = await self._run_sync(
                self.client.table("orders")
                    .select("id")
                    .eq("id", order_id)
                    .limit(1)
                    .execute
            )
            if not order_res.data:
                return False

            confirmed_by = None
            if admin_id > 0:
                admin_res = await self._run_sync(
                    self.client.table("users")
                        .select("id")
                        .eq("id", admin_id)
                        .limit(1)
                        .execute
                )
                if admin_res.data:
                    confirmed_by = admin_id

            res = await self._run_sync(
                self.client.table("orders")
                    .update({
                        "payment_status": "paid",
                        "payment_confirmed_by": confirmed_by,
                        "payment_confirmed_at": datetime.utcnow().isoformat(),
                    })
                    .eq("id", order_id)
                    .execute
            )
            return res is not None
        except Exception:
            logger.exception("confirm_payment(%s) failed", order_id)
            raise

    async def reject_payment(self, order_id: str, admin_id: int) -> bool:
        try:
            order_res = await self._run_sync(
                self.client.table("orders")
                    .select("id")
                    .eq("id", order_id)
                    .limit(1)
                    .execute
            )
            if not order_res.data:
                return False

            confirmed_by = None
            if admin_id > 0:
                admin_res = await self._run_sync(
                    self.client.table("users")
                        .select("id")
                        .eq("id", admin_id)
                        .limit(1)
                        .execute
                )
                if admin_res.data:
                    confirmed_by = admin_id

            res = await self._run_sync(
                self.client.table("orders")
                    .update({
                        "payment_status": "rejected",
                        "payment_confirmed_by": confirmed_by,
                        "payment_confirmed_at": datetime.utcnow().isoformat(),
                    })
                    .eq("id", order_id)
                    .execute
            )
            return res is not None
        except Exception:
            logger.exception("reject_payment(%s) failed", order_id)
            raise

    # ADMIN: COURIERS (yetkazib berish)
    async def get_couriers(self):
        """role='courier' bo'lgan barcha adminlarni, ism/username bilan qaytaradi."""
        try:
            res = await self._run_sync(
                self.client.table("admins")
                    .select("user_id, added_at, users(full_name, username)")
                    .eq("role", "courier")
                    .order("added_at", desc=True)
                    .execute
            )
            return res.data if res.data else []
        except Exception:
            logger.exception("get_couriers() failed")
            raise

    async def add_courier(self, user_id: int, added_by: int) -> tuple[bool, str | None]:
        """Foydalanuvchini kuryer sifatida qo'shadi.
        Foydalanuvchi avval botga /start bosgan bo'lishi shart (admins.user_id
        users(id)ga FK bo'lgani uchun) — aks holda tushunarli xato qaytaradi."""
        try:
            user = await self.get_user(user_id)
            if not user:
                return False, "Bu foydalanuvchi hali botga /start bosmagan — avval botni ishga tushirsin"
            await self._run_sync(
                self.client.table("admins")
                    .upsert({"user_id": user_id, "role": "courier", "added_by": added_by})
                    .execute
            )
            return True, None
        except Exception as e:
            logger.error(f"add_courier({user_id}) failed: {e}")
            return False, "Server xatosi"

    async def remove_courier(self, user_id: int) -> bool:
        try:
            await self._run_sync(
                self.client.table("admins")
                    .delete()
                    .eq("user_id", user_id)
                    .eq("role", "courier")  # faqat courier rolini o'chiradi — boshqa admin turini emas
                    .execute
            )
            return True
        except Exception as e:
            logger.error(f"remove_courier({user_id}) failed: {e}")
            return False

    async def assign_courier(self, order_id: str, courier_id: int) -> bool:
        try:
            order_res = await self._run_sync(
                self.client.table("orders")
                    .select("id")
                    .eq("id", order_id)
                    .limit(1)
                    .execute
            )
            if not order_res.data:
                return False

            res = await self._run_sync(
                self.client.table("orders")
                    .update({
                        "courier_id": courier_id,
                        "courier_assigned_at": datetime.utcnow().isoformat(),
                    })
                    .eq("id", order_id)
                    .execute
            )
            return res is not None
        except Exception:
            logger.exception(f"assign_courier({order_id}, {courier_id}) failed")
            raise

    async def unassign_courier(self, order_id: str, courier_id: int) -> bool:
        """Kuryer buyurtmani rad etganda, buyurtmadan kuryerni bo'shatadi."""
        try:
            res = await self._run_sync(
                self.client.table("orders")
                    .update({"courier_id": None, "courier_assigned_at": None})
                    .eq("id", order_id)
                    .eq("courier_id", courier_id)
                    .execute
            )
            return bool(res.data)
        except Exception as e:
            logger.error(f"unassign_courier({order_id}, {courier_id}) failed: {e}")
            return False

    async def get_order_for_courier_notification(self, order_id: str):
        try:
            res = await self._run_sync(
                self.client.table("orders")
                    .select(
                        "id,user_id,status,courier_id,total,subtotal,delivery_fee,discount,items,delivery_address,location,note,"
                        "payment_method,payment_status,"
                        "users!orders_user_id_fkey(full_name,username,phone)"
                    )
                    .eq("id", order_id)
                    .limit(1)
                    .execute
            )
            return res.data[0] if res.data else None
        except Exception:
            logger.exception("get_order_for_courier_notification(%s) failed", order_id)
            raise

    async def get_courier_daily_stats(self, courier_id: int):
        """Kuryerning bugungi yakunlangan buyurtmalari va kassa hisoboti."""
        try:
            from datetime import date
            today_iso = date.today().isoformat()
            res = await self._run_sync(
                self.client.table("orders")
                    .select("id,total,delivery_fee,payment_method,payment_status,status,created_at")
                    .eq("courier_id", courier_id)
                    .gte("created_at", f"{today_iso}T00:00:00")
                    .execute
            )
            orders = res.data or []
            delivered = [o for o in orders if o.get("status") == "delivered"]
            cash_orders = [o for o in delivered if str(o.get("payment_method") or "").lower() == "cash"]
            total_cash = sum(int(float(o.get("total") or 0)) for o in cash_orders)
            total_delivery_fees = sum(int(float(o.get("delivery_fee") or 0)) for o in delivered)
            return {
                "delivered_count": len(delivered),
                "total_orders_today": len(orders),
                "total_cash_to_deposit": total_cash,
                "total_delivery_fees": total_delivery_fees
            }
        except Exception as e:
            logger.error(f"get_courier_daily_stats({courier_id}) failed: {e}")
            return {
                "delivered_count": 0,
                "total_orders_today": 0,
                "total_cash_to_deposit": 0,
                "total_delivery_fees": 0
            }

    async def get_courier_orders(self, courier_id: int):
        """Shu kuryerga biriktirilgan, hali yakunlanmagan buyurtmalar (eng yangisi birinchi)."""
        try:
            res = await self._run_sync(
                self.client.table("orders")
                    .select("*, users!orders_user_id_fkey(full_name, username, phone)")
                    .eq("courier_id", courier_id)
                    .in_("status", ["confirmed", "cooking", "delivering"])
                    .order("created_at", desc=True)
                    .execute
            )
            return res.data if res.data else []
        except Exception:
            logger.exception(f"get_courier_orders({courier_id}) failed")
            raise

    async def update_order_status_as_courier(self, order_id: str, courier_id: int, status: str) -> bool:
        """MUHIM: courier_id filtri bilan bitta atomik so'rov — kuryer FAQAT
        o'ziga biriktirilgan buyurtmani o'zgartira oladi. Avval o'qib-keyin-
        yozish (TOCTOU) o'rniga to'g'ridan-to'g'ri shart bilan yangilaydi,
        shuning uchun poyga holati (race condition) yo'q."""
        try:
            res = await self._run_sync(
                self.client.table("orders")
                    .update({"status": status})
                    .eq("id", order_id)
                    .eq("courier_id", courier_id)
                    .execute
            )
            return bool(res.data)
        except Exception as e:
            logger.error(f"update_order_status_as_courier({order_id}, {courier_id}, {status}) failed: {e}")
            return False

    # ADMIN: USERS
    async def get_all_users(self, search=None):
        try:
            query = self.client.table("users").select("*").order("created_at", desc=True)
            if search:
                # MUHIM: ilgari faqat full_name bo'yicha qidirilardi — admin
                # @username orqali qidirsa hech narsa topilmasdi. Endi
                # ikkalasi ham (OR) qidiriladi.
                safe_search = search.replace(",", " ").replace("%", "")
                query = query.or_(f"full_name.ilike.%{safe_search}%,username.ilike.%{safe_search}%")
            res = await self._run_sync(query.limit(50).execute)
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"get_all_users(search={search!r}) failed: {e}")
            return []

    async def update_user_block(self, user_id: int, is_blocked: bool):
        try:
            await self._run_sync(self.client.table("users").update({"is_blocked": is_blocked}).eq("id", user_id).execute)
            return True
        except Exception as e:
            logger.error(f"update_user_block({user_id}, {is_blocked}) failed: {e}")
            return False

    # ADMIN: COUPONS
    async def get_all_coupons(self):
        try:
            res = await self._run_sync(self.client.table("coupons").select("*").order("created_at", desc=True).execute)
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"get_all_coupons() failed: {e}")
            return []

    async def create_coupon(self, data: dict):
        try:
            res = await self._run_sync(self.client.table("coupons").insert(data).execute)
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"create_coupon({data!r}) failed: {e}")
            return None

    async def delete_coupon(self, coupon_id: str):
        try:
            await self._run_sync(self.client.table("coupons").delete().eq("id", coupon_id).execute)
            return True
        except Exception as e:
            logger.error(f"delete_coupon({coupon_id}) failed: {e}")
            return False

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
