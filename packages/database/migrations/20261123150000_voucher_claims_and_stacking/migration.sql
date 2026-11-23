-- Voucher claims (server-side, with reservation) and combinable ("stackable") codes.
-- Purely additive: existing codes default to stackable = false, so behaviour is unchanged.

-- CreateEnum
CREATE TYPE "DiscountClaimStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'RELEASED');

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN "stackable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "discount_code_claims" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DiscountClaimStatus" NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_code_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_code_claims_discountCodeId_userId_key" ON "discount_code_claims"("discountCodeId", "userId");

-- CreateIndex
CREATE INDEX "discount_code_claims_userId_status_expiresAt_idx" ON "discount_code_claims"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "discount_code_claims_discountCodeId_status_expiresAt_idx" ON "discount_code_claims"("discountCodeId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "discount_code_claims" ADD CONSTRAINT "discount_code_claims_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "discount_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_code_claims" ADD CONSTRAINT "discount_code_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
