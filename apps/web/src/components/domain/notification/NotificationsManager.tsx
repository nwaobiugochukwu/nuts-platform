"use client";

import type { AppNotification,NotificationType } from "@/api/notifications";
import { Button } from "@/component/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import {
  notificationDetailPath,
  resolveNotificationTargetUrl,
} from "@/lib/notification-path";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import {
AlertTriangle,
ArrowLeft,
Bell,
Check,
CheckCheck,
CreditCard,
DollarSign,
ExternalLink,
Info,
Package,
Search,
SlidersHorizontal,
Trash2,
Users,
X,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";
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
      return <Package className="h-5 w-5 text-blue-500" />;
    case "VENDOR_FOLLOWED":
      return <Users className="h-5 w-5 text-indigo-500" />;
    case "PAYMENT_RECEIVED":
      return <CreditCard className="h-5 w-5 text-emerald-500" />;
    case "PAYMENT_REFUNDED":
      return <CreditCard className="h-5 w-5 text-emerald-500" />;
    case "PAYMENT_FAILED":
      return <CreditCard className="h-5 w-5 text-rose-500" />;
    case "PAYOUT_PROCESSED":
      return <DollarSign className="h-5 w-5 text-amber-500" />;
    case "LOW_STOCK_ALERT":
      return <AlertTriangle className="h-5 w-5 text-orange-500" />;
    default:
      return <Info className="h-5 w-5 text-muted-foreground" />;
  }
}

const notificationTypeLabels: Record<NotificationType, string> = {
  ORDER_PLACED: "Order placed",
  ORDER_CONFIRMED: "Order confirmed",
  ORDER_SHIPPED: "Order shipped",
  ORDER_DELIVERED: "Order delivered",
  ORDER_CANCELLED: "Order cancelled",
  PAYMENT_RECEIVED: "Payment received",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_REFUNDED: "Refund processed",
  PAYOUT_PROCESSED: "Payout processed",
  LOW_STOCK_ALERT: "Low stock",
  VENDOR_FOLLOWED: "New follower",
  SYSTEM_ANNOUNCEMENT: "System announcement",
};

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

