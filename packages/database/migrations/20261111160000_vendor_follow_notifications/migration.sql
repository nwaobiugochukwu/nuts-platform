ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_FOLLOWED';

ALTER TABLE "notification_preferences"
ADD COLUMN "socialUpdates" BOOLEAN NOT NULL DEFAULT true;
