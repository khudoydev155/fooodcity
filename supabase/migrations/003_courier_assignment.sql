-- ============================================================================
-- 003: Kuryer roli va buyurtmani kuryerga biriktirish
--
-- Bu migratsiya "Yetkazib berish paneli" funksiyasi uchun zarur:
--   * admins.role ga 'courier' qiymati qo'shiladi (mavjud admin panel
--     login/token mexanizmi qayta ishlatiladi — alohida auth tizimi shart
--     emas, kichik do'kon uchun ortiqcha murakkablik bo'lardi).
--   * orders jadvaliga courier_id (qaysi kuryerga biriktirilgan) va
--     courier_assigned_at ustunlari qo'shiladi.
--
-- ISHLATISH: Supabase Dashboard → SQL Editor → shu faylni to'liq yurgizing.
-- ============================================================================

-- 1) admins.role CHECK'ga 'courier' qo'shamiz
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
  CHECK (role IN ('superadmin', 'admin', 'staff', 'courier'));

-- 2) Buyurtmani kuryerga biriktirish uchun ustunlar
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_id BIGINT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_courier_id ON orders(courier_id);
