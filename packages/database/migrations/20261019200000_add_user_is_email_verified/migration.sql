-- AlterTable: Add column with default true to backfill all existing registered users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: Switch default to false so all future incoming accounts default to unverified until OTP confirmation
ALTER TABLE "users" ALTER COLUMN "isEmailVerified" SET DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_isEmailVerified_idx" ON "users"("isEmailVerified");
