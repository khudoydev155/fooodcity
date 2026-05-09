-- menu_items, categories: SELECT open to all (anon key)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories are viewable by everyone" ON categories
  FOR SELECT USING (true);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Menu items are viewable by everyone" ON menu_items
  FOR SELECT USING (true);

-- All INSERT/UPDATE/DELETE: only service_role key (backend)
-- For categories
CREATE POLICY "Categories insert/update/delete by service_role only" ON categories
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- For menu_items
CREATE POLICY "Menu items insert/update/delete by service_role only" ON menu_items
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- users, orders, wishlist: users can only read their own rows
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (
    id::text = (current_setting('request.jwt.claims', true)::json->>'sub') 
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );
CREATE POLICY "Users all by service_role" ON users
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own orders" ON orders
  FOR SELECT USING (
    user_id::text = (current_setting('request.jwt.claims', true)::json->>'sub')
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );
CREATE POLICY "Orders all by service_role" ON orders
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

ALTER TABLE wishlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own wishlist" ON wishlist
  FOR SELECT USING (
    user_id::text = (current_setting('request.jwt.claims', true)::json->>'sub')
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );
CREATE POLICY "Wishlist all by service_role" ON wishlist
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- admins table: completely locked, service_role only
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins accessible by service_role only" ON admins
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- coupons and coupon_usage: service role only
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coupons accessible by service_role only" ON coupons
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

ALTER TABLE coupon_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coupon usage accessible by service_role only" ON coupon_usage
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- loyalty_transactions: users see own, service_role full access
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own loyalty transactions" ON loyalty_transactions
  FOR SELECT USING (
    user_id::text = (current_setting('request.jwt.claims', true)::json->>'sub')
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
  );
CREATE POLICY "Loyalty transactions by service_role only" ON loyalty_transactions
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- daily_stats: service_role only
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Daily stats by service_role only" ON daily_stats
  FOR ALL USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
