CREATE TABLE IF NOT EXISTS promotional_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('story', 'banner')),
  title_uz TEXT NOT NULL DEFAULT '',
  title_ru TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  subtitle_uz TEXT NOT NULL DEFAULT '',
  subtitle_ru TEXT NOT NULL DEFAULT '',
  subtitle_en TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  link_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotional_content_public_order
  ON promotional_content (kind, is_active, sort_order);

ALTER TABLE promotional_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active promotions" ON promotional_content;
CREATE POLICY "Public can read active promotions"
  ON promotional_content FOR SELECT
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Service role manages promotions" ON promotional_content;
CREATE POLICY "Service role manages promotions"
  ON promotional_content FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION set_promotional_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS promotional_content_updated_at ON promotional_content;
CREATE TRIGGER promotional_content_updated_at
  BEFORE UPDATE ON promotional_content
  FOR EACH ROW EXECUTE FUNCTION set_promotional_content_updated_at();
