-- Enable PostgreSQL trigram search support.
-- This must be part of the database migration, not application startup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Products
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
ON products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_sku_trgm_idx
ON products USING GIN (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_description_trgm_idx
ON products USING GIN (description gin_trgm_ops);

-- Creators / Vendors
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'creators') THEN
    CREATE INDEX IF NOT EXISTS creators_store_name_trgm_idx ON creators USING GIN ("storeName" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS creators_store_description_trgm_idx ON creators USING GIN ("storeDescription" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS creators_first_name_trgm_idx ON creators USING GIN ("firstName" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS creators_last_name_trgm_idx ON creators USING GIN ("lastName" gin_trgm_ops);
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendors') THEN
    CREATE INDEX IF NOT EXISTS vendors_store_name_trgm_idx ON vendors USING GIN ("storeName" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS vendors_store_description_trgm_idx ON vendors USING GIN ("storeDescription" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS vendors_first_name_trgm_idx ON vendors USING GIN ("firstName" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS vendors_last_name_trgm_idx ON vendors USING GIN ("lastName" gin_trgm_ops);
  END IF;
END $$;

-- Categories
CREATE INDEX IF NOT EXISTS categories_name_trgm_idx
ON categories USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS categories_description_trgm_idx
ON categories USING GIN (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS categories_slug_trgm_idx
ON categories USING GIN (slug gin_trgm_ops);

-- Users
CREATE INDEX IF NOT EXISTS users_email_trgm_idx
ON users USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_first_name_trgm_idx
ON users USING GIN ("firstName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_last_name_trgm_idx
ON users USING GIN ("lastName" gin_trgm_ops);

-- Orders
CREATE INDEX IF NOT EXISTS orders_order_number_trgm_idx
ON orders USING GIN ("orderNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_discount_code_trgm_idx
ON orders USING GIN ("discountCode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_referral_code_trgm_idx
ON orders USING GIN ("referralCode" gin_trgm_ops);

-- Discount codes
CREATE INDEX IF NOT EXISTS discount_codes_code_trgm_idx
ON discount_codes USING GIN (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS discount_codes_description_trgm_idx
ON discount_codes USING GIN (description gin_trgm_ops);