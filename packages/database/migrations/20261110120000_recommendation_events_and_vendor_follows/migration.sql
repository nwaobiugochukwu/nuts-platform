-- Durable attribution for recommendation impressions and downstream outcomes.
CREATE TABLE "recommendation_events" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "request_id" TEXT,
  "ranker_version" TEXT,
  "position" INTEGER,
  "product_id" TEXT,
  "vendor_id" TEXT,
  "category_id" TEXT,
  "user_id" TEXT,
  "session_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "recommendation_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_events_event_type_check"
    CHECK ("event_type" IN ('IMPRESSION', 'CLICK', 'CART_ADD', 'PURCHASE', 'DISMISS', 'FOLLOW', 'UNFOLLOW', 'PRODUCT_VIEW', 'SEARCH', 'CATEGORY_VIEW')),
  CONSTRAINT "recommendation_events_position_check"
    CHECK ("position" IS NULL OR "position" >= 0)
);

CREATE INDEX "recommendation_events_user_id_event_type_created_at_idx"
  ON "recommendation_events"("user_id", "event_type", "created_at");
CREATE INDEX "recommendation_events_session_id_event_type_created_at_idx"
  ON "recommendation_events"("session_id", "event_type", "created_at");
CREATE INDEX "recommendation_events_user_id_event_type_surface_created_at_idx"
  ON "recommendation_events"("user_id", "event_type", "surface", "created_at");
CREATE INDEX "recommendation_events_session_id_event_type_surface_created_at_idx"
  ON "recommendation_events"("session_id", "event_type", "surface", "created_at");
CREATE INDEX "recommendation_events_product_id_event_type_created_at_idx"
  ON "recommendation_events"("product_id", "event_type", "created_at");
CREATE INDEX "recommendation_events_vendor_id_event_type_created_at_idx"
  ON "recommendation_events"("vendor_id", "event_type", "created_at");
CREATE INDEX "recommendation_events_category_id_event_type_created_at_idx"
  ON "recommendation_events"("category_id", "event_type", "created_at");
CREATE INDEX "recommendation_events_request_id_event_type_idx"
  ON "recommendation_events"("request_id", "event_type");
CREATE INDEX "recommendation_events_created_at_idx"
  ON "recommendation_events"("created_at");

ALTER TABLE "recommendation_events"
  ADD CONSTRAINT "recommendation_events_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recommendation_events"
  ADD CONSTRAINT "recommendation_events_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recommendation_events"
  ADD CONSTRAINT "recommendation_events_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recommendation_events"
  ADD CONSTRAINT "recommendation_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "vendor_follows" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_follows_user_id_vendor_id_key"
  ON "vendor_follows"("user_id", "vendor_id");
CREATE INDEX "vendor_follows_user_id_created_at_idx"
  ON "vendor_follows"("user_id", "created_at");
CREATE INDEX "vendor_follows_vendor_id_created_at_idx"
  ON "vendor_follows"("vendor_id", "created_at");

ALTER TABLE "vendor_follows"
  ADD CONSTRAINT "vendor_follows_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_follows"
  ADD CONSTRAINT "vendor_follows_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cart_items" ADD COLUMN "recommendationContext" JSONB;
ALTER TABLE "order_items" ADD COLUMN "recommendationContext" JSONB;

ALTER TABLE "wishlist_items"
  ADD COLUMN "lastObservedPrice" DECIMAL(10,2),
  ADD COLUMN "lastObservedStock" INTEGER,
  ADD COLUMN "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "wishlist_items" AS wi
SET "lastObservedPrice" = p."price",
    "lastObservedStock" = CASE
      WHEN wi."variantId" IS NOT NULL THEN COALESCE((
        SELECT v."stock" FROM "product_variants" AS v WHERE v."id" = wi."variantId"
      ), 0)
      WHEN p."hasVariants" THEN COALESCE((
        SELECT SUM(v."stock")::INTEGER
        FROM "product_variants" AS v
        WHERE v."productId" = p."id" AND v."isActive" = TRUE AND v."isDeleted" = FALSE
      ), 0)
      ELSE p."stock"
    END
FROM "products" AS p
WHERE p."id" = wi."productId";

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRICE_DROP';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESTOCKED';

CREATE INDEX "search_queries_sessionId_createdAt_idx"
  ON "search_queries"("sessionId", "createdAt");
