-- AlterTable
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
DROP INDEX IF EXISTS "notifications_userId_isRead_createdAt_idx";
CREATE INDEX IF NOT EXISTS "notifications_userId_role_isRead_createdAt_idx" ON "notifications"("userId", "role", "isRead", "createdAt");
