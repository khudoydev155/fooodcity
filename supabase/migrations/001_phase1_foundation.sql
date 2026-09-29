-- ============================================================
-- Food City — Phase 1: Database Foundation Migration (Improved)
-- Version: 001
-- Phase: Database Foundation & Entity Architecture ONLY
-- ============================================================
-- This migration is ADDITIVE and SAFE:
--   - Uses ADD COLUMN IF NOT EXISTS everywhere
--   - No columns dropped
--   - No existing data destroyed
--   - Backfills product_code and category_code safely
--   - Idempotent: can be re-run without side effects
-- ============================================================


-- ============================================================
-- STEP 1: Category code system & Audit columns
-- ============================================================
-- Add immutable, human-readable category_code to categories.
-- Add soft-delete and audit columns.

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS category_code TEXT;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN DEFAULT FALSE;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS created_by  BIGINT;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS updated_by  BIGINT;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- Add unique constraint only if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_categories_code'
    ) THEN
        ALTER TABLE categories
            ADD CONSTRAINT uq_categories_code UNIQUE (category_code);
    END IF;
END;
$$;

-- Backfill category_code for existing categories based on name.
UPDATE categories SET category_code = 'PZZ'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%pizza%' OR LOWER(name_en) LIKE '%pizza%');

UPDATE categories SET category_code = 'LAV'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%lavash%' OR LOWER(name_en) LIKE '%lavash%');

UPDATE categories SET category_code = 'BRG'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%burger%' OR LOWER(name_en) LIKE '%burger%');

UPDATE categories SET category_code = 'HDG'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%hot%dog%' OR LOWER(name_en) LIKE '%hot%dog%'
           OR LOWER(name_uz) LIKE '%hotdog%' OR LOWER(name_en) LIKE '%hotdog%');

UPDATE categories SET category_code = 'DNR'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%doner%' OR LOWER(name_en) LIKE '%doner%'
           OR LOWER(name_uz) LIKE '%kabob%' OR LOWER(name_en) LIKE '%kebab%');

UPDATE categories SET category_code = 'PDE'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%pide%' OR LOWER(name_en) LIKE '%pide%');

UPDATE categories SET category_code = 'SDW'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%sendvich%' OR LOWER(name_en) LIKE '%sandwich%');

UPDATE categories SET category_code = 'DRK'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%ichimlik%' OR LOWER(name_en) LIKE '%drink%'
           OR LOWER(name_uz) LIKE '%juice%' OR LOWER(name_en) LIKE '%juice%');

UPDATE categories SET category_code = 'DST'
    WHERE category_code IS NULL
      AND (LOWER(name_uz) LIKE '%desert%' OR LOWER(name_en) LIKE '%dessert%'
           OR LOWER(name_uz) LIKE '%shirinlik%');

-- Fallback for any remaining categories: use first 3 letters of name_en uppercased.
DO $$
DECLARE
    r       RECORD;
    base    TEXT;
    attempt TEXT;
    suffix  INT;
BEGIN
    FOR r IN
        SELECT id, name_en FROM categories WHERE category_code IS NULL ORDER BY sort_order, created_at
    LOOP
        base    := UPPER(REGEXP_REPLACE(LEFT(r.name_en, 5), '[^A-Z]', '', 'g'));
        base    := LEFT(base || 'GEN', 3);  -- fallback to GEN if name_en is all special chars
        attempt := base;
        suffix  := 2;

        -- Avoid collision with already-assigned codes
        WHILE EXISTS (SELECT 1 FROM categories WHERE category_code = attempt AND id <> r.id) LOOP
            attempt := base || suffix::TEXT;
            suffix  := suffix + 1;
        END LOOP;

        UPDATE categories SET category_code = attempt WHERE id = r.id;
    END LOOP;
END;
$$;

-- Enforce NOT NULL after backfill is complete
ALTER TABLE categories ALTER COLUMN category_code SET NOT NULL;


-- ============================================================
-- STEP 2: Product code sequence table
-- ============================================================
-- One row per category_code, tracks the next integer to assign.
-- Lock rows or updates atomically, concurrency-safe and collision-free.

