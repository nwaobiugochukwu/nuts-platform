-- The "Not interested" action stores NOT_INTERESTED events, but the original check
-- constraint did not list that type, so every such request failed with code 23514.
ALTER TABLE "recommendation_events"
  DROP CONSTRAINT "recommendation_events_event_type_check";

ALTER TABLE "recommendation_events"
  ADD CONSTRAINT "recommendation_events_event_type_check"
  CHECK ("event_type" IN ('IMPRESSION', 'CLICK', 'CART_ADD', 'PURCHASE', 'DISMISS', 'FOLLOW', 'UNFOLLOW', 'PRODUCT_VIEW', 'SEARCH', 'CATEGORY_VIEW', 'NOT_INTERESTED'));
