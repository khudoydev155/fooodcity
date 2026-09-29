"""
Oddiy, xotirada (in-memory) ishlovchi rate limiter.

MUHIM TARIX: bu fayl ilgari to'liq bo'sh stub edi —
``rate_limit_middleware`` hech narsa qilmasdan to'g'ridan-to'g'ri
``handler``ga o'tkazib yuborardi. Ya'ni loyihada "rate limiting bor"
degan taassurot bo'lsa-da, aslida HECH QANDAY cheklov ishlamas edi
(masalan /api/auth/pin'ni brute-force qilish, yoki /api/orders'ga
spam yuborish mumkin edi).

Bu yerdagi yechim bitta process ichida ishlaydi (Railway'da odatda
bitta worker). Ko'p-instance deploy qilinsa, buni Redis-based
limiter bilan almashtirish kerak bo'ladi — hozircha loyiha
ko'lamiga mos, sodda va yetarli.
"""
import time
import logging
from collections import defaultdict, deque
from aiohttp import web

logger = logging.getLogger(__name__)

# path prefiksi -> (oyna_soniyalarda, oyna_ichidagi_maksimal_so'rov)
# Eng maxsus (uzun) prefiks avval tekshiriladi.
_RULES = [
    ("/api/auth/pin", 60, 5),        # PIN brute-force'dan himoya
    ("/api/auth/verify", 60, 10),
    ("/api/orders", 60, 10),         # spam-buyurtmalardan himoya
    ("/api/order/", 60, 30),         # status polling — biroz keng
    ("/api/coupon/validate", 60, 20),
    ("/api/admin/", 60, 120),        # admin panel — issiq bo'lishi mumkin
]
_DEFAULT_WINDOW_SECONDS = 60
_DEFAULT_MAX_REQUESTS = 60

# {(ip, rule_key): deque[timestamp, ...]}
_hits = defaultdict(deque)

# Xotira o'sib ketmasligi uchun vaqti-vaqti bilan eski yozuvlarni tozalaymiz.
_last_cleanup = 0.0
_CLEANUP_INTERVAL = 300  # 5 daqiqada bir


def _client_ip(request: web.Request) -> str:
    # Railway/har qanday reverse-proxy ortida X-Forwarded-For ishlatiladi.
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    peername = request.remote
    return peername or "unknown"


def _rule_for(path: str):
    for prefix, window, limit in _RULES:
        if path.startswith(prefix):
            return prefix, window, limit
    return "__default__", _DEFAULT_WINDOW_SECONDS, _DEFAULT_MAX_REQUESTS


def _cleanup(now: float) -> None:
    global _last_cleanup
    if now - _last_cleanup < _CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    stale_keys = []
    for key, hits in _hits.items():
        while hits and now - hits[0] > 3600:  # 1 soatdan eski
            hits.popleft()
        if not hits:
            stale_keys.append(key)
    for key in stale_keys:
        _hits.pop(key, None)


@web.middleware
async def rate_limit_middleware(request: web.Request, handler):
    path = request.path
    rule_key, window, limit = _rule_for(path)

    ip = _client_ip(request)
    now = time.monotonic()
    _cleanup(now)

    key = (ip, rule_key)
    hits = _hits[key]

    # Oynadan tashqarigi eski urinishlarni olib tashlaymiz
    while hits and now - hits[0] > window:
        hits.popleft()

    if len(hits) >= limit:
        logger.warning(
            "rate_limit.blocked ip=%s path=%s rule=%s hits=%d limit=%d",
            ip, path, rule_key, len(hits), limit,
        )
        return web.json_response(
            {"error": "Juda ko'p so'rov. Birozdan so'ng qayta urinib ko'ring."},
            status=429,
        )

    hits.append(now)
    return await handler(request)
