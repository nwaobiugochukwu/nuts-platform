CREATE TYPE "AnnouncementAudience" AS ENUM ('CUSTOMERS', 'ADMINISTRATORS');
CREATE TYPE "AnnouncementStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'ARCHIVED'
);

CREATE TABLE "admin_announcements" (
  "id" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "message" VARCHAR(2000) NOT NULL,
  "audience" "AnnouncementAudience" NOT NULL,
  "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
  "link" VARCHAR(500),
  "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduled_at" TIMESTAMP(3),
  "processing_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "recipient_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  "created_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_announcements_status_scheduled_at_idx"
  ON "admin_announcements"("status", "scheduled_at");
CREATE INDEX "admin_announcements_status_processing_at_idx"
  ON "admin_announcements"("status", "processing_at");
CREATE INDEX "admin_announcements_audience_created_at_idx"
  ON "admin_announcements"("audience", "created_at");
CREATE INDEX "admin_announcements_created_by_admin_id_created_at_idx"
  ON "admin_announcements"("created_by_admin_id", "created_at");

ALTER TABLE "admin_announcements"
  ADD CONSTRAINT "admin_announcements_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
