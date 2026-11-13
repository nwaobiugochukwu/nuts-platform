"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Layers3, Loader2, Search, ShoppingBag, Store, X } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { RemoteImage } from "@/component/ui/RemoteImage";
import { publicApi } from "@/api/core/client";
import { recommendationService } from "@/api/modules/recommendations";
import { analyticsEventService, type RecommendationAttribution } from "@/api/modules/analytics";
import { useRecommendationImpression } from "@/hooks/use-recommendation-impression";
import {
  useRecommendationSessionId,
  useRecommendationVisitorId,
} from "@/hooks/use-recommendation-session";
import type { ProductCardDto } from "@/api/dto/product";
import { formatPrice } from "@/lib/util";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { storeRecommendationAttribution } from "@/lib/recommendation-attribution";
import type { SearchDiscoveryItemDto } from "@/api/dto/recommendations";
import { useAuthStore } from "@/zustand/auth";
import type { SearchResultItem } from "./GlobalSearchBar";

interface AutocompleteApiResponse {
  results: SearchResultItem[];
  data?: SearchResultItem[];
}

interface SearchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

export function SearchDrawer({ isOpen, onClose, initialQuery = "" }: SearchDrawerProps) {
  const router = useRouter();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [query, setQuery] = useState(initialQuery);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebouncedValue(query.trim().toLocaleLowerCase(), 200);
  const isTypingAhead = query.trim().toLocaleLowerCase() !== debouncedQuery;
  const userId = useAuthStore((state) => state.user?.id);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthInitialized = useAuthStore((state) => state.isInitialized);
  const isCustomer = useAuthStore((state) =>
    state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const isShopper = !isAuthenticated || isCustomer;
  const sessionId = useRecommendationSessionId();
  const visitorId = useRecommendationVisitorId();
  const [recommendationRequestId, setRecommendationRequestId] = useState("");
  const isEmptySearch = query.trim().length === 0;

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setQuery(initialQuery);
    else setQuery("");
  }

  useEffect(() => {
    if (!isOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = oldOverflow;
    };
  }, [isOpen, onClose]);

  const searchDiscoveryQuery = useQuery({
    queryKey: ["recommendations", "search-discover", userId ?? null, sessionId, visitorId],
    queryFn: async ({ signal }) =>
      (await recommendationService.searchDiscover(sessionId, isCustomer, visitorId, signal)).data,
    enabled: isOpen && isEmptySearch && isAuthInitialized && isShopper && Boolean(sessionId),
    // Refresh when the drawer is reopened so a product visited since the last
    // search session can influence the next set of picks.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search-drawer-autocomplete", debouncedQuery],
    queryFn: async ({ signal }) => {
      const response = await publicApi.get<AutocompleteApiResponse | SearchResultItem[]>("/search/autocomplete", {
        params: { query: debouncedQuery, limit: 18 },
        signal,
      });
      const raw = response.data;
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(raw.results)) return raw.results;
      if (Array.isArray(raw.data)) return raw.data;
      return [];
    },
    enabled: isOpen && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const productItems = useMemo(() => results.filter((item) => item.type === "product" || item.index === "products"), [results]);
  const vendorItems = useMemo(() => results.filter((item) => item.type === "vendor" || item.index === "vendors"), [results]);
  const categoryItems = useMemo(() => results.filter((item) => item.type === "category" || item.type === "subcategory" || item.index === "categories"), [results]);
  const hasResults = productItems.length > 0 || vendorItems.length > 0 || categoryItems.length > 0;
  const searchDiscoveryItems = searchDiscoveryQuery.data?.items ?? [];

  useEffect(() => {
    let cancelled = false;
    const nextRequestId =
      isOpen && isEmptySearch && sessionId && isShopper
        ? createRecommendationRequestId()
        : "";

    queueMicrotask(() => {
      if (!cancelled) setRecommendationRequestId(nextRequestId);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isEmptySearch, sessionId, isShopper]);

  const goToSearch = (event?: React.FormEvent) => {
    event?.preventDefault();
    const term = query.trim();
    if (!term) return;
    onClose();
    router.push(`/search?query=${encodeURIComponent(term)}`);
  };

  const categoryHref = (item: SearchResultItem) => {
    const path = item.payload?.path || item.payload?.slug || "";
    return `/category/${String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Search NUTS" className="fixed inset-0 z-[9999] flex justify-end">
      <button type="button" onClick={onClose} aria-label="Close search panel" className="fixed inset-0 cursor-pointer bg-black/50 backdrop-blur-xs" />
      <div onClick={(event) => event.stopPropagation()} className="relative z-10 flex h-[100dvh] w-full max-w-full flex-col border-l border-border/80 bg-background shadow-2xl sm:w-[480px] md:w-[520px] lg:w-[560px]">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/80 bg-background/95 px-3.5 py-2.5 backdrop-blur-md sm:px-4">
          <form onSubmit={goToSearch} className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-border/80 bg-secondary/60 px-3.5 focus-within:border-foreground">
            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <input ref={inputRef} type="text" id="search-drawer-input" name="search" value={query} maxLength={100} placeholder="Search NUTS" onChange={(event) => setQuery(event.target.value)} className="min-w-0 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="shrink-0 p-1 text-muted-foreground"><X className="h-4 w-4" /></button>}
          </form>
          <button type="button" onClick={onClose} aria-label="Close search panel" className="flex h-9 shrink-0 items-center rounded-full border border-border/80 bg-secondary/80 px-3 text-xs font-semibold">Close</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-4">
          {!query.trim() && isShopper && (
            <section>
              <h2 className="mb-2 px-1 text-sm font-semibold">Discover on NUTS</h2>
              {!isAuthInitialized || searchDiscoveryQuery.isLoading ? (
                <div className="space-y-2" aria-label="Loading recommendations" aria-busy="true">
                  {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-secondary" />)}
                </div>
              ) : searchDiscoveryQuery.isError ? (
                <div className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">
                  <p>Discover recommendations couldn’t load.</p>
                  <button type="button" onClick={() => void searchDiscoveryQuery.refetch()} className="mt-2 font-semibold text-foreground underline">Try again</button>
                </div>
              ) : searchDiscoveryItems.length === 0 ? (
                <p className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">Recommendations will appear here as products and stores become available.</p>
              ) : (
                <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/80 bg-card/60">
                  {searchDiscoveryItems.map((item, position) => item.type === "product" ? (
                    <TrackedSearchRecommendation
                      key={`product:${item.product.id}`}
                      product={item.product}
                      reason={item.reason}
                      position={position}
                      requestId={recommendationRequestId}
                      sessionId={sessionId}
                      authenticated={isCustomer}
                      onClose={onClose}
                    />
                  ) : (
                    <TrackedSearchVendorRecommendation
                      key={`vendor:${item.vendor.id}`}
                      item={item}
                      position={position}
                      requestId={recommendationRequestId}
                      sessionId={sessionId}
                      authenticated={isCustomer}
                      onClose={onClose}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {query.trim().length >= 2 && (isTypingAhead ? <div className="flex justify-center py-10 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating search for “{query.trim()}”…</div> : isFetching ? <div className="flex justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching NUTS…</div> : (
            <>
              {!hasResults && <div className="py-5 text-center text-sm text-muted-foreground">No exact matches yet. Try a broader search or view all marketplace results.</div>}
              {categoryItems.length > 0 && <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Layers3 className="h-3.5 w-3.5" />Categories</h2>
                <div className="space-y-1.5">{categoryItems.slice(0, 5).map((item) => <Link key={item.id} href={categoryHref(item)} onClick={onClose} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/50 bg-card/60 p-2.5 text-sm hover:bg-secondary">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-secondary/70">
                    {item.payload?.imageUrl || item.payload?.iconUrl
                      ? <RemoteImage src={item.payload.imageUrl || item.payload.iconUrl || ""} alt="" className="h-full w-full object-contain p-1" />
                      : <Layers3 className="h-4 w-4 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.title}</span>
                    {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>)}</div>
              </section>}
              {productItems.length > 0 && <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><ShoppingBag className="h-3.5 w-3.5" />Products</h2>
                <div className="space-y-1.5">{productItems.slice(0, 6).map((item) => <Link key={item.id} href={`/product/${item.payload?.slug || item.id}`} onClick={onClose} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/40 bg-card/60 p-2.5 hover:bg-secondary">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted">
                    {item.payload?.imageUrl
                      ? <RemoteImage src={item.payload.imageUrl} alt="" className="h-full w-full object-cover" />
                      : <ShoppingBag className="h-4 w-4 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    {item.payload?.price !== undefined && <span className="block truncate text-xs font-semibold text-muted-foreground">{formatPrice(Number(item.payload.price))}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>)}</div>
              </section>}
              {vendorItems.length > 0 && <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Store className="h-3.5 w-3.5" />Vendors</h2>
                <div className="space-y-1.5">{vendorItems.slice(0, 4).map((item) => <Link key={item.id} href={`/vendor/${item.payload?.storeSlug || item.id}`} onClick={onClose} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/40 bg-card/60 p-2.5 text-sm hover:bg-secondary">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-secondary">
                    {item.payload?.storeLogoUrl
                      ? <RemoteImage src={item.payload.storeLogoUrl} alt="" className="h-full w-full object-cover" />
                      : <Store className="h-4 w-4 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.title}</span>
                    {(item.payload?.storeDescription || item.subtitle) && <span className="block truncate text-xs text-muted-foreground">{item.payload?.storeDescription || item.subtitle}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>)}</div>
              </section>}
            </>
          ))}
        </div>

        {query.trim().length >= 2 && <div className="sticky bottom-0 border-t border-border/80 bg-background/95 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur-md"><button type="button" onClick={() => goToSearch()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-black py-3 text-sm font-semibold text-white dark:bg-white dark:text-black">View all results for “{query.trim()}”<ArrowRight className="h-4 w-4" /></button></div>}
      </div>
    </div>,
    document.body,
  );
}

function TrackedSearchRecommendation({
  product,
  reason,
  position,
  requestId,
  sessionId,
  authenticated,
  onClose,
}: {
  product: ProductCardDto;
  reason: string;
  position: number;
  requestId: string;
  sessionId: string;
  authenticated: boolean;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const attribution = useMemo<RecommendationAttribution | undefined>(
    () => requestId && sessionId
      ? {
          requestId,
          surface: "DISCOVERY",
          rankerVersion: "search-discovery-v1",
          position,
          sessionId,
        }
      : undefined,
    [position, requestId, sessionId],
  );

  useRecommendationImpression({
    elementRef: cardRef,
    attribution,
    item: { productId: product.id },
    authenticated,
  });

  const trackClick = () => {
    if (!attribution) return;
    storeRecommendationAttribution(product.id, attribution);
    void analyticsEventService.trackRecommendation(
      attribution,
      "CLICK",
      { productId: product.id },
      authenticated,
    ).catch(() => undefined);
  };

  return (
    <div ref={cardRef}>
      <Link
        href={`/product/${product.slug || product.id}`}
        onClick={() => {
          trackClick();
          onClose();
        }}
        className="flex items-center gap-3 p-2.5 transition-colors hover:bg-secondary/60"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {product.thumbnail
            ? <RemoteImage src={product.thumbnail} alt={product.name} className="h-full w-full object-cover" />
            : <ShoppingBag className="h-4 w-4 text-muted-foreground" />}
        </div>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{product.name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{reason}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold">{formatPrice(Number(product.discountPrice ?? product.price))}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  );
}

function TrackedSearchVendorRecommendation({
  item,
  position,
  requestId,
  sessionId,
  authenticated,
  onClose,
}: {
  item: Extract<SearchDiscoveryItemDto, { type: "vendor" }>;
  position: number;
  requestId: string;
  sessionId: string;
  authenticated: boolean;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const attribution = useMemo<RecommendationAttribution | undefined>(
    () => requestId && sessionId
      ? {
          requestId,
          surface: "DISCOVERY",
          rankerVersion: "search-discovery-v1",
          position,
          sessionId,
        }
      : undefined,
    [position, requestId, sessionId],
  );

  useRecommendationImpression({
    elementRef: cardRef,
    attribution,
    item: { vendorId: item.vendor.id },
    authenticated,
  });

  const trackVendorClick = () => {
    if (!attribution) return;
    void analyticsEventService.trackRecommendation(
      attribution,
      "CLICK",
      { vendorId: item.vendor.id },
      authenticated,
    ).catch(() => undefined);
  };

  const trackProductClick = (product: ProductCardDto) => {
    if (!attribution) return;
    storeRecommendationAttribution(product.id, attribution);
    void analyticsEventService.trackRecommendation(
      attribution,
      "CLICK",
      { productId: product.id, vendorId: item.vendor.id },
      authenticated,
    ).catch(() => undefined);
  };

  return (
    <div ref={cardRef} className="flex gap-3 p-3 transition-colors hover:bg-secondary/40">
      <Link
        href={`/vendor/${encodeURIComponent(item.vendor.storeSlug)}`}
        onClick={() => {
          trackVendorClick();
          onClose();
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted"
        aria-label={`Visit ${item.vendor.storeName}`}
      >
        {item.vendor.storeLogoUrl
          ? <RemoteImage src={item.vendor.storeLogoUrl} alt={`${item.vendor.storeName} logo`} className="h-full w-full object-cover" />
          : <Store className="h-4 w-4 text-muted-foreground" />}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/vendor/${encodeURIComponent(item.vendor.storeSlug)}`}
            onClick={() => {
              trackVendorClick();
              onClose();
            }}
            className="truncate text-sm font-semibold text-foreground hover:underline"
          >
            {item.vendor.storeName}
          </Link>
          <span className="shrink-0 text-[10px] text-muted-foreground">{item.reason}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {item.products.slice(0, 2).map((product) => (
            <Link
              key={product.id}
              href={`/product/${encodeURIComponent(product.slug || product.id)}`}
              onClick={() => {
                trackProductClick(product);
                onClose();
              }}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border/50 bg-background/70 p-1.5 hover:bg-secondary"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {product.thumbnail
                  ? <RemoteImage src={product.thumbnail} alt={product.name} className="h-full w-full object-cover" />
                  : <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium">{product.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{formatPrice(Number(product.discountPrice ?? product.price))}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
      <Link
        href={`/vendor/${encodeURIComponent(item.vendor.storeSlug)}`}
        onClick={() => {
          trackVendorClick();
          onClose();
        }}
        className="flex shrink-0 items-center text-muted-foreground hover:text-foreground"
        aria-label={`Open ${item.vendor.storeName}`}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
