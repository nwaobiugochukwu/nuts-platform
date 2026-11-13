UPDATE "admin_announcements"
SET
  "status" = 'DRAFT',
  "scheduled_at" = NULL,
  "processing_at" = NULL,
  "last_error" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "audience" = 'ADMINISTRATORS'
  AND "status" = 'FAILED'
  AND "last_error" LIKE 'Administrator campaign audiences have been retired.%';
