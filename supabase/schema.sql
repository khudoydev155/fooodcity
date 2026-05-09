-- USERS
CREATE TABLE users (
  id BIGINT PRIMARY KEY,           -- Telegram user_id
  username TEXT,
  full_name TEXT NOT NULL,
  language TEXT DEFAULT 'uz',      -- uz | ru | en
  phone TEXT,
  is_blocked BOOLEAN DEFAULT FALSE,
  loyalty_points INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- ROLES
CREATE TABLE admins (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','staff')),
  added_by BIGINT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- CATEGORIES
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_uz TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MENU ITEMS
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name_uz TEXT NOT NULL,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_uz TEXT,
  description_ru TEXT,
  description_en TEXT,
  price INTEGER NOT NULL,          -- in UZS (tiyin emas)
  image_url TEXT,                  -- Supabase Storage public URL
  emoji TEXT DEFAULT '🍽',
  badge TEXT,                      -- "🔥 Hit", "⭐ New" etc
  is_available BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  total_ordered INTEGER DEFAULT 0, -- analytics: how many times ordered
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ORDERS
CREATE TABLE orders (
  id TEXT PRIMARY KEY,             -- #XXXX format
  user_id BIGINT REFERENCES users(id),
  items JSONB NOT NULL,            -- [{id, name, qty, price, image_url}]
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER DEFAULT 15000,
  discount INTEGER DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT DEFAULT 'new'
    CHECK (status IN ('new','confirmed','cooking','delivering','delivered','cancelled')),
  delivery_address TEXT,
  location JSONB,                  -- {lat, lon}
  note TEXT,
  coupon_code TEXT,
  loyalty_points_used INTEGER DEFAULT 0,
  loyalty_points_earned INTEGER DEFAULT 0,
  language TEXT DEFAULT 'uz',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- COUPONS
CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT CHECK (discount_type IN ('percent','fixed')),
  discount_value INTEGER NOT NULL,
  min_order_amount INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- COUPON USAGE (prevent double use)
CREATE TABLE coupon_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID REFERENCES coupons(id),
  user_id BIGINT REFERENCES users(id),
  order_id TEXT REFERENCES orders(id),
  used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coupon_id, user_id)       -- 1 user = 1 use per coupon
);

-- WISHLIST
CREATE TABLE wishlist (
  user_id BIGINT REFERENCES users(id),
  item_id UUID REFERENCES menu_items(id),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, item_id)
);

-- LOYALTY TRANSACTIONS
CREATE TABLE loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES users(id),
  order_id TEXT REFERENCES orders(id),
  points INTEGER NOT NULL,         -- positive = earned, negative = spent
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DAILY STATS (pre-aggregated for speed)
CREATE TABLE daily_stats (
  date DATE PRIMARY KEY,
  total_orders INTEGER DEFAULT 0,
  cancelled_orders INTEGER DEFAULT 0,
  total_revenue INTEGER DEFAULT 0,
  avg_order_value INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  loyalty_points_issued INTEGER DEFAULT 0
);

-- INDEXES for performance
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_menu_items_available ON menu_items(is_available);
CREATE INDEX idx_loyalty_user ON loyalty_transactions(user_id);

-- AUTO update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_menu_updated BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
