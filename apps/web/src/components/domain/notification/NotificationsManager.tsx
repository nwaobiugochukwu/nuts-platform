"use client";

import type { AppNotification,NotificationType } from "@/api/services/notifications";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import {
  formatRelativeTime,
  notificationDayGroup,
  resolveNotificationDestination,
  type NotificationDayGroup,
} from "@/lib/notification-open";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { useNotificationsStore } from "@/zustand/notifications";
import {
AlertTriangle,
Bell,
Check,
CheckCheck,
ChevronRight,
CreditCard,
DollarSign,
Info,
MoreHorizontal,
Package,
Search,
SlidersHorizontal,
Trash2,
Users,
X,
} from "lucide-react";
import { BackLink } from "@/components/navigation/BackLink";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NotificationPreferencesDialog } from "@/components/domain/notification/NotificationPreferencesView";

interface NotificationsManagerProps {
  title?: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "ORDER_PLACED":
    case "ORDER_CONFIRMED":
    case "ORDER_SHIPPED":
    case "ORDER_DELIVERED":
    case "ORDER_CANCELLED":
      return <Package className="h-[18px] w-[18px] text-blue-500" />;
    case "VENDOR_FOLLOWED":
      return <Users className="h-[18px] w-[18px] text-indigo-500" />;
    case "PAYMENT_RECEIVED":
      return <CreditCard className="h-[18px] w-[18px] text-emerald-500" />;
    case "PAYMENT_REFUNDED":
      return <CreditCard className="h-[18px] w-[18px] text-emerald-500" />;
    case "PAYMENT_FAILED":
      return <CreditCard className="h-[18px] w-[18px] text-rose-500" />;
    case "PAYOUT_PROCESSED":
      return <DollarSign className="h-[18px] w-[18px] text-amber-500" />;
    case "LOW_STOCK_ALERT":
      return <AlertTriangle className="h-[18px] w-[18px] text-orange-500" />;
    default:
      return <Info className="h-[18px] w-[18px] text-muted-foreground" />;
  }
}

const categoryNotificationTypes = {
  orders: new Set<NotificationType>([
    "ORDER_PLACED",
    "ORDER_CONFIRMED",
    "ORDER_SHIPPED",
    "ORDER_DELIVERED",
    "ORDER_CANCELLED",
  ]),
  payments: new Set<NotificationType>([
    "PAYMENT_RECEIVED",
    "PAYMENT_FAILED",
    "PAYMENT_REFUNDED",
    "PAYOUT_PROCESSED",
  ]),
};

export function getNotificationCategory(
  notif: AppNotification,
): "orders" | "payments" | "system" | "general" {
  if (
    categoryNotificationTypes.payments.has(notif.type) ||
    notif.type === "PAYMENT_RECEIVED" ||
    notif.type === "PAYMENT_FAILED" ||
    notif.type === "PAYOUT_PROCESSED"
  ) {
    return "payments";
  }

  if (
    categoryNotificationTypes.orders.has(notif.type) ||
    notif.type === "ORDER_PLACED" ||
    notif.type === "ORDER_CONFIRMED" ||
    notif.type === "ORDER_SHIPPED" ||
    notif.type === "ORDER_DELIVERED" ||
    notif.type === "ORDER_CANCELLED"
  ) {
    return "orders";
  }

  if (
    notif.type === "LOW_STOCK_ALERT" ||
    notif.type === "SYSTEM_ANNOUNCEMENT"
  ) {
    return "system";
  }

  const title = (notif.title || "").toLowerCase();
  const msg = (notif.message || "").toLowerCase();
  if (
    title.includes("payment") ||
    title.includes("payout") ||
    title.includes("refund") ||
    msg.includes("payment") ||
    notif.metadata?.paymentId
  ) {
    return "payments";
  }
  if (
    title.includes("order") ||
    title.includes("shipped") ||
    title.includes("delivered") ||
    notif.metadata?.orderId
  ) {
    return "orders";
  }
  if (
    title.includes("stock") ||
    title.includes("system") ||
    title.includes("alert") ||
    title.includes("security")
  ) {
    return "system";
  }

  return "general";
}

