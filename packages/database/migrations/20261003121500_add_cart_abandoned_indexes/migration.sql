-- CreateIndex
CREATE INDEX IF NOT EXISTS "carts_checkedOut_abandonedCartAlerted_updatedAt_idx" ON "carts"("checkedOut", "abandonedCartAlerted", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "carts_checkedOut_updatedAt_idx" ON "carts"("checkedOut", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cart_items_cartId_idx" ON "cart_items"("cartId");
