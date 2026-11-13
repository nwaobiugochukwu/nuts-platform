-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CategoryStatus') THEN
    CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  END IF;
END $$;

-- AlterTable categories: add sortOrder, status
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill status based on isActive
UPDATE "categories" 
SET "status" = CASE 
  WHEN "isActive" = true THEN 'ACTIVE'::"CategoryStatus" 
  ELSE 'INACTIVE'::"CategoryStatus" 
END
WHERE "status" IS NULL OR "status" = 'ACTIVE';

-- Make level nullable so future inserts without level succeed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'categories' AND column_name = 'level'
  ) THEN
    ALTER TABLE "categories" ALTER COLUMN "level" DROP NOT NULL;
  END IF;
END $$;

-- Drop obsolete indexes if present
DROP INDEX IF EXISTS "categories_level_isActive_idx";
DROP INDEX IF EXISTS "categories_category_type_isActive_idx";
DROP INDEX IF EXISTS "categories_isActive_parentId_depth_idx";

-- Create indexes for hierarchical performance
CREATE INDEX IF NOT EXISTS "categories_parentId_sortOrder_idx" ON "categories"("parentId", "sortOrder");
CREATE INDEX IF NOT EXISTS "categories_status_idx" ON "categories"("status");
