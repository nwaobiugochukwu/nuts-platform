"use client";

import type { ProductCardDto } from "@/api/dto/product";
import { RecommendationProductCard } from "@/components/domain/product/RecommendationProductCard";
import Link from "@/components/navigation/AppLink";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface GoodPlaceToStartSectionProps {
  products: ProductCardDto[];
  sessionId: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function GoodPlaceToStartSection({
  products,
  sessionId,
  isLoading,
  isError,
  onRetry,
}: GoodPlaceToStartSectionProps) {
  const productsRef = useRef<HTMLDivElement>(null);
  const [requestId, setRequestId] = useState("");

  const diverseProducts = useMemo(() => {
    const seenVendors = new Set<string>();
    const seenProducts = new Set<string>();
    return products.filter((product) => {
      const vendorId = product.vendor?.id;
      if (!vendorId || seenVendors.has(vendorId) || seenProducts.has(product.id)) return false;
      seenVendors.add(vendorId);
      seenProducts.add(product.id);
      return true;
    }).slice(0, 12);
  }, [products]);
  const productSignature = diverseProducts.map(({ id }) => id).join(":");

  useEffect(() => {
    if (!productSignature) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRequestId(createRecommendationRequestId());
    });
    return () => {
      cancelled = true;
    };
  }, [productSignature]);

  const scrollProducts = (direction: "left" | "right") => {
    productsRef.current?.scrollBy({
      left: (direction === "left" ? -1 : 1) * Math.max(280, (productsRef.current?.clientWidth ?? 0) * 0.8),
      behavior: "smooth",
    });
  };

  if (diverseProducts.length === 0) {
    if (!isError || isLoading) return null;
    return (
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="good-place-to-start-heading" role="status">
        <div className="rounded-2xl border border-border bg-card/60 px-5 py-6">
          <h2 id="good-place-to-start-heading" className="text-xl font-bold tracking-tight text-foreground">A good place to start</h2>
          <p className="mt-1 text-sm text-muted-foreground">Fresh product picks could not load just now.</p>
          <button type="button" onClick={onRetry} className="mt-3 text-sm font-semibold text-foreground underline underline-offset-4">Try again</button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="good-place-to-start-heading">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Picked for you, with something new to discover</p>
          <h2 id="good-place-to-start-heading" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            A good place to start
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/discover" className="hidden text-sm font-semibold text-foreground underline-offset-4 hover:underline sm:inline">Browse all finds</Link>
          {diverseProducts.length > 3 && (
            <>
              <button type="button" onClick={() => scrollProducts("left")} aria-label="Previous starter picks" aria-controls="good-place-products" className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary">
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => scrollProducts("right")} aria-label="Next starter picks" aria-controls="good-place-products" className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary">
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      <div
        id="good-place-products"
        ref={productsRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        aria-label="One product from each selected vendor"
      >
        {diverseProducts.map((product, position) => (
          <div key={product.id} className="w-[220px] shrink-0 snap-start sm:w-[250px]">
            <RecommendationProductCard
              product={product}
              surface="HOME_MARKETPLACE_MIX"
              requestId={requestId}
              sessionId={sessionId}
              position={position}
              priority={position < 2}
            />
          </div>
        ))}
      </div>
      <Link href="/discover" className="mt-1 inline-flex text-sm font-semibold text-foreground underline-offset-4 hover:underline sm:hidden">Browse all finds</Link>
    </section>
  );
}
