import base64
import hashlib
import hmac
import logging
import time
import uuid
from datetime import datetime
from typing import Tuple, Dict, Any, Optional

from bot.config import config
from bot.database import db

logger = logging.getLogger(__name__)


# ─── PAYME ERROR CODES ───────────────────────────────────────────────────────
class PaymeError:
    INVALID_AMOUNT = -31001
    TRANSACTION_NOT_FOUND = -31003
    UNABLE_TO_PERFORM = -31008
    ORDER_NOT_FOUND = -31050
    ALREADY_DONE = -31060
    PENDING = -31051
    AUTH_ERROR = -32504
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602


# ─── CLICK ERROR CODES ───────────────────────────────────────────────────────
class ClickError:
    SUCCESS = 0
    SIGN_CHECK_FAILED = -1
    INCORRECT_AMOUNT = -2
    ACTION_NOT_FOUND = -3
    ALREADY_PAID = -4
    ORDER_NOT_FOUND = -5
    TRANSACTION_NOT_FOUND = -6
    UPDATE_FAILED = -7
    REQUEST_ERROR = -8
    TRANSACTION_CANCELLED = -9


class PaymentService:
    """Click va Payme to'lov tizimlari uchun biznes-mantiq va xavfsizlik servisi."""

    # ── 1. To'lov havolalarini generatsiya qilish ───────────────────────────
    @staticmethod
    async def generate_payment_url(order_id: str, provider: str, total_sum: int, return_url: str = "") -> str:
        """
        Buyurtma uchun Click yoki Payme to'lov havolasini (yoki Deep Link) yaratadi.
        """
        settings = await db.get_click_and_payme_settings()
        provider = provider.lower().strip()

        if provider == "click":
            service_id = settings.get("click_service_id")
            merchant_id = settings.get("click_merchant_id")
            if not service_id or not merchant_id:
                # Agar hali merchant ma'lumotlari kiritilmagan bo'lsa ham xatolik bermaydi,
                # balki foydalanuvchiga tushunarli bo'lishi uchun xabar bilan fallback beradi
                logger.warning("Click merchant sozlamalari (service_id / merchant_id) kiritilmagan")
            
            # Click Web / App URL
            ret_url = return_url or config.MINI_APP_URL
            url = (
                f"https://my.click.uz/services/pay"
                f"?service_id={service_id}"
                f"&merchant_id={merchant_id}"
                f"&amount={int(total_sum)}"
                f"&transaction_param={order_id}"
                f"&return_url={ret_url}"
            )
            return url

        elif provider == "payme":
            merchant_id = settings.get("payme_merchant_id")
            test_mode = settings.get("payme_test_mode", True)
            if not merchant_id:
                logger.warning("Payme merchant sozlamasi (payme_merchant_id) kiritilmagan")

            # Payme summani tiyinda qabul qiladi (1 so'm = 100 tiyin)
            amount_tiyin = int(total_sum) * 100
            raw_param = f"m={merchant_id};ac.order_id={order_id};a={amount_tiyin}"
            encoded_param = base64.b64encode(raw_param.encode("utf-8")).decode("utf-8")

            base_domain = "https://test.paycom.uz" if test_mode else "https://checkout.paycom.uz"
            return f"{base_domain}/{encoded_param}"

        return ""

    # ── 2. CLICK METODLARI ───────────────────────────────────────────────────
    @staticmethod
    def _verify_click_signature(data: dict, secret_key: str, is_complete: bool = False) -> bool:
        """Click so'rovining MD5 imzosini tekshiradi."""
        click_trans_id = str(data.get("click_trans_id", ""))
        service_id = str(data.get("service_id", ""))
        merchant_trans_id = str(data.get("merchant_trans_id", ""))
        amount = str(data.get("amount", ""))
        action = str(data.get("action", ""))
        sign_time = str(data.get("sign_time", ""))
        sign_string = str(data.get("sign_string", ""))

        if is_complete:
            merchant_prepare_id = str(data.get("merchant_prepare_id", ""))
            raw = f"{click_trans_id}{service_id}{secret_key}{merchant_trans_id}{merchant_prepare_id}{amount}{action}{sign_time}"
        else:
            raw = f"{click_trans_id}{service_id}{secret_key}{merchant_trans_id}{amount}{action}{sign_time}"

        digest = hashlib.md5(raw.encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest.lower(), sign_string.lower())

    @classmethod
    async def process_click_prepare(cls, data: dict) -> dict:
        """Click Prepare so'rovini qayta ishlash."""
        click_trans_id = str(data.get("click_trans_id", ""))
        merchant_trans_id = str(data.get("merchant_trans_id", ""))
        amount_raw = data.get("amount")
        action = data.get("action")

        settings = await db.get_click_and_payme_settings()
        secret_key = settings.get("click_secret_key", "")

        # 1. Imzoni tekshirish
        if secret_key and not cls._verify_click_signature(data, secret_key, is_complete=False):
            logger.warning(f"Click Prepare: Imzo mos kelmadi (order: {merchant_trans_id})")
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.SIGN_CHECK_FAILED,
                "error_note": "SIGN CHECK FAILED"
            }

        # 2. Action tekshirish (0 = Prepare)
        if str(action) != "0":
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.ACTION_NOT_FOUND,
                "error_note": "Action not found"
            }

        # 3. Buyurtmani topish
        order = await db.get_order_by_id(merchant_trans_id)
        if not order:
            logger.warning(f"Click Prepare: Buyurtma topilmadi ({merchant_trans_id})")
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.ORDER_NOT_FOUND,
                "error_note": "Order not found"
            }

        # 4. Buyurtma holatini tekshirish
        if order.get("status") == "cancelled":
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.TRANSACTION_CANCELLED,
                "error_note": "Order is cancelled"
            }

        if order.get("payment_status") == "paid":
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.ALREADY_PAID,
                "error_note": "Already paid"
            }

        # 5. Summani tekshirish
        try:
            req_amount = int(float(amount_raw))
        except (ValueError, TypeError):
            req_amount = 0

        order_total = int(float(order.get("total", 0)))
        if req_amount != order_total:
            logger.warning(f"Click Prepare: Summa mos kelmadi ({req_amount} != {order_total})")
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.INCORRECT_AMOUNT,
                "error_note": "Incorrect parameter amount"
            }

        # 6. Tranzaksiyani yaratish yoki yangilash
        existing_tx = await db.get_payment_transaction("click", click_trans_id)
        if existing_tx:
            merchant_prepare_id = existing_tx.get("merchant_prepare_id") or str(existing_tx["id"])
        else:
            merchant_prepare_id = uuid.uuid4().hex[:16]
            await db.create_payment_transaction({
                "order_id": merchant_trans_id,
                "provider": "click",
                "transaction_id": click_trans_id,
                "merchant_prepare_id": merchant_prepare_id,
                "amount": order_total,
                "status": "prepared",
                "raw_payload": data,
            })

        return {
            "click_trans_id": click_trans_id,
            "merchant_trans_id": merchant_trans_id,
            "merchant_prepare_id": merchant_prepare_id,
            "error": ClickError.SUCCESS,
            "error_note": "Success"
        }

    @classmethod
    async def process_click_complete(cls, data: dict) -> Tuple[dict, Optional[dict]]:
        """
        Click Complete so'rovini qayta ishlash.
        Qaytaradi: (click_response_dict, paid_order_dict | None)
        """
        click_trans_id = str(data.get("click_trans_id", ""))
        merchant_trans_id = str(data.get("merchant_trans_id", ""))
        merchant_prepare_id = str(data.get("merchant_prepare_id", ""))
        error = data.get("error")

        settings = await db.get_click_and_payme_settings()
        secret_key = settings.get("click_secret_key", "")

        # 1. Imzo tekshiruvi
        if secret_key and not cls._verify_click_signature(data, secret_key, is_complete=True):
            logger.warning(f"Click Complete: Imzo xato ({merchant_trans_id})")
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.SIGN_CHECK_FAILED,
                "error_note": "SIGN CHECK FAILED"
            }, None

        # 2. Tranzaksiyani topish
        tx = await db.get_payment_transaction("click", click_trans_id)
        if not tx:
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.TRANSACTION_NOT_FOUND,
                "error_note": "Transaction not found"
            }, None

        # 3. Agar Click tomonda to'lov bekor qilingan bo'lsa (error < 0)
        try:
            err_code = int(error or 0)
        except (ValueError, TypeError):
            err_code = 0

        if err_code < 0:
            await db.update_payment_transaction("click", click_trans_id, {
                "status": "cancelled",
                "cancel_reason": err_code,
                "cancel_time": datetime.utcnow().isoformat()
            })
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "error": ClickError.TRANSACTION_CANCELLED,
                "error_note": "Transaction cancelled"
            }, None

        # 4. Agar allaqachon to'langan bo'lsa (idempotency)
        if tx.get("status") == "paid":
            order = await db.get_order_by_id(merchant_trans_id)
            return {
                "click_trans_id": click_trans_id,
                "merchant_trans_id": merchant_trans_id,
                "merchant_confirm_id": merchant_prepare_id,
                "error": ClickError.SUCCESS,
                "error_note": "Success"
            }, order

        # 5. Muvaffaqiyatli to'lov: bazada buyurtma va tranzaksiyani yangilash
        now_iso = datetime.utcnow().isoformat()
        await db.update_payment_transaction("click", click_trans_id, {
            "status": "paid",
            "perform_time": now_iso,
            "raw_payload": data,
        })
        await db.mark_order_paid(merchant_trans_id, "click", click_trans_id)

        order = await db.get_order_by_id(merchant_trans_id)
        logger.info(f"Click to'lov muvaffaqiyatli qabul qilindi: Order #{merchant_trans_id}, ClickTx #{click_trans_id}")

        return {
            "click_trans_id": click_trans_id,
            "merchant_trans_id": merchant_trans_id,
            "merchant_confirm_id": merchant_prepare_id,
            "error": ClickError.SUCCESS,
            "error_note": "Success"
        }, order

    # ── 3. PAYME METODLARI (JSON-RPC 2.0) ───────────────────────────────────
    @staticmethod
    def verify_payme_auth(auth_header: str, secret_key: str) -> bool:
        """Payme Basic Auth tekshiruvi: Authorization: Basic base64(Paycom:secret_key)."""
        if not secret_key:
            return True  # Agar hali kalit o'rnatilmagan bo'lsa (dev/test)
        if not auth_header or not auth_header.startswith("Basic "):
            return False
        try:
            encoded = auth_header[6:].strip()
            decoded = base64.b64decode(encoded).decode("utf-8")
            # Format "Paycom:secret_key"
            parts = decoded.split(":", 1)
            if len(parts) == 2 and parts[0] == "Paycom":
                return hmac.compare_digest(parts[1], secret_key)
            return False
        except Exception:
            return False

    @classmethod
    async def process_payme_rpc(cls, payload: dict, auth_header: str) -> Tuple[dict, Optional[dict]]:
        """
        Payme JSON-RPC so'rovini to'liq qayta ishlaydi.
        Qaytaradi: (rpc_response_dict, paid_order_dict | None)
        """
        rpc_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params") or {}

        settings = await db.get_click_and_payme_settings()
        secret_key = settings.get("payme_secret_key", "")

        # 1. Auth tekshiruvi
        if secret_key and not cls.verify_payme_auth(auth_header, secret_key):
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {
                    "code": PaymeError.AUTH_ERROR,
                    "message": "Insufficient privilege to perform this method"
                }
            }, None

        # 2. Metodlar bo'yicha yo'naltirish
        paid_order = None
        try:
            if method == "CheckPerformTransaction":
                result = await cls._payme_check_perform_transaction(params)
            elif method == "CreateTransaction":
                result = await cls._payme_create_transaction(params)
            elif method == "PerformTransaction":
                result, paid_order = await cls._payme_perform_transaction(params)
            elif method == "CancelTransaction":
                result = await cls._payme_cancel_transaction(params)
            elif method == "CheckTransaction":
                result = await cls._payme_check_transaction(params)
            elif method == "GetStatement":
                result = await cls._payme_get_statement(params)
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {
                        "code": PaymeError.METHOD_NOT_FOUND,
                        "message": f"Method '{method}' not found"
                    }
                }, None

            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": result
            }, paid_order

        except PaymeException as pe:
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {
                    "code": pe.code,
                    "message": pe.message,
                    "data": pe.data
                }
            }, None
        except Exception as e:
            logger.exception(f"Payme RPC kutilmagan xatolik: {e}")
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {
                    "code": PaymeError.UNABLE_TO_PERFORM,
                    "message": "Internal server error"
                }
            }, None

    @classmethod
    async def _payme_check_perform_transaction(cls, params: dict) -> dict:
        account = params.get("account") or {}
        order_id = str(account.get("order_id", ""))
        amount_tiyin = params.get("amount")

        order = await db.get_order_by_id(order_id)
        if not order:
            raise PaymeException(PaymeError.ORDER_NOT_FOUND, "Buyurtma topilmadi", "order_id")

        if order.get("status") == "cancelled":
            raise PaymeException(PaymeError.UNABLE_TO_PERFORM, "Buyurtma bekor qilingan")

        if order.get("payment_status") == "paid":
            raise PaymeException(PaymeError.ALREADY_DONE, "Buyurtma allaqachon to'langan")

        order_total_tiyin = int(float(order.get("total", 0))) * 100
        if int(amount_tiyin or 0) != order_total_tiyin:
            raise PaymeException(PaymeError.INVALID_AMOUNT, "Noto'g'ri to'lov summasi", "amount")

        return {"allow": True}

    @classmethod
    async def _payme_create_transaction(cls, params: dict) -> dict:
        trans_id = str(params.get("id", ""))
        time_ms = int(params.get("time") or int(time.time() * 1000))
        amount_tiyin = int(params.get("amount") or 0)
        account = params.get("account") or {}
        order_id = str(account.get("order_id", ""))

        # 1. Mavjud tranzaksiyani tekshirish
        tx = await db.get_payment_transaction("payme", trans_id)
        if tx:
            # Agar mavjud bo'lsa
            tx_status = tx.get("status")
            tx_created_ms = int(datetime.fromisoformat(tx["created_at"].replace("Z", "+00:00")).timestamp() * 1000)
            
            # 12 soatlik (43_200_000 ms) timeout tekshiruvi
            if tx_status == "created":
                if int(time.time() * 1000) - tx_created_ms > 43_200_000:
                    await db.update_payment_transaction("payme", trans_id, {
                        "status": "cancelled",
                        "cancel_reason": 4,
                        "cancel_time": datetime.utcnow().isoformat()
                    })
                    raise PaymeException(PaymeError.UNABLE_TO_PERFORM, "Tranzaksiya vaqti tugagan")
                return {
                    "create_time": tx_created_ms,
                    "transaction": str(tx["id"]),
                    "state": 1
                }
            elif tx_status == "paid":
                return {
                    "create_time": tx_created_ms,
                    "transaction": str(tx["id"]),
                    "state": 2
                }
            else:
                raise PaymeException(PaymeError.UNABLE_TO_PERFORM, "Tranzaksiya bekor qilingan")

        # 2. Buyurtmani tekshirish
        await cls._payme_check_perform_transaction(params)

        # 3. Yangi tranzaksiya yaratish
        created_tx = await db.create_payment_transaction({
            "order_id": order_id,
            "provider": "payme",
            "transaction_id": trans_id,
            "amount": amount_tiyin // 100,
            "status": "created",
            "raw_payload": params,
        })
        if not created_tx:
            raise PaymeException(PaymeError.UNABLE_TO_PERFORM, "Tranzaksiya saqlab bo'lmadi")

        return {
            "create_time": time_ms,
            "transaction": str(created_tx["id"]),
            "state": 1
        }

    @classmethod
    async def _payme_perform_transaction(cls, params: dict) -> Tuple[dict, Optional[dict]]:
        trans_id = str(params.get("id", ""))
        tx = await db.get_payment_transaction("payme", trans_id)
        if not tx:
            raise PaymeException(PaymeError.TRANSACTION_NOT_FOUND, "Tranzaksiya topilmadi")

        tx_status = tx.get("status")
        now_ms = int(time.time() * 1000)
        order_id = tx.get("order_id")

        if tx_status == "paid":
            # Allaqachon to'langan bo'lsa (idempotency)
            perform_ms = int(datetime.fromisoformat(tx["perform_time"].replace("Z", "+00:00")).timestamp() * 1000) if tx.get("perform_time") else now_ms
            order = await db.get_order_by_id(order_id)
            return {
                "transaction": str(tx["id"]),
                "perform_time": perform_ms,
                "state": 2
            }, order

        if tx_status != "created":
            raise PaymeException(PaymeError.UNABLE_TO_PERFORM, "Tranzaksiya to'lovga tayyor emas")

        # Timeout tekshiruvi (12 soat)
        tx_created_ms = int(datetime.fromisoformat(tx["created_at"].replace("Z", "+00:00")).timestamp() * 1000)
        if now_ms - tx_created_ms > 43_200_000:
            await db.update_payment_transaction("payme", trans_id, {
                "status": "cancelled",
                "cancel_reason": 4,
                "cancel_time": datetime.utcnow().isoformat()
            })
            raise PaymeException(PaymeError.UNABLE_TO_PERFORM, "Tranzaksiya vaqti tugagan")

        # To'lovni amalga oshirish
        now_iso = datetime.utcnow().isoformat()
        await db.update_payment_transaction("payme", trans_id, {
            "status": "paid",
            "perform_time": now_iso,
        })
        await db.mark_order_paid(order_id, "payme", trans_id)

        order = await db.get_order_by_id(order_id)
        logger.info(f"Payme to'lov muvaffaqiyatli qabul qilindi: Order #{order_id}, PaymeTx #{trans_id}")

        return {
            "transaction": str(tx["id"]),
            "perform_time": now_ms,
            "state": 2
        }, order

    @classmethod
    async def _payme_cancel_transaction(cls, params: dict) -> dict:
        trans_id = str(params.get("id", ""))
        reason = int(params.get("reason") or 0)
        now_ms = int(time.time() * 1000)

        tx = await db.get_payment_transaction("payme", trans_id)
        if not tx:
            raise PaymeException(PaymeError.TRANSACTION_NOT_FOUND, "Tranzaksiya topilmadi")

        tx_status = tx.get("status")
        if tx_status == "cancelled":
            cancel_ms = int(datetime.fromisoformat(tx["cancel_time"].replace("Z", "+00:00")).timestamp() * 1000) if tx.get("cancel_time") else now_ms
            state = -2 if tx.get("perform_time") else -1
            return {
                "transaction": str(tx["id"]),
                "cancel_time": cancel_ms,
                "state": state
            }

        # Agar to'lov qilingan bo'lsa (state = 2) -> refund (state = -2)
        # Agar faqat yaratilgan bo'lsa (state = 1) -> cancel (state = -1)
        state = -2 if tx_status == "paid" else -1
        now_iso = datetime.utcnow().isoformat()
        await db.update_payment_transaction("payme", trans_id, {
            "status": "cancelled",
            "cancel_reason": reason,
            "cancel_time": now_iso,
        })

        return {
            "transaction": str(tx["id"]),
            "cancel_time": now_ms,
            "state": state
        }

    @classmethod
    async def _payme_check_transaction(cls, params: dict) -> dict:
        trans_id = str(params.get("id", ""))
        tx = await db.get_payment_transaction("payme", trans_id)
        if not tx:
            raise PaymeException(PaymeError.TRANSACTION_NOT_FOUND, "Tranzaksiya topilmadi")

        create_ms = int(datetime.fromisoformat(tx["created_at"].replace("Z", "+00:00")).timestamp() * 1000)
        perform_ms = int(datetime.fromisoformat(tx["perform_time"].replace("Z", "+00:00")).timestamp() * 1000) if tx.get("perform_time") else 0
        cancel_ms = int(datetime.fromisoformat(tx["cancel_time"].replace("Z", "+00:00")).timestamp() * 1000) if tx.get("cancel_time") else 0

        status = tx.get("status")
        if status == "created":
            state = 1
        elif status == "paid":
            state = 2
        elif status == "cancelled":
            state = -2 if perform_ms > 0 else -1
        else:
            state = -1

        return {
            "create_time": create_ms,
            "perform_time": perform_ms,
            "cancel_time": cancel_ms,
            "transaction": str(tx["id"]),
            "state": state,
            "reason": tx.get("cancel_reason")
        }

    @classmethod
    async def _payme_get_statement(cls, params: dict) -> dict:
        """Belgilangan vaqt oralig'idagi Payme tranzaksiyalarini qaytaradi."""
        from_ms = int(params.get("from") or 0)
        to_ms = int(params.get("to") or int(time.time() * 1000))
        from_iso = datetime.utcfromtimestamp(from_ms / 1000).isoformat()
        to_iso = datetime.utcfromtimestamp(to_ms / 1000).isoformat()

        try:
            res = await db._run_sync(
                db.client.table("payment_transactions")
                    .select("*")
                    .eq("provider", "payme")
                    .gte("created_at", from_iso)
                    .lte("created_at", to_iso)
                    .execute
            )
            transactions_list = []
            for row in (res.data or []):
                c_ms = int(datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).timestamp() * 1000)
                p_ms = int(datetime.fromisoformat(row["perform_time"].replace("Z", "+00:00")).timestamp() * 1000) if row.get("perform_time") else 0
                cn_ms = int(datetime.fromisoformat(row["cancel_time"].replace("Z", "+00:00")).timestamp() * 1000) if row.get("cancel_time") else 0
                st = 1 if row["status"] == "created" else (2 if row["status"] == "paid" else (-2 if p_ms > 0 else -1))
                transactions_list.append({
                    "id": row["transaction_id"],
                    "time": c_ms,
                    "amount": int(row["amount"]) * 100,
                    "account": {"order_id": row["order_id"]},
                    "create_time": c_ms,
                    "perform_time": p_ms,
                    "cancel_time": cn_ms,
                    "transaction": str(row["id"]),
                    "state": st,
                    "reason": row.get("cancel_reason")
                })
            return {"transactions": transactions_list}
        except Exception as e:
            logger.error(f"Payme GetStatement failed: {e}")
            return {"transactions": []}


class PaymeException(Exception):
    def __init__(self, code: int, message: str, data: str = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data
