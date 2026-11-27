-- Aligns the database with schema.prisma after the creators-to-vendors rename.
--  * the ROLE enum loses the legacy CREATOR value (any leftover rows become VENDOR first)
--  * two indexes the schema declares but the database lacked are created
--  * legacy creators_* names (indexes, primary keys) are renamed to vendors_*
--  * two duplicate search indexes under the old creators_* names are dropped
-- The trigram search indexes stay: Prisma cannot declare them, so scripts/check-schema-drift.mjs allows them.

UPDATE "users" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';
UPDATE "admins" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';
UPDATE "notifications" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';
UPDATE "push_subscriptions" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';
UPDATE "notification_preferences" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';
UPDATE "account_auth_sessions" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';
UPDATE "refresh_rotation_receipts" SET "role" = 'VENDOR' WHERE "role"::text = 'CREATOR';

CREATE TYPE "ROLE_new" AS ENUM ('USER', 'ADMIN', 'VENDOR');
ALTER TABLE "public"."admins" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."notification_preferences" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."notifications" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."push_subscriptions" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "admins" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TABLE "users" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TABLE "account_auth_sessions" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TABLE "refresh_rotation_receipts" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TABLE "notifications" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TABLE "push_subscriptions" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TABLE "notification_preferences" ALTER COLUMN "role" TYPE "ROLE_new" USING ("role"::text::"ROLE_new");
ALTER TYPE "ROLE" RENAME TO "ROLE_old";
ALTER TYPE "ROLE_new" RENAME TO "ROLE";
DROP TYPE "public"."ROLE_old";
ALTER TABLE "admins" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
ALTER TABLE "notification_preferences" ALTER COLUMN "role" SET DEFAULT 'USER';
ALTER TABLE "notifications" ALTER COLUMN "role" SET DEFAULT 'USER';
ALTER TABLE "push_subscriptions" ALTER COLUMN "role" SET DEFAULT 'USER';
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

DROP INDEX "creators_store_description_trgm_idx";
DROP INDEX "creators_store_name_trgm_idx";
ALTER TABLE "vendor_wallets" RENAME CONSTRAINT "creator_wallets_pkey" TO "vendor_wallets_pkey";
ALTER TABLE "vendors" RENAME CONSTRAINT "creators_pkey" TO "vendors_pkey";
CREATE INDEX "outbox_events_status_attempts_createdAt_idx" ON "outbox_events"("status", "attempts", "createdAt");
CREATE INDEX "product_images_productId_position_idx" ON "product_images"("productId", "position");
ALTER INDEX "discount_codes_creatorId_isActive_scope_idx" RENAME TO "discount_codes_vendorId_isActive_scope_idx";
ALTER INDEX "order_status_history_changedByCreatorId_idx" RENAME TO "order_status_history_changedByVendorId_idx";
ALTER INDEX "recommendation_events_session_id_event_type_surface_created_at_" RENAME TO "recommendation_events_session_id_event_type_surface_created_idx";
ALTER INDEX "creators_isActive_isApproved_createdAt_idx" RENAME TO "vendors_isActive_isApproved_createdAt_idx";
ALTER INDEX "creators_isActive_isApproved_idx" RENAME TO "vendors_isActive_isApproved_idx";
ALTER INDEX "creators_isActive_isApproved_storeName_idx" RENAME TO "vendors_isActive_isApproved_storeName_idx";
ALTER INDEX "creators_isActive_isVerified_createdAt_idx" RENAME TO "vendors_isActive_isVerified_createdAt_idx";
