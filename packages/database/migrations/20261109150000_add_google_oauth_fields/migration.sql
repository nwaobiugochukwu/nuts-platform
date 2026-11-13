-- AlterTable users: make password optional, add Google OAuth fields
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "users" ADD COLUMN "avatarUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- AlterTable vendors: make password optional, add Google OAuth fields
ALTER TABLE "vendors" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "vendors" ADD COLUMN "googleId" TEXT;
ALTER TABLE "vendors" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "vendors" ADD COLUMN "avatarUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "vendors_googleId_key" ON "vendors"("googleId");

