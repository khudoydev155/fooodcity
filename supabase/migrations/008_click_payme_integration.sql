-- ============================================================================
-- 008: Click & Payme integratsiyasi (P2P olib tashlandi, faqat 3 ta to'lov turi)
--
-- Ushbu migratsiya orqali:
--   1. orders jadvalida faqat 3 ta rasmiy to'lov usuli qoladi:
--      'cash', 'click', 'payme' (noqulay va soxta chekli 'card_transfer' butunlay olib tashlandi)
--   2. To'lov tranzaksiyalari auditi va takroriy to'lov/soxta to'lovlardan
--      himoyalanish uchun payment_transactions jadvali yaratiladi
--   3. system_settings jadvaliga Click va Payme sozlamalari qo'shiladi
--   4. create_order_atomic RPC funksiyasi yangi to'lov turlariga moslashtiriladi
-- ============================================================================

-- 1) orders jadvalidagi payment_method cheklovini yangilash (faqat cash, click, payme)
UPDATE orders SET payment_method = 'cash' WHERE payment_method IS NOT NULL AND payment_method NOT IN ('cash', 'click', 'payme');
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash', 'click', 'payme'));

-- payment_status cheklovini yangilash
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'rejected', 'cancelled'));

-- 2) payment_transactions jadvali (avtomatik webhook auditi va soxta to'lovdan himoya)
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('click', 'payme')),
  transaction_id TEXT NOT NULL,
  merchant_prepare_id TEXT,
  amount BIGINT NOT NULL, -- so'mda
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'prepared', 'paid', 'cancelled', 'failed')),
  perform_time TIMESTAMPTZ,
  cancel_time TIMESTAMPTZ,
  cancel_reason INTEGER,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_payment_provider_trans UNIQUE (provider, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_status ON payment_transactions(provider, status);

-- 3) system_settings jadvaliga Click va Payme sozlamalari
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS click_service_id TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS click_merchant_id TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS click_secret_key TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS click_merchant_user_id TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS payme_merchant_id TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS payme_secret_key TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS payme_test_mode BOOLEAN DEFAULT true;

-- 4) create_order_atomic RPC'ni yangilaymiz (faqat cash, click, payme)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'create_order_atomic'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION create_order_atomic(
  p_order_id         TEXT,
  p_user_id          BIGINT,
  p_items            JSONB,
  p_subtotal         INTEGER,
  p_delivery_fee     INTEGER,
  p_discount         INTEGER,
  p_total            INTEGER,
  p_delivery_address TEXT,
  p_location         JSONB,
  p_note             TEXT,
  p_coupon_code      TEXT,
  p_points_used      INTEGER,   -- SO'MDA (1 ball = 10 so'm)
  p_points_earned    INTEGER,   -- BALLDA (har 1000 so'mga 1 ball)
  p_language         TEXT,
  p_payment_method   TEXT DEFAULT 'cash'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points_to_deduct INTEGER := COALESCE(p_points_used, 0) / 10;
  v_balance          INTEGER;
  v_coupon_id        UUID;
  v_item             JSONB;
  v_method           TEXT;
BEGIN
  -- To'lov usuli: faqat cash, click, payme
  v_method := LOWER(COALESCE(NULLIF(TRIM(p_payment_method), ''), 'cash'));
  IF v_method NOT IN ('cash', 'click', 'payme') THEN
    v_method := 'cash';
  END IF;

  -- Foydalanuvchi mavjudligini kafolatlaymiz
  INSERT INTO users (id, full_name, language)
  VALUES (p_user_id, 'Telegram user', COALESCE(p_language, 'uz'))
  ON CONFLICT (id) DO NOTHING;

  -- Ball yetarliligini tekshiramiz
  SELECT loyalty_points INTO v_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_points_to_deduct > 0 AND COALESCE(v_balance, 0) < v_points_to_deduct THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ball yetarli emas');
  END IF;

  -- Buyurtmani yaratamiz
  INSERT INTO orders (
    id, user_id, items, subtotal, delivery_fee, discount, total,
    delivery_address, location, note, coupon_code,
    loyalty_points_used, loyalty_points_earned, language, payment_method,
    payment_status
  ) VALUES (
    p_order_id, p_user_id, p_items, p_subtotal, p_delivery_fee, p_discount, p_total,
    p_delivery_address, p_location, NULLIF(p_note, ''), NULLIF(p_coupon_code, ''),
    v_points_to_deduct, COALESCE(p_points_earned, 0), COALESCE(p_language, 'uz'),
    v_method, 'pending'
  );

  -- Foydalanuvchi statistikasi va ball balansi
  UPDATE users SET
    loyalty_points = loyalty_points - v_points_to_deduct + COALESCE(p_points_earned, 0),
    total_orders   = total_orders + 1,
    total_spent    = total_spent + COALESCE(p_total, 0),
    last_active    = NOW()
  WHERE id = p_user_id;

  -- Ball tarixi
  IF v_points_to_deduct > 0 THEN
    INSERT INTO loyalty_transactions (user_id, order_id, points, reason)
    VALUES (p_user_id, p_order_id, -v_points_to_deduct, 'Buyurtmada ishlatildi');
  END IF;
  IF COALESCE(p_points_earned, 0) > 0 THEN
    INSERT INTO loyalty_transactions (user_id, order_id, points, reason)
    VALUES (p_user_id, p_order_id, p_points_earned, 'Buyurtmadan yig''ildi');
  END IF;

  -- Kupon hisobi
  IF NULLIF(p_coupon_code, '') IS NOT NULL THEN
    SELECT id INTO v_coupon_id FROM coupons WHERE code = upper(p_coupon_code);
    IF v_coupon_id IS NOT NULL THEN
      UPDATE coupons SET used_count = used_count + 1 WHERE id = v_coupon_id;
      INSERT INTO coupon_usage (coupon_id, user_id, order_id)
      VALUES (v_coupon_id, p_user_id, p_order_id)
      ON CONFLICT (coupon_id, user_id) DO NOTHING;
    END IF;
  END IF;

  -- Mahsulot analitikasi
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE menu_items
    SET total_ordered = total_ordered + COALESCE((v_item->>'qty')::INTEGER, 1)
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RLS xavfsizlik
REVOKE ALL ON FUNCTION create_order_atomic(TEXT, BIGINT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_order_atomic(TEXT, BIGINT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO service_role;

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_transactions_service_role" ON payment_transactions;
CREATE POLICY "payment_transactions_service_role" ON payment_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
