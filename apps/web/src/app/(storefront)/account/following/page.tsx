"use client";

import { vendorFollowingService } from "@/api/modules/vendor";
import { RemoteImage } from "@/component/ui/RemoteImage";
import { Input } from "@/components/ui/input";
import Link from "@/components/navigation/AppLink";
import { useVendorFollowing, vendorFollowKeys } from "@/hooks/use-vendor-following";
import { useAuthStore } from "@/zustand/auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, Search, Store, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

const PAGE_SIZE = 20;

export default function AccountFollowingPage() {
  const userId = useAuthStore((state) => state.user?.id);
  const { isPending, setFollowing } = useVendorFollowing();
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const search = useDeferredValue(searchInput.trim());
  const queryKey = [...vendorFollowKeys(userId).manage, search, page, PAGE_SIZE] as const;
  const followsQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => (await vendorFollowingService.manage({ search, page, limit: PAGE_SIZE }, signal)).data,
    enabled: Boolean(userId),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const followed = followsQuery.data?.data ?? [];
  const meta = followsQuery.data?.meta;

  const handleUnfollow = async (vendor: (typeof followed)[number]["vendor"]) => {
    try {
      await setFollowing(vendor, false);
      toast.success(`Unfollowed ${vendor.storeName}`);
    } catch {
      toast.error(`Could not unfollow ${vendor.storeName}. Please try again.`);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-7 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <Link href="/account" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Account
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your stores</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Following</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {meta?.followingCount ?? 0} {meta?.followingCount === 1 ? "store" : "stores"} followed
            </p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              aria-label="Search followed stores"
              placeholder="Search your stores"
              className="h-11 rounded-full pl-10 pr-10"
            />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {followsQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-secondary" />)}
        </div>
      ) : followsQuery.isError ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">We couldn’t load your followed stores.</p>
          <button type="button" onClick={() => void followsQuery.refetch()} className="mt-3 text-sm font-semibold text-foreground underline">Try again</button>
        </div>
      ) : followed.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
          <Store className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {search ? "No followed stores match that search" : "You aren’t following any stores yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {search ? "Try another store name." : "Follow stores you like to keep their latest picks close."}
          </p>
          {!search && <Link href="/vendor" className="mt-5 inline-flex rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background">Discover stores</Link>}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {followed.map(({ vendor }) => (
              <article key={vendor.id} className="flex min-w-0 items-center gap-4 rounded-2xl border border-border bg-card p-4">
                <Link href={`/vendor/${encodeURIComponent(vendor.storeSlug)}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
                    {vendor.storeLogoUrl
                      ? <RemoteImage src={vendor.storeLogoUrl} alt={`${vendor.storeName} logo`} className="h-full w-full object-cover" />
                      : <Store className="h-5 w-5 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <span className="truncate">{vendor.storeName}</span>
                      {vendor.isVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified store" />}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{vendor.storeDescription || "Browse this store’s products."}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void handleUnfollow(vendor)}
                  disabled={isPending(vendor.id)}
                  className="shrink-0 rounded-full border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  {isPending(vendor.id) ? "Updating…" : "Following"}
                </button>
              </article>
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border pt-5">
              <p className="text-sm text-muted-foreground">Page {meta.page} of {meta.totalPages}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} className="rounded-full border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">Previous</button>
                <button type="button" onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))} disabled={page >= meta.totalPages} className="rounded-full border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
