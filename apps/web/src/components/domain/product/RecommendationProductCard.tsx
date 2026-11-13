"use client";

import type { ProductCardDto } from "@/api/dto/product";
import type { RecommendationAttribution, RecommendationSurface } from "@/api/modules/analytics";
import { ProductCard } from "@/component/product/ProductCard";
import { useRecommendationImpression } from "@/hooks/use-recommendation-impression";
import { useAuthStore } from "@/zustand/auth";
import { useMemo, useRef } from "react";

const RANKER_VERSION = "hybrid-v2";

interface RecommendationProductCardProps {
  product: ProductCardDto;
  surface: RecommendationSurface;
  requestId: string;
  sessionId: string;
  position: number;
  priority?: boolean;
  size?: "default" | "lg";
}

export function RecommendationProductCard({
  product,
  surface,
  requestId,
  sessionId,
  position,
  priority = false,
  size = "lg",
}: RecommendationProductCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const canTrackRecommendations = !isAuthenticated || canPurchase;
  const rankerVersion = surface === "HOME_MARKETPLACE_MIX" ? "starter-picks-v1" : RANKER_VERSION;
  const attribution = useMemo<RecommendationAttribution | undefined>(
    () => requestId && sessionId && canTrackRecommendations
      ? { requestId, surface, rankerVersion, position, sessionId }
      : undefined,
    [canTrackRecommendations, position, rankerVersion, requestId, sessionId, surface],
  );

  useRecommendationImpression({
    elementRef: cardRef,
    attribution,
    item: { productId: product.id },
    authenticated: isAuthenticated && canPurchase,
  });

  return (
    <div ref={cardRef}>
      <ProductCard
        product={product}
        addedFrom="PRODUCT_PAGE"
        recommendationContext={attribution}
        priority={priority}
        size={size}
      />
    </div>
  );
}
