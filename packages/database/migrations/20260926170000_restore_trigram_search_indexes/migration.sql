-- Restore substring-search indexes removed by the historical search-index
-- migration. Prisma's case-insensitive `contains` filters compile to ILIKE,
-- which these trigram indexes accelerate on PostgreSQL.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS creators_store_name_trgm_idx
ON creators USING GIN ("storeName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS creators_store_description_trgm_idx
ON creators USING GIN ("storeDescription" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
ON products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_sku_trgm_idx
ON products USING GIN (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_description_trgm_idx
ON products USING GIN (description gin_trgm_ops);
