-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN "applicableCategoryIds" TEXT[] NOT NULL DEFAULT '{}';