function formatFullDate(dateString: string): string {
  const d = new Date(dateString);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function NotificationsManager({
  title = "Notifications",
  subtitle = "Platform alerts and updates",
  backHref,
  backLabel,
}: NotificationsManagerProps) {
  const router = useRouter();
  const rawRole = useAuthStore((state) => state.role ?? state.user?.role);
  const role = normalizeRole(rawRole) ?? "user";
  const [filter, setFilter] = useState<"all" | "unread" | "orders" | "payments" | "system">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
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

  // Load notifications initially
  useEffect(() => {
    void fetchNotifications(undefined, 50, false);
  }, [fetchNotifications]);

  // Compute accurate counts across the loaded dataset without destroying other tab counters
  const allCount = notifications.length;
  const unreadItemsCount = notifications.filter((n) => !n.isRead).length;
  const ordersCount = notifications.filter(
    (n) => getNotificationCategory(n) === "orders",
  ).length;
  const paymentsCount = notifications.filter(
    (n) => getNotificationCategory(n) === "payments",
  ).length;
  const systemCount = notifications.filter(
    (n) => getNotificationCategory(n) === "system",
  ).length;

  const categoryFiltered = notifications.filter((n) => {
    switch (filter) {
      case "unread":
        return !n.isRead;
      case "orders":
        return getNotificationCategory(n) === "orders";
      case "payments":
        return getNotificationCategory(n) === "payments";
      case "system":
        return getNotificationCategory(n) === "system";
      case "all":
      default:
        return true;
    }
  });

  const filteredNotifications = searchQuery.trim()
    ? categoryFiltered.filter((n) => {
        const q = searchQuery.toLowerCase().trim();
        return (
          (n.title && n.title.toLowerCase().includes(q)) ||
          (n.message && n.message.toLowerCase().includes(q)) ||
          (n.type && n.type.toLowerCase().includes(q)) ||
          (n.metadata?.orderId && String(n.metadata.orderId).toLowerCase().includes(q)) ||
          (n.metadata?.paymentId && String(n.metadata.paymentId).toLowerCase().includes(q))
        );
      })
    : categoryFiltered;

  const handleAction = async (notif: AppNotification) => {
    if (!notif.isRead) {
      await markAsRead(notif.id);
    }
    router.push(notificationDetailPath(role, notif.id));
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-2 sm:py-6 px-1 min-[360px]:px-2 sm:px-4">
      {/* Top Bar with back link & actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="min-w-0 flex-1">
          {backHref && (
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span>Back to {backLabel || "Home"}</span>
            </Link>
          )}
          <h1 className="text-lg min-[360px]:text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground break-words">
            {title}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 leading-relaxed">
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsPreferencesOpen(true)}
            className="w-full sm:w-auto gap-2 text-xs h-9 rounded-xl font-medium border-border hover:bg-secondary transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            <span>Notification Preferences</span>
          </Button>
        </div>
      </div>

      {sseRetryExhausted && (
        <div
          role="status"
          className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">
            Live notification updates are paused. Your notification history is still accessible.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retryStream}
            className="text-xs"
          >
            Reconnect Stream
          </Button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="space-y-3.5 pb-4 border-b border-border">
        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted-foreground/70" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notifications by keyword, title, order ID..."
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-10 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 [scrollbar-width:none]">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter === "all"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              All ({allCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("unread")}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter === "unread"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              Unread ({unreadItemsCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("orders")}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter === "orders"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              Orders ({ordersCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("payments")}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter === "payments"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              Payments ({paymentsCount})
            </button>
            {systemCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter("system")}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  filter === "system"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                System ({systemCount})
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {unreadItemsCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllAsRead()}
                className="gap-1.5 text-xs h-8 cursor-pointer rounded-lg"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Mark all as read</span>
              </Button>
            )}
            {notifications.some((n) => n.isRead) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearAll()}
                className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive cursor-pointer rounded-lg"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear read</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="mt-5 sm:mt-6 space-y-3">
        {isLoading && notifications.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 sm:h-24 rounded-2xl bg-secondary/50 animate-pulse"
              />
            ))}
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border py-12 sm:py-16 px-4 text-center">
            <Bell className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              {searchQuery ? "No matching notifications" : "No notifications found"}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `No notifications found matching "${searchQuery}". Try a different keyword.`
                : filter === "unread"
                ? "You're all caught up! No unread messages."
                : `You don't have any ${filter === "all" ? "" : filter + " "}notifications yet.`}
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
                className="mt-4 text-xs cursor-pointer"
              >
                Show all notifications
              </Button>
            )}
          </div>
        ) : (
          filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              role="link"
              tabIndex={0}
              onClick={() => handleAction(notif)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void handleAction(notif);
                }
              }}
              className={`group relative flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border transition-all cursor-pointer ${
                !notif.isRead
                  ? "bg-card border-primary/25 shadow-xs hover:border-primary/50"
                  : "bg-card/40 border-border/70 hover:border-border hover:bg-card/70"
              }`}
            >
              <div className="flex items-start gap-2.5 sm:gap-4 flex-1 min-w-0">
                <div className="flex h-9 w-9 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-secondary/80 mt-0.5">
                  {getNotificationIcon(notif.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                    <span
                      className={`text-xs min-[360px]:text-sm sm:text-base font-semibold tracking-tight break-words ${
                        !notif.isRead ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {notif.title}
                    </span>
                    {!notif.isRead && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] min-[360px]:text-[10px] font-bold bg-primary text-primary-foreground">
                        NEW
                      </span>
                    )}
                    {getNotificationCategory(notif) === "payments" ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] min-[360px]:text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <CreditCard className="h-2.5 w-2.5" /> Payment
                      </span>
                    ) : getNotificationCategory(notif) === "orders" ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] min-[360px]:text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                        <Package className="h-2.5 w-2.5" /> Order
                      </span>
                    ) : null}
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] min-[360px]:text-[10px] font-medium bg-secondary text-secondary-foreground">
                      {notificationTypeLabels[notif.type]}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed break-words">
                    {notif.message}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] sm:text-xs text-muted-foreground">
                      {formatFullDate(notif.createdAt)}
                    </span>

                    {(() => {
                      const targetUrl = resolveNotificationTargetUrl(notif, role);
                      if (!targetUrl) return null;
                      const isOrder = getNotificationCategory(notif) === "orders";
                      return (
                        <Link
                          href={targetUrl}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!notif.isRead) {
                              void markAsRead(notif.id);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          {isOrder ? "View Order" : "Open Page"}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 self-end sm:self-start shrink-0 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                {!notif.isRead && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      void markAsRead(notif.id);
                    }}
                    title="Mark as read"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteNotification(notif.id);
                  }}
                  title="Delete notification"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {hasNextPage && nextCursor && (
        <div className="mt-8 flex justify-center pb-8">
          <Button
            variant="outline"
            disabled={isLoading}
            onClick={() =>
              fetchNotifications(nextCursor, 20, true, {
                ...(filter === "unread" ? { unreadOnly: true } : {}),
                ...(filter === "orders" || filter === "payments"
                  ? { category: filter }
                  : {}),
              })
            }
            className="rounded-full px-6 py-2 text-xs font-semibold"
          >
            {isLoading ? "Loading..." : "Load More Notifications"}
          </Button>
        </div>
      )}

      <NotificationPreferencesDialog
        open={isPreferencesOpen}
        onOpenChange={setIsPreferencesOpen}
      />
    </div>
  );
}
