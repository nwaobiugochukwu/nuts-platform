UPDATE "discount_codes"
SET "isActive" = false,
    "firstOrderOnly" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'WELCOME10'
  AND "description" = '10% off for first-time shoppers'
  AND "scope" = 'PLATFORM'
  AND "platformwide" = true
  AND "vendorId" IS NULL
  AND "deletedAt" IS NULL;
