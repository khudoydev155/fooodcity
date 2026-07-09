from bot.config import config

def calculate_points_earned(order_total: int) -> int:
    """LOYALTY_POINTS_PER_ORDER points per 1000 UZS"""
    # e.g., 55,000 / 1000 = 55. 55 * 10 = 550 points
    return int((order_total / 1000) * config.LOYALTY_POINTS_PER_ORDER)

def calculate_points_value(points: int) -> int:
    """points * LOYALTY_POINTS_VALUE"""
    return points * config.LOYALTY_POINTS_VALUE

def max_redeemable_points(subtotal: int) -> int:
    """Max 30% of subtotal can be covered by points. Returns max points."""
    max_discount = int(subtotal * 0.3)
    return max_discount // config.LOYALTY_POINTS_VALUE