type InboxFilter = "all" | "unread" | "orders" | "payments" | "system";

const GROUP_ORDER: NotificationDayGroup[] = ["Today", "Yesterday", "This week", "Earlier"];

const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "orders", label: "Orders" },
  { value: "payments", label: "Payments" },
  { value: "system", label: "System" },
];

export function NotificationsManager({
  title = "Notifications",
  subtitle = "Platform alerts and updates",
  backHref,
  backLabel,
}: NotificationsManagerProps) {
  const router = useRouter();
  const rawRole = useAuthStore((state) => state.role ?? state.user?.role);
  const role = normalizeRole(rawRole) ?? "user";
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const {
    notifications,
    isLoading,
    sseRetryExhausted,
    hasNextPage,
    nextCursor,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    fetchNotifications,
    retryStream,
  } = useNotifications();

  // Coming back from an order or a message must not reset the list (and scroll
  // position): the live stream keeps the store current, so only load when empty.
  useEffect(() => {
    if (useNotificationsStore.getState().notifications.length === 0) {
      void fetchNotifications(undefined, 30, false);
    }
  }, [fetchNotifications]);

  // Close the row menu on outside tap / Escape.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const availableFilters = FILTERS.filter(
    ({ value }) =>
      value === "all" ||
      value === "unread" ||
      notifications.some((n) => getNotificationCategory(n) === value),
  );

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notifications.filter((n) => {
      if (filter === "unread" && n.isRead) return false;
      if (
        (filter === "orders" || filter === "payments" || filter === "system") &&
        getNotificationCategory(n) !== filter
      ) {
        return false;
      }
      if (!q) return true;
      return [n.title, n.message, n.type, n.metadata?.orderId, n.metadata?.paymentId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [notifications, filter, searchQuery]);

  const groups = useMemo(() => {
    const map = new Map<NotificationDayGroup, AppNotification[]>();
    for (const item of visible) {
      const key = notificationDayGroup(item.createdAt);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return GROUP_ORDER.filter((key) => map.has(key)).map((key) => ({
      key,
      items: map.get(key)!,
    }));
  }, [visible]);

  const loadMore = () => {
    if (!hasNextPage || !nextCursor || isLoading) return;
    void fetchNotifications(nextCursor, 20, true, {
      ...(filter === "unread" ? { unreadOnly: true } : {}),
      ...(filter === "orders" || filter === "payments" ? { category: filter } : {}),
    });
  };

  // Infinite scroll: fetch the next page as the end of the list nears.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && loadMore(),
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNextPage, nextCursor, isLoading, filter]);

  // One tap: mark read and open what the notification is about.
  const open = (notif: AppNotification) => {
    if (!notif.isRead) void markAsRead(notif.id);
    router.push(resolveNotificationDestination(notif, role).href);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-2 sm:px-4 sm:py-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {backHref && (
            <BackLink
              fallbackHref={backHref}
              fallbackLabel={backLabel || "Home"}
              className="mb-1 -ml-1 px-1 text-xs"
            />
          )}
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search notifications"
            aria-pressed={searchOpen}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setIsPreferencesOpen(true)}
            aria-label="Notification preferences"
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            autoFocus
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notifications or order IDs"
            className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {sseRetryExhausted && (
        <div
          role="status"
          className="mb-3 flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
        >
          <p>Live updates are paused. Your history is still available.</p>
          <Button type="button" variant="outline" size="sm" onClick={retryStream} className="h-9 text-xs">
            Reconnect
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div
          role="tablist"
          aria-label="Filter notifications"
          className="-mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]"
        >
          {availableFilters.map(({ value, label }) => {
            const active = filter === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(value)}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
                }`}
              >
                {label}
                {value === "unread" && unreadCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-bold ${
                      active ? "bg-background/20" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllAsRead()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            <CheckCheck className="h-4 w-4" />
            <span className="hidden min-[400px]:inline">Mark all read</span>
          </button>
        )}
      </div>

      {/* List */}
      <div className="mt-2">
        {isLoading && notifications.length === 0 ? (
          <div className="space-y-1 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex animate-pulse items-start gap-3 p-3">
                <div className="h-10 w-10 shrink-0 rounded-full bg-secondary" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3.5 w-2/3 rounded bg-secondary" />
                  <div className="h-3 w-full rounded bg-secondary/70" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground/60">
              <Bell className="h-6 w-6" />
            </span>
            <h2 className="text-base font-semibold text-foreground">
              {searchQuery
                ? "No matches"
                : filter === "unread"
                  ? "You're all caught up"
                  : "Nothing here yet"}
            </h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              {searchQuery
                ? `Nothing matches "${searchQuery}".`
                : filter === "unread"
                  ? "No unread notifications."
                  : "Order updates, payments and account alerts will show up here."}
            </p>
            {(filter !== "all" || searchQuery) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilter("all");
                  setSearchQuery("");
                }}
                className="mt-4 h-10 rounded-full px-5 text-xs"
              >
                Show everything
              </Button>
            )}
          </div>
        ) : (
          groups.map(({ key, items }) => (
            <section key={key} aria-label={key}>
              <h2 className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {key}
              </h2>
              <ul className="divide-y divide-border/50">
                {items.map((notif) => {
                  const destination = resolveNotificationDestination(notif, role);
                  const menuOpen = menuFor === notif.id;
                  return (
                    <li key={notif.id} className="relative">
                      <div
                        role="link"
                        tabIndex={0}
                        onClick={() => open(notif)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            open(notif);
                          }
                        }}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3.5 pr-12 transition-colors active:bg-secondary/80 hover:bg-secondary/50 ${
                          notif.isRead ? "" : "bg-primary/[0.04]"
                        }`}
                      >
                        <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                          {getNotificationIcon(notif.type)}
                          {!notif.isRead && (
                            <span
                              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-primary"
                              aria-label="Unread"
                            />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={`truncate text-sm ${
                                notif.isRead
                                  ? "font-medium text-muted-foreground"
                                  : "font-semibold text-foreground"
                              }`}
                            >
                              {notif.title}
                            </p>
                            <time
                              dateTime={notif.createdAt}
                              className="shrink-0 text-[11px] text-muted-foreground"
                            >
                              {formatRelativeTime(notif.createdAt)}
                            </time>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
                            {notif.message}
                          </p>
                          {destination.kind === "target" && (
                            <p className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-primary">
                              {getNotificationCategory(notif) === "orders" ? "View order" : "Open"}
                              <ChevronRight className="h-3.5 w-3.5" />
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor(menuOpen ? null : notif.id);
                        }}
                        className="absolute right-1 top-2.5 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <MoreHorizontal className="h-[18px] w-[18px]" />
                      </button>
                      {menuOpen && (
                        <div
                          role="menu"
                          onClick={(event) => event.stopPropagation()}
                          className="absolute right-2 top-12 z-20 w-48 rounded-xl border border-border bg-popover p-1 text-sm shadow-xl"
                        >
                          {!notif.isRead && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                void markAsRead(notif.id);
                                setMenuFor(null);
                              }}
                              className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left font-medium text-foreground hover:bg-secondary"
                            >
                              <Check className="h-4 w-4" /> Mark as read
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              void deleteNotification(notif.id);
                              setMenuFor(null);
                            }}
                            className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left font-medium text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      {hasNextPage && nextCursor && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <Button
            variant="outline"
            disabled={isLoading}
            onClick={loadMore}
            className="h-10 rounded-full px-6 text-xs font-semibold"
          >
            {isLoading ? "Loading..." : "Load older"}
          </Button>
        </div>
      )}

      {notifications.some((n) => n.isRead) && (
        <div className="flex justify-center pb-8 pt-2">
          <button
            type="button"
            onClick={() => void clearAll()}
            className="flex h-10 items-center gap-1.5 rounded-full px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear read notifications
          </button>
        </div>
      )}

      <NotificationPreferencesDialog open={isPreferencesOpen} onOpenChange={setIsPreferencesOpen} />
    </div>
  );
}
