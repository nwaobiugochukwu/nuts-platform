-- Automatic discounts: applied when the cart qualifies, with no code and no claim.
-- Purely additive: every existing code keeps autoApply = false and minQuantity = NULL,
-- so behaviour is unchanged until a creator opts in.

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN "autoApply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "discount_codes" ADD COLUMN "minQuantity" INTEGER;

-- CreateIndex
CREATE INDEX "discount_codes_autoApply_isActive_idx" ON "discount_codes"("autoApply", "isActive");
