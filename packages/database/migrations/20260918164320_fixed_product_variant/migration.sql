/*
  Warnings:

  - A unique constraint covering the columns `[productId,optionsKey]` on the table `product_variants` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `optionsKey` to the `product_variants` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "optionsKey" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "product_variants_productId_isDeleted_isActive_idx" ON "product_variants"("productId", "isDeleted", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_optionsKey_key" ON "product_variants"("productId", "optionsKey");