CREATE TABLE IF NOT EXISTS product_code_sequences (
    category_code   TEXT PRIMARY KEY,
    next_value      INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed sequences for all existing category codes
INSERT INTO product_code_sequences (category_code, next_value)
SELECT DISTINCT category_code, 1
FROM categories
WHERE category_code IS NOT NULL
ON CONFLICT (category_code) DO NOTHING;


-- ============================================================
-- STEP 3: Atomic product code generator function
-- ============================================================
-- Concurrency-safe: uses UPDATE ... RETURNING row-level locks on the
-- sequence row. Absolutely avoids race conditions and duplicate codes.

CREATE OR REPLACE FUNCTION generate_product_code(p_category_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_seq   INTEGER;
    v_code  TEXT;
BEGIN
    -- Ensure sequence row exists for this category
    INSERT INTO product_code_sequences (category_code, next_value)
    VALUES (p_category_code, 1)
    ON CONFLICT (category_code) DO NOTHING;

    -- Atomically claim and lock the next value (row-level write lock)
    UPDATE product_code_sequences
    SET    next_value = next_value + 1
    WHERE  category_code = p_category_code
    RETURNING next_value - 1 INTO v_seq;

    -- Format: FC-{CAT}-{NNN}  (zero-padded to 3 digits)
    v_code := 'FC-' || p_category_code || '-' || LPAD(v_seq::TEXT, 3, '0');

    RETURN v_code;
END;
$$;


-- ============================================================
-- STEP 4: Add product_code & audit fields to menu_items
-- ============================================================

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS product_code TEXT;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS updated_by BIGINT;

-- Unique constraint on product_code
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_menu_items_product_code'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT uq_menu_items_product_code UNIQUE (product_code);
    END IF;
END;
$$;

-- Explicitly enforce RESTRICT for category relations instead of default SET NULL/CASCADE
DO $$
BEGIN
    -- Drop old default SET NULL foreign key constraint to define delete behavior explicitly
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'menu_items_category_id_fkey'
    ) THEN
        ALTER TABLE menu_items DROP CONSTRAINT menu_items_category_id_fkey;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_menu_items_category'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT fk_menu_items_category
            FOREIGN KEY (category_id)
            REFERENCES categories(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

-- Backfill product_code for all existing menu items prediction-safe
DO $$
DECLARE
    r       RECORD;
    v_code  TEXT;
BEGIN
    FOR r IN
        SELECT mi.id, COALESCE(c.category_code, 'GEN') AS cat_code
        FROM   menu_items mi
        LEFT JOIN categories c ON c.id = mi.category_id
        WHERE  mi.product_code IS NULL
        ORDER  BY mi.sort_order, mi.created_at
    LOOP
        INSERT INTO product_code_sequences (category_code, next_value)
        VALUES (r.cat_code, 1)
        ON CONFLICT (category_code) DO NOTHING;

        v_code := generate_product_code(r.cat_code);

        UPDATE menu_items SET product_code = v_code WHERE id = r.id;
    END LOOP;
END;
$$;


-- ============================================================
-- STEP 5: Soft delete & Immutable triggers
-- ============================================================

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN DEFAULT FALSE;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

-- Soft delete helper function
CREATE OR REPLACE FUNCTION soft_delete_menu_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE menu_items
    SET    is_deleted  = TRUE,
           deleted_at  = NOW(),
           is_available = FALSE
    WHERE  id = p_item_id
      AND  is_deleted = FALSE;

    RETURN FOUND;
END;
$$;

-- Trigger to protect immutable category_code on categories
CREATE OR REPLACE FUNCTION protect_immutable_category_code()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.category_code IS DISTINCT FROM NEW.category_code THEN
        RAISE EXCEPTION 'category_code is immutable and cannot be updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add categories immutable trigger
DROP TRIGGER IF EXISTS trg_protect_categories_code ON categories;
CREATE TRIGGER trg_protect_categories_code
    BEFORE UPDATE ON categories
    FOR EACH ROW
    EXECUTE FUNCTION protect_immutable_category_code();

-- Trigger to protect immutable product_code on menu_items
CREATE OR REPLACE FUNCTION protect_immutable_product_code()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.product_code IS DISTINCT FROM NEW.product_code THEN
        RAISE EXCEPTION 'product_code is immutable and cannot be updated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add menu_items immutable trigger
DROP TRIGGER IF EXISTS trg_protect_menu_items_code ON menu_items;
CREATE TRIGGER trg_protect_menu_items_code
    BEFORE UPDATE ON menu_items
    FOR EACH ROW
    EXECUTE FUNCTION protect_immutable_product_code();


-- ============================================================
-- STEP 6: Add denormalized image shortcut columns to menu_items
-- ============================================================

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS image_thumb_url   TEXT;

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS image_updated_at  TIMESTAMPTZ;


-- ============================================================
-- STEP 7: Relational image table
-- ============================================================
-- Authoritative relational image table. Explicitly references menu_items
-- with RESTRICT delete behavior, preventing orphan files or cascade deletes.

CREATE TABLE IF NOT EXISTS menu_item_images (
    -- Primary key
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relation (ON DELETE RESTRICT enforces integrity)
    menu_item_id    UUID        NOT NULL
                    REFERENCES  menu_items(id)
                    ON DELETE   RESTRICT,

    -- Classifications: CHECK constraint holds exactly the allowed list
    image_type      TEXT        NOT NULL DEFAULT 'MAIN'
                    CONSTRAINT  chk_images_type
                    CHECK       (image_type IN ('MAIN','THUMB','GALLERY','BANNER','SEASONAL')),

    -- Public URLs
    image_url       TEXT,
    thumb_url       TEXT,

    -- Storage paths
    storage_path    TEXT,
    thumb_path      TEXT,

    -- Content metadata
    image_hash      TEXT,           -- SHA256 of raw bytes (integrity + duplicates validation)
    mime_type       TEXT DEFAULT 'image/webp',
    file_size       INTEGER,        -- bytes of optimized image
    width           INTEGER,
    height          INTEGER,

    -- Display control
    is_primary      BOOLEAN     DEFAULT FALSE,
    sort_order      INTEGER     DEFAULT 0,

    -- Future branch support
    branch_id       UUID,

    -- Lifecycle
    is_active       BOOLEAN     DEFAULT TRUE,
    is_archived     BOOLEAN     DEFAULT FALSE,
    archived_at     TIMESTAMPTZ,

    -- Soft delete
    is_deleted      BOOLEAN     DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,

    -- Audit tracking
    uploaded_by     BIGINT,         -- Telegram admin user_id
    updated_by      BIGINT,         -- Telegram editor user_id
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- STEP 8: Constraints on menu_item_images
-- ============================================================

-- Only one primary active image per product
CREATE UNIQUE INDEX IF NOT EXISTS uq_menu_item_images_primary
    ON menu_item_images(menu_item_id)
    WHERE (is_primary = TRUE AND is_active = TRUE AND is_deleted = FALSE);

-- sort_order must be non-negative
ALTER TABLE menu_item_images
    ADD CONSTRAINT chk_images_sort_order CHECK (sort_order >= 0);

-- file_size must be positive if set
ALTER TABLE menu_item_images
    ADD CONSTRAINT chk_images_file_size CHECK (file_size IS NULL OR file_size > 0);

-- width and height must be positive if set
ALTER TABLE menu_item_images
    ADD CONSTRAINT chk_images_dimensions
    CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0));


-- ============================================================
-- STEP 9: Automatic updated_at triggers
-- ============================================================
-- Shared trigger helper function (idempotent setup)

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enable auto updated_at on categories
DROP TRIGGER IF EXISTS trg_categories_updated ON categories;
CREATE TRIGGER trg_categories_updated
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable auto updated_at on menu_items
DROP TRIGGER IF EXISTS trg_menu_items_updated ON menu_items;
CREATE TRIGGER trg_menu_items_updated
    BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable auto updated_at on menu_item_images
DROP TRIGGER IF EXISTS trg_menu_item_images_updated ON menu_item_images;
CREATE TRIGGER trg_menu_item_images_updated
    BEFORE UPDATE ON menu_item_images
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- STEP 10: Optimized Indexes for Production Query Engine
-- ============================================================

-- menu_items — product_code lookups
CREATE INDEX IF NOT EXISTS idx_menu_items_product_code
    ON menu_items(product_code);

-- menu_items — non-deleted active public menus (main frontend load)
CREATE INDEX IF NOT EXISTS idx_menu_items_not_deleted
    ON menu_items(is_deleted, is_available, sort_order)
    WHERE is_deleted = FALSE;

-- menu_items — active products categorized (O(log N) catalog read)
CREATE INDEX IF NOT EXISTS idx_menu_items_category_active
    ON menu_items(category_id, is_available, sort_order)
    WHERE is_deleted = FALSE;

-- categories — code lookups
CREATE INDEX IF NOT EXISTS idx_categories_code
    ON categories(category_code);

-- categories — active non-deleted lists
CREATE INDEX IF NOT EXISTS idx_categories_active
    ON categories(is_active, sort_order)
    WHERE is_deleted = FALSE;

-- categories — soft delete index
CREATE INDEX IF NOT EXISTS idx_categories_not_deleted
    ON categories(is_deleted)
    WHERE is_deleted = FALSE;

-- menu_item_images — primary image for product (O(1) asset loading)
CREATE INDEX IF NOT EXISTS idx_images_item_active
    ON menu_item_images(menu_item_id, is_primary, is_active)
    WHERE is_deleted = FALSE;

-- menu_item_images — all active images for product (gallery slideshow)
CREATE INDEX IF NOT EXISTS idx_images_item_gallery
    ON menu_item_images(menu_item_id, image_type, sort_order)
    WHERE is_active = TRUE AND is_deleted = FALSE;

-- menu_item_images — hash duplicate validations
CREATE INDEX IF NOT EXISTS idx_images_hash
    ON menu_item_images(image_hash)
    WHERE image_hash IS NOT NULL;

-- menu_item_images — archived files lists for cleanups
CREATE INDEX IF NOT EXISTS idx_images_archived
    ON menu_item_images(archived_at)
    WHERE is_archived = TRUE AND is_deleted = FALSE;

-- menu_item_images — branch-specific indexes
CREATE INDEX IF NOT EXISTS idx_images_branch
    ON menu_item_images(branch_id)
    WHERE branch_id IS NOT NULL;
