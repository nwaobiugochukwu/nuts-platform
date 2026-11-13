"use client";

import { notificationsApiForRole, type AppNotification } from "@/api/modules/notifications";
import Link from "@/components/navigation/AppLink";
import { useAuthStore } from "@/zustand/auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, PackageCheck, Tag } from "lucide-react";

const SAVED_ITEM_ALERT_TYPES = new Set<string>(["PRICE_DROP", "RESTOCKED"]);

export function SavedWishlistUpdatesSection() {
  const userId = useAuthStore((state) => state.user?.id);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const isCustomer = isAuthenticated && canPurchase;

  const { data: updates = [] } = useQuery({
    queryKey: ["home", "saved-item-updates", userId],
    queryFn: async ({ signal }) => {
      const response = await notificationsApiForRole("user").list(
        { limit: 50, unreadOnly: true },
        signal,
      );
      return response.data.filter((notification) => SAVED_ITEM_ALERT_TYPES.has(notification.type)).slice(0, 4);
    },
    enabled: isCustomer && Boolean(userId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (updates.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="saved-item-updates-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">For your saved items</p>
          <h2 id="saved-item-updates-heading" className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Price drops and restocks
          </h2>
        </div>
        <Link href="/wishlist" className="shrink-0 text-sm font-semibold text-foreground underline-offset-4 hover:underline">
          View wishlist
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {updates.map((notification: AppNotification) => {
          const isPriceDrop = (notification.type as string) === "PRICE_DROP";
          const href = notification.actionUrl || "/wishlist";
          const Icon = isPriceDrop ? Tag : PackageCheck;

          return (
            <Link
              key={notification.id}
              href={href}
              className="group flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-secondary/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{notification.title}</span>
                <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">{notification.message}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
