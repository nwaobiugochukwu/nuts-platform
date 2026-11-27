-- A database built from the migrations still has the legacy CREATOR value in the
-- DiscountCodeScope enum (the creators-to-vendors rename added VENDOR but never removed
-- CREATOR), while schema.prisma and long-lived development databases do not.
-- Any leftover rows become VENDOR first, then the enum is rebuilt without CREATOR.
UPDATE "discount_codes" SET "scope" = 'VENDOR' WHERE "scope"::text = 'CREATOR';

CREATE TYPE "DiscountCodeScope_new" AS ENUM ('VENDOR', 'PLATFORM');
ALTER TABLE "discount_codes" ALTER COLUMN "scope" TYPE "DiscountCodeScope_new" USING ("scope"::text::"DiscountCodeScope_new");
ALTER TYPE "DiscountCodeScope" RENAME TO "DiscountCodeScope_old";
ALTER TYPE "DiscountCodeScope_new" RENAME TO "DiscountCodeScope";
DROP TYPE "public"."DiscountCodeScope_old";
