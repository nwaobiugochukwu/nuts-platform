"use client";

import type { ProductCardDto } from "@/api/dto/product";
import type { AddedFromType } from "@/api/dto/cart";
import { ProductCard } from "@/component/product/ProductCard";
import { RecommendationProductCard } from "@/component/product/RecommendationProductCard";
import type { RecommendationSurface } from "@/api/modules/analytics";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { ChevronLeft,ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

interface TrendingCarouselProps {
  initialProducts: ProductCardDto[];
  title: string;
  eyebrow?: string;
  description?: string;
  headingId?: string;
  addedFrom?: AddedFromType;
  headerAction?: ReactNode;
  recommendationSurface?: RecommendationSurface;
  recommendationSessionId?: string;
}

export function TrendingCarousel({
  initialProducts,
  title,
  eyebrow,
  description,
  headingId,
  addedFrom = "CATEGORY_PAGE",
  headerAction,
  recommendationSurface,
  recommendationSessionId = "",
}: TrendingCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [requestId, setRequestId] = useState("");
  const products = initialProducts ?? [];

  useEffect(() => {
    if (!recommendationSurface) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRequestId(createRecommendationRequestId());
    });

    return () => {
      cancelled = true;
    };
  }, [recommendationSurface]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const amount = Math.max(280, scrollRef.current.clientWidth * 0.85);
      scrollRef.current.scrollBy({
        left: direction === "left" ? -amount : amount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>}
          <h2 id={headingId} className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>}
        </div>

        {/* Carousel Navigation (< >) */}
        <div className="flex items-center gap-1.5">
          {headerAction}
          <button
            type="button"
            onClick={() => scroll("left")}
            aria-label="Previous products"
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground hover:bg-secondary transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            aria-label="Next products"
            className="flex h-8 w-8 items-center justify-center rounded-full text-foreground hover:bg-secondary transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel Container */}
      <div
        ref={scrollRef}
        className="flex gap-4 sm:gap-6 overflow-x-auto pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden snap-x"
      >
        {products.length === 0 ? (
          <div className="w-full py-16 text-center text-sm text-muted-foreground border border-dashed rounded-2xl">
            No products available at the moment.
          </div>
        ) : (
          products.map((product: ProductCardDto, index: number) => (
            <div
              key={product.id}
              className="w-[230px] sm:w-[270px] shrink-0 snap-start"
            >
              {recommendationSurface ? (
                <RecommendationProductCard
                  product={product}
                  surface={recommendationSurface}
                  requestId={requestId}
                  sessionId={recommendationSessionId}
                  position={index}
                  priority={index < 2}
                  size="lg"
                />
              ) : (
                <ProductCard
                  product={product}
                  addedFrom={addedFrom}
                  size="lg"
                  priority={index < 2}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
