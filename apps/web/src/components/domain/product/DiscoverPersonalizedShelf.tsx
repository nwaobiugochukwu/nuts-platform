"use client";

import { TrendingCarousel } from "@/components/domain/product/TrendingCarousel";
import { useForYouRecommendations } from "@/hooks/use-personalized-recommendations";

export function DiscoverPersonalizedShelf() {
  const { products, sessionId, isShopper } = useForYouRecommendations();

  if (!isShopper || products.length === 0) return null;

  return (
    <section className="mb-10" aria-label="Personalized product recommendations">
      <TrendingCarousel
        title="Picked for you"
        eyebrow="Based on your activity"
        initialProducts={products}
        recommendationSurface="DISCOVERY"
        recommendationSessionId={sessionId}
      />
    </section>
  );
}
