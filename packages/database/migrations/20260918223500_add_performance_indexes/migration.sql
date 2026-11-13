-- CreateIndex
CREATE INDEX IF NOT EXISTS "carts_userId_checkedOut_createdAt_idx" ON "carts"("userId", "checkedOut", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "carts_createdAt_idx" ON "carts"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wishlist_items_userId_createdAt_idx" ON "wishlist_items"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_views_createdAt_idx" ON "product_views"("createdAt");
