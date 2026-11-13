-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_slug_isActive_isDeleted_idx" ON "products"("slug", "isActive", "isDeleted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_categoryId_isActive_isDeleted_price_idx" ON "products"("categoryId", "isActive", "isDeleted", "price");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "categories_status_isActive_sortOrder_idx" ON "categories"("status", "isActive", "sortOrder");
