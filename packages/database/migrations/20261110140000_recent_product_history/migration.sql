CREATE TABLE "recent_product_views" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "visitor_id" TEXT,
  "product_id" TEXT NOT NULL,
  "last_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recent_product_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recent_product_views_owner_check"
    CHECK (("user_id" IS NOT NULL AND "visitor_id" IS NULL) OR
           ("user_id" IS NULL AND "visitor_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "recent_product_views_user_product_key"
  ON "recent_product_views"("user_id", "product_id");
CREATE UNIQUE INDEX "recent_product_views_visitor_product_key"
  ON "recent_product_views"("visitor_id", "product_id");
CREATE INDEX "recent_product_views_user_id_last_viewed_at_idx"
  ON "recent_product_views"("user_id", "last_viewed_at");
CREATE INDEX "recent_product_views_visitor_id_last_viewed_at_idx"
  ON "recent_product_views"("visitor_id", "last_viewed_at");

ALTER TABLE "recent_product_views"
  ADD CONSTRAINT "recent_product_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recent_product_views"
  ADD CONSTRAINT "recent_product_views_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
