-- Allow customers to cancel only orders that are still new.
-- Keep the status change, loyalty ledger, user totals, and coupon usage atomic.
CREATE OR REPLACE FUNCTION cancel_customer_order(
  p_order_id TEXT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_coupon_id UUID;
BEGIN
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_order.status <> 'new' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_cancellable');
  END IF;

  UPDATE orders
  SET status = 'cancelled'
  WHERE id = p_order_id AND user_id = p_user_id;

  UPDATE users
  SET loyalty_points = GREATEST(
        0,
        COALESCE(loyalty_points, 0)
          - COALESCE(v_order.loyalty_points_earned, 0)
          + COALESCE(v_order.loyalty_points_used, 0)
      ),
      total_orders = GREATEST(0, COALESCE(total_orders, 0) - 1),
      total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(v_order.total, 0))
  WHERE id = p_user_id;

  INSERT INTO loyalty_transactions (user_id, order_id, points, reason)
  SELECT user_id, order_id, -points, 'Buyurtma bekor qilindi'
  FROM loyalty_transactions
  WHERE user_id = p_user_id AND order_id = p_order_id AND points <> 0;

  DELETE FROM coupon_usage
  WHERE user_id = p_user_id AND order_id = p_order_id
  RETURNING coupon_id INTO v_coupon_id;

  IF v_coupon_id IS NOT NULL THEN
    UPDATE coupons
    SET used_count = GREATEST(0, used_count - 1)
    WHERE id = v_coupon_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION cancel_customer_order(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_customer_order(TEXT, BIGINT) TO service_role;
