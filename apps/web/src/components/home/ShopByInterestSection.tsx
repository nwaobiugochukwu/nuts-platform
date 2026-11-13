"use client";

import type { CategoryResponseDto } from "@/api/dto/category";
import { analyticsEventService, type RecommendationAttribution } from "@/api/modules/analytics";
import { RemoteImage } from "@/components/ui/RemoteImage";
import Link from "@/components/navigation/AppLink";
import { useRecommendationSessionId } from "@/hooks/use-recommendation-session";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { ArrowUpRight, Shapes } from "lucide-react";
import { useAuthStore } from "@/zustand/auth";
import { useEffect, useState } from "react";

export function ShopByInterestSection({ categories }: { categories: CategoryResponseDto[] }) {
  const sessionId = useRecommendationSessionId();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const [requestId, setRequestId] = useState("");
  const rootCategories = categories.filter((category) =>
    category.isActive && (!category.parentId || category.level === "CATEGORY"),
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRequestId(createRecommendationRequestId());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rootCategories.length === 0) return null;

  const trackCategory = (category: CategoryResponseDto, position: number) => {
    if (!requestId || !sessionId || (isAuthenticated && !canPurchase)) return;
    const attribution: RecommendationAttribution = {
      requestId,
      surface: "CATEGORY_BROWSE",
      rankerVersion: "home-interest-paths-v1",
      position,
      sessionId,
    };
    void analyticsEventService.trackRecommendation(
      attribution,
      "CATEGORY_VIEW",
      { categoryId: category.id },
      isAuthenticated && canPurchase,
    ).catch(() => undefined);
  };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="shop-by-interest-heading">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Browse by category</p>
          <h2 id="shop-by-interest-heading" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Shop by interest</h2>
        </div>
        <Link href="/category" className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline sm:inline-flex">
          All categories <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" aria-label="Shop by category">
        {rootCategories.map((category, position) => (
          <Link
            key={category.id}
            href={`/category/${encodeURIComponent(category.slug)}`}
            onClick={() => trackCategory(category, position)}
            className="group relative flex h-40 w-[min(58vw,220px)] shrink-0 snap-start items-end overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/70 via-foreground/90 to-foreground p-4 text-foreground transition-transform hover:-translate-y-0.5 sm:h-48 sm:w-[230px] sm:p-5"
          >
            {category.imageUrl ? (
              <RemoteImage
                src={category.imageUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <Shapes className="absolute right-4 top-4 h-10 w-10 text-background/25" aria-hidden="true" />
            )}
            <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" aria-hidden="true" />
            <span className="relative z-10 flex w-full items-end justify-between gap-2 text-white">
              <span className="line-clamp-2 text-base font-bold sm:text-lg">{category.name}</span>
              <ArrowUpRight className="mb-0.5 h-5 w-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
      <Link href="/category" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline sm:hidden">
        Browse all categories <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
