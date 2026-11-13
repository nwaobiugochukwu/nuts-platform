-- AlterTable: categories - drop legacy category_type, depth, and level
ALTER TABLE "categories" DROP COLUMN IF EXISTS "category_type";
ALTER TABLE "categories" DROP COLUMN IF EXISTS "depth";
ALTER TABLE "categories" DROP COLUMN IF EXISTS "level";

-- DropEnum
DROP TYPE IF EXISTS "CategoryType";

-- AlterTable: categories - add hierarchical path and index
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "path" TEXT;
CREATE INDEX IF NOT EXISTS "categories_path_idx" ON "categories"("path");
