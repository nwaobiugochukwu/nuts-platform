-- 1. Enums
ALTER TYPE "ROLE" ADD VALUE IF NOT EXISTS 'VENDOR';
ALTER TYPE "DiscountCodeScope" ADD VALUE IF NOT EXISTS 'VENDOR';

-- 2. Drop legacy foreign keys
ALTER TABLE IF EXISTS "products" DROP CONSTRAINT IF EXISTS "products_creatorId_fkey";
ALTER TABLE IF EXISTS "order_items" DROP CONSTRAINT IF EXISTS "order_items_creatorId_fkey";
ALTER TABLE IF EXISTS "order_status_history" DROP CONSTRAINT IF EXISTS "order_status_history_changedByCreatorId_fkey";
ALTER TABLE IF EXISTS "discount_codes" DROP CONSTRAINT IF EXISTS "discount_codes_creatorId_fkey";
ALTER TABLE IF EXISTS "creator_wallets" DROP CONSTRAINT IF EXISTS "creator_wallets_creatorId_fkey";
ALTER TABLE IF EXISTS "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_creator_wallet_id_fkey";

-- 3. Rename tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'creators') AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendors') THEN
    ALTER TABLE "creators" RENAME TO "vendors";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'creator_wallets') AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vendor_wallets') THEN
    ALTER TABLE "creator_wallets" RENAME TO "vendor_wallets";
  END IF;
END $$;

-- 4. Rename columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'creatorId') THEN
    ALTER TABLE "products" RENAME COLUMN "creatorId" TO "vendorId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'creatorId') THEN
    ALTER TABLE "order_items" RENAME COLUMN "creatorId" TO "vendorId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'discount_codes' AND column_name = 'creatorId') THEN
    ALTER TABLE "discount_codes" RENAME COLUMN "creatorId" TO "vendorId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_status_history' AND column_name = 'changedByCreatorId') THEN
    ALTER TABLE "order_status_history" RENAME COLUMN "changedByCreatorId" TO "changedByVendorId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_wallets' AND column_name = 'creatorId') THEN
    ALTER TABLE "vendor_wallets" RENAME COLUMN "creatorId" TO "vendorId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'creator_wallet_id') THEN
    ALTER TABLE "wallet_transactions" RENAME COLUMN "creator_wallet_id" TO "vendor_wallet_id";
  END IF;
END $$;

-- 5. Add foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'products_vendorId_fkey') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'order_items_vendorId_fkey') THEN
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'order_status_history_changedByVendorId_fkey') THEN
    ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changedByVendorId_fkey" FOREIGN KEY ("changedByVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'discount_codes_vendorId_fkey') THEN
    ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'vendor_wallets_vendorId_fkey') THEN
    ALTER TABLE "vendor_wallets" ADD CONSTRAINT "vendor_wallets_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'wallet_transactions_vendor_wallet_id_fkey') THEN
    ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_vendor_wallet_id_fkey" FOREIGN KEY ("vendor_wallet_id") REFERENCES "vendor_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Update indexes
DROP INDEX IF EXISTS "creators_email_key";
DROP INDEX IF EXISTS "creators_storeSlug_key";
DROP INDEX IF EXISTS "creators_isActive_idx";
DROP INDEX IF EXISTS "creators_isApproved_idx";
DROP INDEX IF EXISTS "creators_storeName_idx";
DROP INDEX IF EXISTS "creator_wallets_creatorId_key";
DROP INDEX IF EXISTS "products_creatorId_idx";
DROP INDEX IF EXISTS "order_items_creatorId_orderId_idx";
DROP INDEX IF EXISTS "wallet_transactions_creator_wallet_id_createdAt_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "vendors_email_key" ON "vendors"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_storeSlug_key" ON "vendors"("storeSlug");
CREATE INDEX IF NOT EXISTS "vendors_isActive_idx" ON "vendors"("isActive");
CREATE INDEX IF NOT EXISTS "vendors_isApproved_idx" ON "vendors"("isApproved");
CREATE INDEX IF NOT EXISTS "vendors_storeName_idx" ON "vendors"("storeName");
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_wallets_vendorId_key" ON "vendor_wallets"("vendorId");
CREATE INDEX IF NOT EXISTS "products_vendorId_isActive_isDeleted_createdAt_idx" ON "products"("vendorId", "isActive", "isDeleted", "createdAt");
CREATE INDEX IF NOT EXISTS "products_vendorId_categoryId_isActive_idx" ON "products"("vendorId", "categoryId", "isActive");
CREATE INDEX IF NOT EXISTS "order_items_vendorId_orderId_idx" ON "order_items"("vendorId", "orderId");
CREATE INDEX IF NOT EXISTS "wallet_transactions_vendor_wallet_id_createdAt_idx" ON "wallet_transactions"("vendor_wallet_id", "createdAt");
