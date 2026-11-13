/*
  Warnings:

  - You are about to alter the column `code` on the `discount_codes` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - You are about to alter the column `description` on the `discount_codes` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - Made the column `minOrderAmount` on table `discount_codes` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "discount_code_usages" DROP CONSTRAINT "discount_code_usages_discountCodeId_fkey";

-- DropForeignKey
ALTER TABLE "discount_code_usages" DROP CONSTRAINT "discount_code_usages_orderId_fkey";

-- DropForeignKey
ALTER TABLE "discount_code_usages" DROP CONSTRAINT "discount_code_usages_userId_fkey";

-- DropForeignKey
ALTER TABLE "discount_codes" DROP CONSTRAINT "discount_codes_creatorId_fkey";

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "perUserUsageLimit" INTEGER,
ALTER COLUMN "code" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "description" SET DATA TYPE VARCHAR(500),
ALTER COLUMN "minOrderAmount" SET NOT NULL,
ALTER COLUMN "applicableProductIds" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "scope" DROP DEFAULT;

-- CreateTable
CREATE TABLE "discount_code_user_usage" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_code_user_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_code_user_usage_userId_discountCodeId_idx" ON "discount_code_user_usage"("userId", "discountCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_user_usage_discountCodeId_userId_key" ON "discount_code_user_usage"("discountCodeId", "userId");

-- CreateIndex
CREATE INDEX "discount_code_usages_orderId_idx" ON "discount_code_usages"("orderId");

-- CreateIndex
CREATE INDEX "discount_codes_expiresAt_isActive_idx" ON "discount_codes"("expiresAt", "isActive");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_usages" ADD CONSTRAINT "discount_code_usages_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_usages" ADD CONSTRAINT "discount_code_usages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_usages" ADD CONSTRAINT "discount_code_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_user_usage" ADD CONSTRAINT "discount_code_user_usage_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_user_usage" ADD CONSTRAINT "discount_code_user_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
