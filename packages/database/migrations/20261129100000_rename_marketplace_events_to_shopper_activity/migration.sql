-- "marketplace_events" holds what a shopper does in the storefront (a store opened, an item added
-- to or removed from the cart or the wishlist). It is shopper activity, not a marketplace event, so
-- the table is named for what it holds.
ALTER TABLE "marketplace_events" RENAME TO "shopper_activity";

ALTER TABLE "shopper_activity"
  RENAME CONSTRAINT "marketplace_events_pkey" TO "shopper_activity_pkey";
ALTER TABLE "shopper_activity"
  RENAME CONSTRAINT "marketplace_events_event_type_check" TO "shopper_activity_event_type_check";
ALTER TABLE "shopper_activity"
  RENAME CONSTRAINT "marketplace_events_quantity_check" TO "shopper_activity_quantity_check";

ALTER INDEX "marketplace_events_vendor_id_event_type_created_at_idx"
  RENAME TO "shopper_activity_vendor_id_event_type_created_at_idx";
ALTER INDEX "marketplace_events_product_id_event_type_created_at_idx"
  RENAME TO "shopper_activity_product_id_event_type_created_at_idx";
ALTER INDEX "marketplace_events_cart_id_product_id_event_type_idx"
  RENAME TO "shopper_activity_cart_id_product_id_event_type_idx";
ALTER INDEX "marketplace_events_user_id_event_type_created_at_idx"
  RENAME TO "shopper_activity_user_id_event_type_created_at_idx";
ALTER INDEX "marketplace_events_visitor_id_event_type_created_at_idx"
  RENAME TO "shopper_activity_visitor_id_event_type_created_at_idx";
ALTER INDEX "marketplace_events_session_id_event_type_created_at_idx"
  RENAME TO "shopper_activity_session_id_event_type_created_at_idx";
ALTER INDEX "marketplace_events_created_at_idx"
  RENAME TO "shopper_activity_created_at_idx";

-- Rolling deploy: API instances still on the previous release read and write "marketplace_events".
-- A simple view keeps that working (inserts, selects and deletes go through to the table). Drop it
-- in the migration after the release that stops using the old name has fully rolled out.
CREATE VIEW "marketplace_events" AS SELECT * FROM "shopper_activity";
COMMENT ON VIEW "marketplace_events" IS
  'Temporary alias of shopper_activity for the previous release; drop after the rename has rolled out.';
