"use client";

import { getApiErrorMessage } from "@/api/core/error";
import type { AddedFromType } from "@/api/dto/cart";
import type { RecommendationAttribution } from "@/api/modules/analytics";
import { analyticsEventService } from "@/api/modules/analytics";
import type { ProductCardDto,PublicProductResponseDto } from "@/api/dto/product";
import type { ProductVoucherSummaryDto } from "@/api/dto/discount";
import { useCart } from "@/hooks/use-cart";
import { useWishlist } from "@/hooks/use-wishlist";
import { formatPrice } from "@/lib/util";
import { resolveProductDetailPath } from "@/lib/product-path";
import { storeRecommendationAttribution } from "@/lib/recommendation-attribution";
import { useAuthStore } from "@/zustand/auth";
import { useDiscountStore } from "@/zustand/discount";
import { Heart,Plus,ShoppingBag,Tag } from "lucide-react";
import Image from "next/image";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type ProductLike = ProductCardDto | PublicProductResponseDto;

interface ProductCardProps {
  product: ProductLike;
  deal?: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
  onQuickAdd?: () => void;
  categoryPath?: string;
  href?: string;
  addedFrom?: AddedFromType;
  aspectRatio?: "square" | "portrait";
  size?: "default" | "lg";
  titleClassName?: string;
  priceClassName?: string;
  priority?: boolean;
  hideVendor?: boolean;
  hideRecommendationReason?: boolean;
  recommendationContext?: RecommendationAttribution;
}

type WishlistProductShape = {
  id: string;
  name: string;
  slug: string;
  price: number;
  discountPrice?: number | null;
  thumbnail?: string | null;
  stock?: number;
  images: Array<{ url?: string } | string>;
  vendor?: { storeName?: string; storeSlug?: string; isVerified?: boolean };
};

function toWishlistProduct(product: ProductLike): WishlistProductShape {
  if ("images" in product) {
    return product as WishlistProductShape;
  }
  const thumbnail = "thumbnail" in product ? product.thumbnail ?? null : null;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: Number(product.price ?? 0),
    discountPrice: product.discountPrice,
    thumbnail,
    stock: 0,
    images: [],
    
  };
}

