-- A stored rating summary on each product, kept up to date by review events, so showing the
-- rating no longer means summing every review each time the cache expires.
ALTER TABLE "products"
  ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rating_average" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "rating_breakdown" JSONB;

-- Fill it in for the reviews that already exist (active reviews only).
UPDATE "products" AS p
SET
  "rating_count" = s.total,
  "rating_average" = round(s.average::numeric, 1)::double precision,
  "rating_breakdown" = jsonb_build_object(
    '1', s.one, '2', s.two, '3', s.three, '4', s.four, '5', s.five
  )
FROM (
  SELECT
    "productId",
    count(*) AS total,
    avg("rating") AS average,
    count(*) FILTER (WHERE round("rating") <= 1) AS one,
    count(*) FILTER (WHERE round("rating") = 2) AS two,
    count(*) FILTER (WHERE round("rating") = 3) AS three,
    count(*) FILTER (WHERE round("rating") = 4) AS four,
    count(*) FILTER (WHERE round("rating") >= 5) AS five
  FROM "reviews"
  WHERE "isActive" = true
  GROUP BY "productId"
) AS s
WHERE p."id" = s."productId";
