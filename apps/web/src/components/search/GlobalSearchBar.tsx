"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { publicApi } from "@/api/core/client";
import { formatPrice } from "@/lib/util";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Layers3,
  Loader2,
  Search,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

interface SearchItemPayload {
  id?: string;
  name?: string;
  sku?: string;
  slug?: string;
  price?: number;
  imageUrl?: string | null;
  storeName?: string;
  storeSlug?: string;
  storeLogoUrl?: string | null;
  storeDescription?: string | null;
  iconUrl?: string | null;
  parentId?: string | null;
  parentName?: string | null;
  parentSlug?: string | null;
  path?: string | null;
  isSubcategory?: boolean;
}

export interface SearchResultItem {
  id: string;
  index: string;
  type: string;
  title: string;
  subtitle?: string;
  score: number;
  payload?: SearchItemPayload;
}

interface AutocompleteApiResponse {
  results: SearchResultItem[];
  pagination?: {
    totalItems: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface GlobalSearchBarProps {
  placeholder?: string;
  variant?: "hero" | "navbar";
  className?: string;
  autoFocus?: boolean;
}

export function GlobalSearchBar({
  placeholder = "Search NUTS",
  variant = "hero",
  className = "",
  autoFocus = false,
}: GlobalSearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim().toLocaleLowerCase(), 200);
  const isTypingAhead = query.trim().toLocaleLowerCase() !== debouncedQuery;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when requested (e.g. mobile search toggle)
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  // Close dropdown whenever pathname or search params change
  useEffect(() => {
    const timer = setTimeout(() => setIsOpen(false), 0);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation: Escape closes dropdown
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Unified Omnisearch Autocomplete Query
  const { data, isFetching } = useQuery({
    queryKey: ["global-search-autocomplete", debouncedQuery],
    queryFn: async ({ signal }) => {
      if (!debouncedQuery || debouncedQuery.length < 2) return null;

      try {
        const res = await publicApi.get<AutocompleteApiResponse>(
          "/search/autocomplete",
          {
            params: { query: debouncedQuery, limit: 12 },
            signal,
          }
        );

        const raw = res.data as unknown as Record<string, unknown> | SearchResultItem[];
        const items: SearchResultItem[] = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as Record<string, unknown>)?.data)
          ? ((raw as Record<string, unknown>).data as SearchResultItem[])
          : Array.isArray((raw as Record<string, unknown>)?.results)
          ? ((raw as Record<string, unknown>).results as SearchResultItem[])
          : [];
        return items;
      } catch (error) {
        // If query was superseded by a newer keystroke, let TanStack Query cancel cleanly without setting fallback
        if (signal?.aborted) {
          throw error;
        }

        return [];
      }
    },
    enabled: isOpen && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const searchTerm = query.trim();
    if (!searchTerm) return;
    setIsOpen(false);
    router.push(`/search?query=${encodeURIComponent(searchTerm)}`);
  };

  const results: SearchResultItem[] = useMemo(() => data ?? [], [data]);

  // Group search items into distinct, intuitive categories
  const productItems = useMemo(
    () => results.filter((r) => r.type === "product" || r.index === "products"),
    [results]
  );

  const vendorItems = useMemo(
    () => results.filter((r) => r.type === "vendor" || r.index === "vendors"),
    [results]
  );

  const categoryItems = useMemo(
    () => results.filter((r) => r.type === "category" || r.type === "subcategory" || r.index === "categories"),
    [results]
  );

  const hasResults = productItems.length > 0 || vendorItems.length > 0 || categoryItems.length > 0;

  const categoryHref = (item: SearchResultItem) => {
    const path = item.payload?.path || item.payload?.slug || "";
    return `/category/${String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  };

  const isHero = variant === "hero";
  const showDropdown = isOpen && query.trim().length >= 2;

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${isHero ? "max-w-2xl mx-auto" : "max-w-md"} ${className}`}
    >
      {/* Search Input Box */}
      <form
        onSubmit={handleSubmit}
        className={`relative flex items-center transition-all ${
          isHero
            ? "rounded-2xl border-2 border-border/80 bg-card/95 p-1.5 shadow-xl backdrop-blur-xl focus-within:border-black dark:focus-within:border-white focus-within:ring-2 focus-within:ring-black/10 dark:focus-within:ring-white/10"
            : "rounded-full border border-border/70 bg-secondary/60 px-3 py-1.5 focus-within:border-black dark:focus-within:border-white focus-within:bg-card focus-within:ring-2 focus-within:ring-black/10 dark:focus-within:ring-white/10"
        }`}
      >
        <div className="flex items-center pl-3 text-muted-foreground">
          {isFetching ? (
            <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin text-foreground" />
          ) : (
            <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          )}
        </div>

        <input
          ref={inputRef}
          autoFocus={autoFocus}
          id="global-search-input"
          name="search"
          type="text"
          value={query}
          maxLength={100}
          aria-label="Search marketplace"
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            aria-label="Clear search query"
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <button
          type="submit"
          aria-label="Submit search"
          className={`cursor-pointer ${
            isHero
              ? "rounded-xl bg-black dark:bg-white px-5 py-2.5 text-sm font-semibold text-white dark:text-black shadow-md hover:opacity-90 transition-all hover:scale-[1.02]"
              : "rounded-full bg-black/10 dark:bg-white/10 p-1.5 text-foreground hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors"
          }`}
        >
          {isHero ? "Search" : <ArrowRight className="h-4 w-4" />}
        </button>
      </form>

      {/* Live Search Results Dropdown Overlay */}
      {showDropdown && (
        <div
          className={`absolute top-full z-[100] mt-2 max-h-[75vh] overflow-y-auto rounded-2xl border border-border/80 bg-card/95 p-3 shadow-2xl backdrop-blur-xl animate-in fade-in-50 zoom-in-95 duration-150 ${
            isHero
              ? "left-0 right-0"
              : "left-0 right-0 sm:left-1/2 sm:-translate-x-1/2 sm:w-[500px]"
          }`}
        >
          {isTypingAhead ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-foreground" />
              Updating suggestions for “{query.trim()}”…
            </div>
          ) : isFetching ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-foreground" />
              Searching marketplace…
            </div>
          ) : !hasResults ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                No instant matches found for &ldquo;{query.trim()}&rdquo;
              </p>
              <p className="mt-1 text-xs">
                Try a category, vendor, or product name.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {categoryItems.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Layers3 className="h-3.5 w-3.5 text-foreground" /> Categories
                  </div>
                  <div className="space-y-1">
                    {categoryItems.slice(0, 4).map((item) => (
                      <Link key={item.id} href={categoryHref(item)} onClick={() => setIsOpen(false)} className="flex min-w-0 items-center gap-2.5 rounded-xl p-2 text-sm transition-colors hover:bg-secondary/70">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-secondary/70">
                          {item.payload?.imageUrl || item.payload?.iconUrl ? (
                            <RemoteImage src={item.payload.imageUrl || item.payload.iconUrl || ""} alt="" className="h-full w-full object-contain p-1" />
                          ) : (
                            <Layers3 className="h-4 w-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.title}</span>
                          {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Products Section */}
              {productItems.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 text-foreground" />
                      Products
                    </span>
                    <span>{productItems.length} found</span>
                  </div>

                  <div className="space-y-1">
                    {productItems.slice(0, 4).map((p) => {
                      const slug = p.payload?.slug || p.id;
                      const img = p.payload?.imageUrl || null;
                      const price = p.payload?.price;

                      return (
                        <Link
                          key={p.id}
                          href={`/product/${slug}`}
                          onClick={() => setIsOpen(false)}
                          className="flex min-w-0 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/70 group"
                        >
                          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted flex items-center justify-center border border-border/50">
                            {img ? (
                              <RemoteImage
                                src={img}
                                alt={p.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <ShoppingBag className="h-5 w-5 text-muted-foreground/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate group-hover:underline">
                              {p.title}
                            </p>
                            {price !== undefined && (
                              <p className="text-xs font-semibold text-foreground">
                                {formatPrice(Number(price))}
                              </p>
                            )}
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground/60 shrink-0 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Verified Vendors Section */}
              {vendorItems.length > 0 && (
                <div className="border-t border-border/50 pt-3">
                  <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-foreground" />
                    Vendors
                  </div>
                  <div className="space-y-1">
                    {vendorItems.slice(0, 2).map((v) => {
                      const storeSlug = v.payload?.storeSlug || v.id;
                      const logo = v.payload?.storeLogoUrl ?? null;
                      return (
                        <Link
                          key={v.id}
                          href={`/vendor/${storeSlug}`}
                          onClick={() => setIsOpen(false)}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/70 group"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-secondary text-xs font-semibold text-foreground">
                              {logo ? (
                                <RemoteImage
                                  src={logo}
                                  alt={v.title}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                v.title[0]?.toUpperCase()
                              )}
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground group-hover:underline">{v.title}</span>
                              {v.payload?.storeDescription && <span className="block truncate text-xs text-muted-foreground">{v.payload.storeDescription}</span>}
                            </span>
                          </div>
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-foreground transition-transform group-hover:translate-x-0.5">
                            View Store →
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Full Search Action Link */}
          <Link
            href={`/search?query=${encodeURIComponent(query.trim())}`}
            onClick={() => setIsOpen(false)}
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-xs sm:text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
          >
            View all results for &ldquo;{query.trim()}&rdquo;
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

    </div>
  );
}
