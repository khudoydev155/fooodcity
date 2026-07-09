-- ============================================================================
-- 002: create_order_atomic RPC (aniq ball birligi bilan) + buyurtma bahosi
--
-- MUAMMO: create_order_atomic funksiyasi repo'da saqlanmagan edi (faqat jonli
-- bazada), shuning uchun ball yechish birligi (so'mmi yoki ballmi) noma'lum
-- edi. Bu migratsiya funksiyani deterministik qilib qayta yaratadi:
--   * p_points_used  — SO'MDA keladi (frontend: 1 ball = 10 so'm)
--   * foydalanuvchi balansidan p_points_used / 10 BALL yechiladi
--   * yetarli ball bo'lmasa buyurtma rad etiladi (xavfsiz)
--
-- ISHLATISH: Supabase Dashboard → SQL Editor → shu faylni to'liq yurgizing.
-- ============================================================================

-- 1) Buyurtmaga baho ustuni (mini-appdagi ⭐ baholash uchun)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating INTEGER
  CHECK (rating BETWEEN 1 AND 5);

-- 2) Eski create_order_atomic ning barcha variantlarini o'chirish
--    (CREATE OR REPLACE tip farqida overload yaratib, RPC ni buzib qo'ymasligi uchun)
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

-- 3) Yangi, atomar va birliklari aniq funksiya
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
  p_points_earned    INTEGER,   -- BALLDA (har 1000 so'mga 1 ball, backend hisoblaydi)
  p_language         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_points_to_deduct INTEGER := COALESCE(p_points_used, 0) / 10; -- so'm → ball
  v_balance          INTEGER;
  v_coupon_id        UUID;
  v_item             JSONB;
BEGIN
  -- Foydalanuvchi mavjudligini kafolatlaymiz (FK xatosining oldini olish)
  INSERT INTO users (id, full_name, language)
  VALUES (p_user_id, 'Telegram user', COALESCE(p_language, 'uz'))
  ON CONFLICT (id) DO NOTHING;

  -- Ball yetarliligini qulf bilan tekshiramiz (parallel buyurtmalarga chidamli)
  SELECT loyalty_points INTO v_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_points_to_deduct > 0 AND COALESCE(v_balance, 0) < v_points_to_deduct THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ball yetarli emas');
  END IF;

  -- Buyurtmani yaratamiz
  INSERT INTO orders (
    id, user_id, items, subtotal, delivery_fee, discount, total,
    delivery_address, location, note, coupon_code,
    loyalty_points_used, loyalty_points_earned, language
  ) VALUES (
    p_order_id, p_user_id, p_items, p_subtotal, p_delivery_fee, p_discount, p_total,
    p_delivery_address, p_location, NULLIF(p_note, ''), NULLIF(p_coupon_code, ''),
    v_points_to_deduct, COALESCE(p_points_earned, 0), COALESCE(p_language, 'uz')
  );

  -- Foydalanuvchi statistikasi va ball balansi (yechish BALLDA!)
  UPDATE users SET
    loyalty_points = loyalty_points - v_points_to_deduct + COALESCE(p_points_earned, 0),
    total_orders   = total_orders + 1,
    total_spent    = total_spent + COALESCE(p_total, 0),
    last_active    = NOW()
  WHERE id = p_user_id;

  -- Ball tarixini yozamiz
  IF v_points_to_deduct > 0 THEN
    INSERT INTO loyalty_transactions (user_id, order_id, points, reason)
    VALUES (p_user_id, p_order_id, -v_points_to_deduct, 'Buyurtmada ishlatildi');
  END IF;
  IF COALESCE(p_points_earned, 0) > 0 THEN
    INSERT INTO loyalty_transactions (user_id, order_id, points, reason)
    VALUES (p_user_id, p_order_id, p_points_earned, 'Buyurtmadan yig''ildi');
  END IF;

  -- Kupon hisobi (bir foydalanuvchi bir marta — UNIQUE cheklov himoya qiladi)
  IF NULLIF(p_coupon_code, '') IS NOT NULL THEN
    SELECT id INTO v_coupon_id FROM coupons WHERE code = upper(p_coupon_code);
    IF v_coupon_id IS NOT NULL THEN
      UPDATE coupons SET used_count = used_count + 1 WHERE id = v_coupon_id;
      INSERT INTO coupon_usage (coupon_id, user_id, order_id)
      VALUES (v_coupon_id, p_user_id, p_order_id)
      ON CONFLICT (coupon_id, user_id) DO NOTHING;
    END IF;
  END IF;

  -- Mahsulot analitikasi (necha marta buyurtma qilingan)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE menu_items
    SET total_ordered = total_ordered + COALESCE((v_item->>'qty')::INTEGER, 1)
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
EXCEPTION WHEN OTHERS THEN
  -- Istalgan xato butun tranzaksiyani bekor qiladi (atomarlik)
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
