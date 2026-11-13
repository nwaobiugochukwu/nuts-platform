ALTER TABLE "product_views"
  ADD COLUMN "visitor_id" TEXT;

CREATE INDEX "product_views_visitor_id_created_at_idx"
  ON "product_views"("visitor_id", "createdAt");

CREATE TABLE "marketplace_events" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "vendor_id" TEXT,
  "product_id" TEXT,
  "variant_id" TEXT,
  "category_id" TEXT,
  "user_id" TEXT,
  "visitor_id" TEXT,
  "session_id" TEXT,
  "cart_id" TEXT,
  "quantity" INTEGER,
  "surface" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketplace_events_event_type_check"
    CHECK ("event_type" IN (
      'STORE_VIEW',
      'CART_ADD',
      'CART_REMOVE',
      'WISHLIST_ADD',
      'WISHLIST_REMOVE'
    )),
  CONSTRAINT "marketplace_events_quantity_check"
    CHECK ("quantity" IS NULL OR "quantity" > 0)
);

CREATE INDEX "marketplace_events_vendor_id_event_type_created_at_idx"
  ON "marketplace_events"("vendor_id", "event_type", "created_at");
CREATE INDEX "marketplace_events_product_id_event_type_created_at_idx"
  ON "marketplace_events"("product_id", "event_type", "created_at");
CREATE INDEX "marketplace_events_cart_id_product_id_event_type_idx"
  ON "marketplace_events"("cart_id", "product_id", "event_type");
CREATE INDEX "marketplace_events_user_id_event_type_created_at_idx"
  ON "marketplace_events"("user_id", "event_type", "created_at");
CREATE INDEX "marketplace_events_visitor_id_event_type_created_at_idx"
  ON "marketplace_events"("visitor_id", "event_type", "created_at");
CREATE INDEX "marketplace_events_session_id_event_type_created_at_idx"
  ON "marketplace_events"("session_id", "event_type", "created_at");
CREATE INDEX "marketplace_events_created_at_idx"
  ON "marketplace_events"("created_at");