export function ProductCard({
  product,
  deal,
  onQuickAdd,
  categoryPath,
  href,
  addedFrom,
  aspectRatio = "portrait",
  size = "default",
  titleClassName,
  priceClassName,
  priority = false,
  hideVendor = false,
  hideRecommendationReason = false,
  recommendationContext,
}: ProductCardProps) {
  const router = useRouter();
  const targetHref = resolveProductDetailPath(product.slug, categoryPath, href);

  const effectiveAddedFrom: AddedFromType =
    addedFrom || (categoryPath ? "CATEGORY_PAGE" : "PRODUCT_PAGE");

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const capabilities = useAuthStore((state) => state.capabilities);
  const canPurchase = capabilities ? capabilities.canPurchase : !isAuthenticated;
  const { toggleItem, isInWishlist } = useWishlist();
  const { addItem: addToCart } = useCart();
  const { claimCode, claimedCode, appliedDiscount } = useDiscountStore();
  const [isWishlistPending, setIsWishlistPending] = useState(false);
  const isLiked = isInWishlist(product.id);

  // Product cards receive deal data from their parent batch query. Avoid one
  // public discount request per rendered card when a feed is loading.
  const effectiveDeal = deal ?? null;

  const isDealClaimed =
    effectiveDeal ? (claimedCode === effectiveDeal.code || appliedDiscount?.code === effectiveDeal.code) : false;

  const handleClaimDeal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (effectiveDeal) {
      claimCode(effectiveDeal.code);
    }
  };
  const trackRecommendationClick = () => {
    if (!recommendationContext || (isAuthenticated && !canPurchase)) return;
    storeRecommendationAttribution(product.id, recommendationContext);
    void analyticsEventService.trackRecommendation(
      recommendationContext,
      "CLICK",
      { productId: product.id },
      isAuthenticated && canPurchase,
    ).catch(() => undefined);
  };

  const isCard = !("stock" in product);

  const price = Number(product.price || 0);
  const compareAtPrice = "compareAtPrice" in product ? product.compareAtPrice : null;
  const hasCompareAtPrice = compareAtPrice != null && Number(compareAtPrice) > price;
  const discountPrice =
    product.discountPrice !== undefined && product.discountPrice !== null
      ? Number(product.discountPrice)
      : hasCompareAtPrice
      ? price
      : null;

  const originalPrice =
    hasCompareAtPrice && Number(compareAtPrice) > (discountPrice ?? price)
      ? Number(compareAtPrice)
      : discountPrice !== null && discountPrice < price
      ? price
      : null;

  const currentPrice = discountPrice ?? price;
  const hasDiscount = !!originalPrice && originalPrice > currentPrice;
  const discountPercent = hasDiscount
    ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
    : 0;

  const thumbnail = "thumbnail" in product ? product.thumbnail ?? null : null;
  const img =
    "images" in product &&
    product.images.length > 0 &&
    typeof product.images[0] === "object" &&
    "url" in product.images[0]
      ? product.images[0].url
      : thumbnail;
  const store = product.vendor;
  const recommendationReason =
    !hideRecommendationReason && "recommendationReason" in product
      ? product.recommendationReason
      : undefined;
  const stock = isCard ? 0 : (product.stock ?? 0);
  const stockStatus = isCard ? product.stockStatus : undefined;
  const isOutOfStock = isCard
    ? stockStatus === "Out of stock" || stockStatus === "Inactive"
    : stock <= 0;
  const isLowStock = isCard ? stockStatus === "Few items left" : stock > 0 && stock <= 5;
  const hasVariants =
    Boolean(product.hasVariants) || (!isCard && (product.variants?.length ?? 0) > 0);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      toast.error("Please sign in to add items to your cart");
      return;
    }
    const canPurchase = useAuthStore.getState().capabilities?.canPurchase ?? false;
    if (!canPurchase) {
      toast.info("Your account type cannot make storefront purchases.");
      return;
    }
    if (hasVariants) {
      router.push(targetHref);
      return;
    }
    if (isOutOfStock) {
      toast.error("This item is currently out of stock");
      return;
    }
    addToCart.mutate({
      productId: product.id,
      quantity: 1,
      price: currentPrice,
      productName: product.name,
      productSlug: product.slug,
      addedFrom: effectiveAddedFrom,
      recommendationContext,
      path: targetHref,
    }, {
      onSuccess: () => {
        toast.success(`Added "${product.name}" to cart!`, {
          action: {
            label: "View Cart",
            onClick: () => {
              router.push("/cart");
            },
          },
        });
        onQuickAdd?.();
      },
      onError: (error) => {
        toast.error(getApiErrorMessage(error, "Unable to add this item to your cart"));
      },
    });
  };

  const handleToggleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      toast.error("Please sign in to save items to your wishlist", {
        action: {
          label: "Sign in",
          onClick: () => router.push("/auth/login"),
        },
      });
      return;
    }
    const canPurchase = useAuthStore.getState().capabilities?.canPurchase ?? false;
    if (!canPurchase) {
      toast.info("Your account type cannot maintain customer wishlists.");
      return;
    }
    if (isWishlistPending) return;

    setIsWishlistPending(true);
    try {
      const added = await toggleItem(toWishlistProduct(product));
      toast.success(added ? "Saved to wishlist" : "Removed from wishlist");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update wishlist"));
    } finally {
      setIsWishlistPending(false);
    }
  };

  return (
    <div className="group relative flex h-full flex-col">
      {/* Product Image Box */}
      <div
        className={`relative w-full overflow-hidden rounded-2xl bg-[#f4f5f6] dark:bg-neutral-900 transition-all ${
          aspectRatio === "square" ? "aspect-square" : "aspect-[3/4]"
        }`}
      >
        <Link href={targetHref} className="block relative h-full w-full" onClick={trackRecommendationClick}>
          {img ? (
            <Image
              src={img}
              alt={product.name}
              fill
              priority={priority}
              loading={priority ? "eager" : "lazy"}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground/40">
              <ShoppingBag className="h-10 w-10 stroke-[1.2]" />
            </div>
          )}
        </Link>

        {/* Badges Overlay */}
        <div className="absolute left-2.5 top-2.5 flex flex-col gap-1 pointer-events-none">
          {effectiveDeal && (
            <button
              type="button"
              onClick={handleClaimDeal}
              title={`Claim ${effectiveDeal.code} for ${effectiveDeal.type === "PERCENTAGE" ? `${effectiveDeal.value}% off` : formatPrice(effectiveDeal.value) + " off"}`}
              className={`pointer-events-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold text-white shadow-xs backdrop-blur-xs transition-transform hover:scale-105 active:scale-95 ${
                isDealClaimed
                  ? "bg-emerald-600 dark:bg-emerald-500"
                  : "bg-emerald-700/90 dark:bg-emerald-600/90 hover:bg-emerald-600"
              }`}
            >
              <Tag className="h-3 w-3 stroke-[2.5]" />
              <span>
                {effectiveDeal.type === "PERCENTAGE" ? `${effectiveDeal.value}% OFF` : `Save ${formatPrice(effectiveDeal.value)}`}
              </span>
            </button>
          )}
          {hasDiscount && (
            <span className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground shadow-xs">
              -{discountPercent}%
            </span>
          )}
          {isLowStock && (
            <span className="inline-flex items-center rounded-md bg-neutral-900/90 dark:bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
              Few left
            </span>
          )}
        </div>

        {/* Floating Quick Add '+' Button */}
        {canPurchase && (
          <button
            type="button"
            onClick={handleAdd}
            disabled={isOutOfStock || addToCart.isPending}
            aria-label={hasVariants ? `Choose options for ${product.name}` : `Quick add ${product.name} to cart`}
            className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-card text-foreground border border-border shadow-md transition-all duration-200 hover:scale-110 hover:bg-secondary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 z-10"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
          </button>
        )}
      </div>

      {/* Product Content Details */}
      <div className="pt-2.5 pb-1 flex flex-col gap-0.5">
        {/* Title & Wishlist Row */}
        <div className="flex items-start justify-between gap-2">
          <Link href={targetHref} className="flex-1 min-w-0" onClick={trackRecommendationClick}>
            <h3
              className={
                titleClassName ||
                (size === "lg"
                  ? "text-base sm:text-lg font-bold text-foreground truncate transition-colors hover:text-primary"
                  : "text-sm font-medium text-foreground truncate transition-colors hover:text-primary")
              }
            >
              {product.name}
            </h3>
          </Link>

          {canPurchase && (
            <button
              type="button"
              onClick={handleToggleWishlist}
              aria-label={isLiked ? "Remove from wishlist" : "Add to wishlist"}
              disabled={isWishlistPending}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Heart
                className={`h-4.5 w-4.5 ${
                  isLiked ? "fill-primary text-primary" : "stroke-[1.6]"
                } ${isWishlistPending ? "animate-pulse" : ""}`}
              />
            </button>
          )}
        </div>

        {/* Vendor Store Name */}
        {!hideVendor && store?.storeName && (
          <Link
            href={`/vendor/${store.storeSlug || ""}`}
            className={`${
              size === "lg" ? "text-xs sm:text-sm" : "text-xs"
            } font-medium text-muted-foreground hover:text-foreground transition-colors truncate`}
            onClick={(e) => e.stopPropagation()}
          >
            {store.storeName}
          </Link>
        )}

        {recommendationReason && (
          <p className="line-clamp-1 text-[11px] leading-4 text-muted-foreground">
            {recommendationReason}
          </p>
        )}

        {/* Price Row */}
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={
              priceClassName ||
              (size === "lg"
                ? "text-lg sm:text-xl font-bold text-foreground"
                : "text-base sm:text-lg font-semibold text-foreground")
            }
          >
            {formatPrice(currentPrice)}
          </span>
          {hasDiscount && (
            <span
              className={`${
                size === "lg" ? "text-sm sm:text-base" : "text-sm"
              } text-muted-foreground line-through`}
            >
              {formatPrice(originalPrice!)}
            </span>
          )}
        </div>

        {effectiveDeal?.dealPrice && effectiveDeal.dealPrice < currentPrice && (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span>As low as {formatPrice(effectiveDeal.dealPrice)} with</span>
            <button
              type="button"
              onClick={handleClaimDeal}
              className="font-mono underline decoration-dotted hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
              title={`Click to claim code ${effectiveDeal.code}`}
            >
              {effectiveDeal.code}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
