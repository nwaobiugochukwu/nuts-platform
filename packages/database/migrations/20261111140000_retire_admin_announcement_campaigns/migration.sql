UPDATE "admin_announcements"
SET
  "status" = 'FAILED',
  "scheduled_at" = NULL,
  "processing_at" = NULL,
  "last_error" = 'Administrator campaign audiences have been retired. Edit the campaign and select customers or vendors before retrying.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "audience" = 'ADMINISTRATORS'
  AND "status" IN ('DRAFT', 'SCHEDULED', 'PUBLISHING');
