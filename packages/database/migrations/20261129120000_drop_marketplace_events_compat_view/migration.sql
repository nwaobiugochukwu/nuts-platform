-- The rename to "shopper_activity" has rolled out, so the temporary view that let the previous
-- release keep using the old name is no longer needed.
DROP VIEW IF EXISTS "marketplace_events";
