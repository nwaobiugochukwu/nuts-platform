"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { cartService } from "@/api/cart";
import type { CartResponseDto } from "@/api/dto/cart";
import type { CategoryResponseDto } from "@/api/dto/category";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { useCart } from "@/hook/use-cart";
import { formatPrice } from "@/lib/util";
import { getApiErrorMessage } from "@/lib/api-error";
import { useDiscountStore } from "@/zustand/discount";
import {
ArrowRight,
Loader2,
Minus,
Plus,
ShoppingBag,
Tag,
Trash2,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";
import { toast } from "sonner";

export interface CartPageViewProps {
  initialCart?: CartResponseDto | null;
  categories?: CategoryResponseDto[];
}

export function CartPageView({ initialCart, categories }: CartPageViewProps) {
  const { items, cart, isLoading, updateItem, removeItem, clearCart } = useCart(initialCart);
  const [discountCode, setDiscountCode] = useState("");
  const { appliedDiscount, setAppliedDiscount, clearDiscount } = useDiscountStore();
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);
  const effectiveDiscount = appliedDiscount;
  const effectiveDiscountCode = discountCode || appliedDiscount?.code || "";

  const handleApplyDiscount = async () => {
    if (!effectiveDiscountCode.trim()) return;
    setIsApplyingDiscount(true);
    try {
      const res = await cartService.previewDiscount(effectiveDiscountCode.trim());
      const discountData = {
        code: res.data.code,
        amount: res.data.discountAmount,
      };
      setAppliedDiscount(discountData);
      toast.success(`Discount code "${res.data.code}" applied!`);
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Invalid or expired discount code"));
      clearDiscount();
    } finally {
      setIsApplyingDiscount(false);
    }
  };

  const handleRemoveDiscount = () => {
    clearDiscount();
    setDiscountCode("");
    toast.info("Discount code removed");
  };

  const subtotal = cart?.subtotal ?? 0;
  const deliveryCharge = cart?.deliveryCharge ?? 0;
  const serviceCharge = cart?.serviceCharge ?? 0;
  const discountAmount = effectiveDiscount?.amount ?? (cart?.discountAmount ?? 0);
  const totalAmount = Math.max(0, subtotal - discountAmount + deliveryCharge + serviceCharge);

  return (
    <CustomerLayout categories={categories}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between border-b border-neutral-200/80 pb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Shopping Cart
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Review items from independent vendors before checkout.
            </p>
          </div>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearCart.mutate()}
              disabled={clearCart.isPending}
              className="text-xs text-muted-foreground hover:text-destructive self-start sm:self-auto"
            >
              Clear Cart
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-neutral-100 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border py-24 text-center">
            <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground/60" />
            <h2 className="mt-4 text-lg font-bold text-foreground">
              Your cart is empty
            </h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Looks like you haven&apos;t added any products to your cart yet. Explore authentic finds from top vendors.
            </p>
            <Button asChild className="mt-6 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6">
              <Link href="/product">Explore Products</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            {/* Left: Cart Line Items */}
            <div className="lg:col-span-8 space-y-4">
              {items.map((item) => {
                const itemTotal = Number(item.price) * item.quantity;
                const isItemUpdating =
                  updateItem.isPending &&
                  updateItem.variables?.productId === item.productId &&
                  (updateItem.variables?.variantId ?? null) === (item.variant?.id ?? null);
                const isItemRemoving =
                  removeItem.isPending &&
                  removeItem.variables?.productId === item.productId &&
                  (removeItem.variables?.variantId ?? null) === (item.variant?.id ?? null);

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl border border-border bg-card shadow-xs transition-all"
                  >
                    <div className="flex items-center gap-4 w-full sm:w-auto">
                      {/* Product Image */}
                      <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl bg-secondary overflow-hidden shrink-0 border border-border/50">
                        {item.product?.imageUrl ? (
                          <RemoteImage
                            src={item.product.imageUrl}
                            alt={item.product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ShoppingBag className="h-8 w-8 stroke-[1.2]" />
                          </div>
                        )}
                      </div>

                      {/* Product Metadata */}
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/product/${item.product?.slug ?? item.productId}`}
                          className="font-semibold text-base text-foreground hover:text-primary transition-colors line-clamp-1"
                        >
                          {item.product?.name ?? "Product"}
                        </Link>
                        {item.variant && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Variant: {item.variant.options.map((option) => option.value).join(" / ") || "Standard"}
                          </p>
                        )}
                        {(() => {
                          const inStock = item.product?.inStockQuantity ?? 999;
                          const isOutOfStock = inStock <= 0;
                          const isQuantityExceeded = item.quantity > inStock;
                          const isLowStock = !isOutOfStock && !isQuantityExceeded && (item.product?.lowStockAlert || inStock <= 5);

                          if (isOutOfStock) {
                            return (
                              <span className="mt-1 inline-block text-xs font-semibold text-destructive">
                                Out of stock
                              </span>
                            );
                          }
                          if (isQuantityExceeded) {
                            return (
                              <span className="mt-1 inline-block text-xs font-semibold text-amber-600 dark:text-amber-400">
                                Only {inStock} available (requested {item.quantity})
                              </span>
                            );
                          }
                          if (isLowStock) {
                            return (
                              <span className="mt-1 inline-block text-xs font-medium text-amber-600 dark:text-amber-400">
                                Only {inStock} left in stock
                              </span>
                            );
                          }
                          return null;
                        })()}
                        <p className="mt-1 font-bold text-sm text-foreground">
                          {formatPrice(item.price)}
                        </p>
                      </div>
                    </div>

                    {/* Quantity Selector & Item Total */}
                    <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-border/50">
                      {/* Quantity Controller */}
                      <div className="flex items-center border border-border rounded-full bg-secondary/30 p-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (item.quantity > 1) {
                              updateItem.mutate({
                                productId: item.productId,
                                delta: -1,
                                variantId: item.variant?.id,
                              });
                            } else {
                              removeItem.mutate({
                                productId: item.productId,
                                variantId: item.variant?.id,
                              });
                            }
                          }}
                          disabled={isItemUpdating || isItemRemoving}
                          className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background transition-all disabled:opacity-50"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-8 text-center text-xs font-semibold text-foreground">
                          {item.quantity}
                        </span>
                        {(() => {
                          const inStock = item.product?.inStockQuantity ?? 999;
                          const isMaxStockReached = item.quantity >= inStock;
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                updateItem.mutate({
                                  productId: item.productId,
                                  delta: 1,
                                  variantId: item.variant?.id,
                                })
                              }
                              disabled={isItemUpdating || isMaxStockReached}
                              title={isMaxStockReached ? `Maximum available stock reached (${inStock})` : undefined}
                              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background transition-all disabled:opacity-50"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          );
                        })()}
                      </div>

                      {/* Line Item Total */}
                      <div className="text-right min-w-[70px]">
                        <span className="font-bold text-sm text-foreground block">
                          {formatPrice(itemTotal)}
                        </span>
                      </div>

                      {/* Remove Button */}
                      <button
                        type="button"
                        onClick={() =>
                          removeItem.mutate({
                            productId: item.productId,
                            variantId: item.variant?.id,
                          })
                        }
                        disabled={isItemRemoving}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-lg hover:bg-destructive/10"
                        title="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right: Order Summary Sidebar */}
            <aside className="lg:col-span-4 rounded-3xl border border-border bg-card p-6 shadow-xs sticky top-24">
              <h2 className="text-lg font-bold text-foreground mb-4">
                Order Summary
              </h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-semibold text-foreground">{formatPrice(subtotal)}</span>
                </div>

                {effectiveDiscount && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                    <span>Discount ({effectiveDiscount.code})</span>
                    <span>-{formatPrice(discountAmount)}</span>
                  </div>
                )}

                <div className="flex justify-between text-muted-foreground">
                  <span>Estimated Delivery</span>
                  <span className="font-semibold text-foreground">
                    {deliveryCharge > 0 ? formatPrice(deliveryCharge) : "Calculated at checkout"}
                  </span>
                </div>

                {serviceCharge > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Service Fee</span>
                    <span className="font-semibold text-foreground">{formatPrice(serviceCharge)}</span>
                  </div>
                )}

                <div className="border-t border-border pt-4 flex justify-between text-base sm:text-lg font-bold text-foreground">
                  <span>Estimated Total</span>
                  <span>{formatPrice(totalAmount)}</span>
                </div>
              </div>

              {/* Discount Code Input / Applied State */}
              <div className="mt-6">
                <label
                  htmlFor="cart-discount-code"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2"
                >
                  Discount Code
                </label>
                {effectiveDiscount ? (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div>
                        <span className="font-semibold text-foreground uppercase">{effectiveDiscount.code}</span>
                        <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">(-{formatPrice(discountAmount)})</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveDiscount}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors font-semibold"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="cart-discount-code"
                      name="discountCode"
                      aria-label="Discount code"
                      placeholder="Enter discount code"
                      value={effectiveDiscountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                      className="h-10 rounded-xl uppercase text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleApplyDiscount}
                      disabled={isApplyingDiscount || !effectiveDiscountCode.trim()}
                      className="h-10 rounded-xl px-4 text-sm font-medium"
                    >
                      {isApplyingDiscount ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Proceed to Checkout CTA */}
              {(() => {
                const hasStockConflict = items.some(
                  (item) => (item.product?.inStockQuantity ?? 999) < item.quantity
                );

                if (hasStockConflict) {
                  return (
                    <div className="mt-6 space-y-2">
                      <Button
                        disabled
                        className="w-full rounded-full py-6 text-base font-semibold opacity-60 cursor-not-allowed"
                      >
                        Adjust Quantities to Checkout
                      </Button>
                      <p className="text-center text-xs text-amber-600 dark:text-amber-400 font-medium">
                        Some items exceed available inventory. Please adjust quantities before proceeding.
                      </p>
                    </div>
                  );
                }

                return (
                  <Button
                    asChild
                    className="mt-6 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 text-base font-semibold transition-all shadow-sm"
                  >
                    <Link
                      href={effectiveDiscount ? `/checkout?code=${encodeURIComponent(effectiveDiscount.code)}` : "/checkout"}
                      className="flex items-center justify-center gap-2"
                    >
                      <span>Proceed to Checkout</span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                );
              })()}
            </aside>
          </div>
        )}
      </div>
    </CustomerLayout>
  );
}
