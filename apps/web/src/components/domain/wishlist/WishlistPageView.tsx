"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import type { CategoryResponseDto } from "@/api/dto/category";
import type { WishlistResponseDto } from "@/api/dto/wishlist";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { Button } from "@/component/ui/button";
import { useCart } from "@/hooks/use-cart";
import { useWishlist } from "@/hooks/use-wishlist";
import { formatPrice } from "@/lib/util";
import { getApiErrorMessage } from "@/lib/api-error";
import { ArrowRight, Heart, Shield, ShoppingBag, Store, Trash2 } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useAuthStore } from "@/zustand/auth";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export interface WishlistPageViewProps {
  initialItems?: WishlistResponseDto[];
  categories?: CategoryResponseDto[];
}

export function WishlistPageView({ initialItems, categories }: WishlistPageViewProps) {
  const router = useRouter();
  const [isClearOpen, setIsClearOpen] = useState(false);
  const { items, removeItem, clearWishlist, isLoading } = useWishlist(initialItems);
  const { addItem: addToCart } = useCart();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const capabilities = useAuthStore((state) => state.capabilities);
  const canAdminister = capabilities?.canAdminister ?? false;
  const canSell = capabilities?.canSell ?? false;
  const isOperator = isAuthenticated && (canAdminister || canSell);

  const handleAddToCart = (item: (typeof items)[0]) => {
    const canPurchase = useAuthStore.getState().capabilities?.canPurchase ?? false;
    if (!canPurchase) {
      return;
    }
    addToCart.mutate(
      {
        productId: item.productId,
        quantity: 1,
        price: item.price,
        productName: item.name,
        productSlug: item.slug,
        variantId: item.variantId ?? undefined,
        addedFrom: "PRODUCT_PAGE",
      },
      {
        onSuccess: () => {
          toast.success(`Moved "${item.name}" to cart!`, {
            action: {
              label: "View Cart",
              onClick: () => {
                router.push("/cart");
              },
            },
          });
        },
        onError: (error: unknown) => {
          const msg = getApiErrorMessage(error, "Unable to add this item to your cart");
          if (msg.toLowerCase().includes("variant")) {
            router.push(`/product/${item.slug}`);
            toast.info("Please choose an option before adding to your cart");
            return;
          }
          toast.error(msg);
        },
      }
    );
  };

  return (
    <CustomerLayout categories={categories}>
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between border-b border-neutral-200/80 pb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Saved Wishlist
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {items.length} item(s) curated for your private collection.
            </p>
          </div>

          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setIsClearOpen(true)}
              className="text-xs font-semibold text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              Clear All Items
            </button>
          )}
        </div>

        {/* Loading State */}
        {isOperator ? (
          <div className="rounded-3xl border border-border bg-card p-8 sm:p-12 text-center max-w-xl mx-auto my-8 shadow-xs">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-foreground">
              {canAdminister ? <Shield className="h-7 w-7 text-indigo-500" /> : <Store className="h-7 w-7 text-amber-500" />}
            </div>
            <h2 className="mt-4 text-xl font-bold text-foreground">
              {canAdminister ? "Administrator Session" : "Vendor Session"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Storefront wishlists are reserved for customer shopper accounts. Operators cannot maintain customer wishlists.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-5">
                <Link href={canAdminister ? "/admin" : "/vendor/analytic"}>
                  {canAdminister ? "Return to Admin Console" : "Return to Vendor Dashboard"}
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full px-5 border-border">
                <Link href="/product">Browse Products</Link>
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] animate-pulse rounded-2xl bg-neutral-100"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          /* Empty State */
          <div className="mx-auto max-w-md py-20 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <Heart className="h-10 w-10 stroke-[1.2]" />
            </div>
            <h2 className="mt-6 text-2xl font-semibold text-foreground">
              Your wishlist is empty
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Save favorite pieces from independent vendors by tapping the heart icon as you explore.
            </p>
            <Button
              asChild
              className="mt-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-3 text-sm font-semibold transition-all shadow-sm"
            >
              <Link href="/product" className="flex items-center gap-2">
                <span>Discover Products</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        ) : (
          /* Items Grid */
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-10">
            {items.map((item) => (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between"
              >
                <div>
                  {/* Image Container */}
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-secondary">
                    <Link href={`/product/${item.slug}`} className="block h-full w-full">
                      {item.image ? (
                        <RemoteImage
                          src={item.image}
                          alt={item.name}
                          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ShoppingBag className="h-12 w-12 stroke-[1.2]" />
                        </div>
                      )}
                    </Link>

                    {/* Remove Action */}
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId, item.variantId ?? undefined)}
                      aria-label="Remove item"
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-muted-foreground backdrop-blur-sm shadow-xs hover:text-foreground transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Product Details */}
                  <div className="mt-3">
                    {item.vendorStore && (
                      <p className="text-xs font-medium text-muted-foreground truncate">
                        {item.vendorStore}
                      </p>
                    )}
                    <Link
                      href={`/product/${item.slug}`}
                      className="text-sm font-medium text-foreground line-clamp-1 hover:text-primary transition-colors mt-0.5"
                    >
                      {item.name}
                    </Link>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {formatPrice(item.price)}
                    </p>
                  </div>
                </div>

                {/* Move to Cart CTA */}
                <div className="mt-3">
                  <Button
                    type="button"
                    onClick={() => handleAddToCart(item)}
                    disabled={addToCart.isPending}
                    className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 py-2 text-sm font-medium transition-all shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>Move to Cart</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={isClearOpen}
          onOpenChange={setIsClearOpen}
          title="Clear Entire Wishlist?"
          description="Are you sure you want to remove all items from your saved wishlist collection?"
          confirmText="Yes, Clear Wishlist"
          variant="destructive"
          onConfirm={() => {
            clearWishlist();
            setIsClearOpen(false);
          }}
        />
      </div>
    </CustomerLayout>
  );
}
