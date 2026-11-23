"use client";

import type { AppNotification,NotificationType } from "@/api/services/notifications";
import { useNotifications } from "@/hooks/use-notifications";
import { notificationListPath } from "@/lib/notification-path";
import { formatRelativeTime, resolveNotificationDestination } from "@/lib/notification-open";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import {
AlertTriangle,
Bell,
CheckCheck,
CreditCard,
DollarSign,
Info,
Package,
SlidersHorizontal,
Users,
X,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/hooks/use-hydrated";
import { NotificationPreferencesDialog } from "@/components/domain/notification/NotificationPreferencesView";

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "ORDER_PLACED":
    case "ORDER_CONFIRMED":
    case "ORDER_SHIPPED":
    case "ORDER_DELIVERED":
    case "ORDER_CANCELLED":
      return <Package className="h-4 w-4 text-blue-500" />;
    case "VENDOR_FOLLOWED":
      return <Users className="h-4 w-4 text-indigo-500" />;
    case "PAYMENT_RECEIVED":
    case "PAYMENT_REFUNDED":
      return <CreditCard className="h-4 w-4 text-emerald-500" />;
    case "PAYOUT_PROCESSED":
      return <DollarSign className="h-4 w-4 text-amber-500" />;
    case "LOW_STOCK_ALERT":
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    default:
      return <Info className="h-4 w-4 text-muted-foreground" />;
  }
}

const MOBILE_QUERY = "(max-width: 639px)";
function subscribeMobile(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
function useIsMobile() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

export function NotificationBell({
  placement = "header",
}: {
  placement?: "header" | "bottom";
}) {
  // Open state is tied to the path it was opened on, so any navigation closes it.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const open = openFor === pathname;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setOpenFor((current) => {
        const wasOpen = current === pathname;
        const value = typeof next === "function" ? next(wasOpen) : next;
        return value ? pathname : null;
      });
    },
    [pathname],
  );
  const hydrated = useHydrated();
  // The bottom-nav bell lives inside a `backdrop-blur` element, which becomes
  // the containing block for `position: fixed` descendants and traps the
  // full-screen panel inside the nav. Portal it to <body> instead.
  const isMobile = useIsMobile();
  // Sticky/blurred headers trap fixed children too, so on phones the header's
  // popup is portaled as well.
  const usePortal = placement === "bottom" || isMobile;
  const { user, role, isAuthenticated } = useAuthStore();
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    fetchNotifications,
    fetchUnreadCount,
  } = useNotifications();

  // Fetch top 5 notifications only on-demand when user opens popover
  useEffect(() => {
    if (open) {
      void fetchUnreadCount();
      void fetchNotifications(undefined, 5);
    }
  }, [open, fetchNotifications, fetchUnreadCount]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [setOpen]);

  // Lock page scroll while the full-screen mobile panel is open.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 639px)").matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!isAuthenticated) return null;

  const activeRole = normalizeRole(role ?? user?.role) ?? "user";
  const allNotificationsHref = notificationListPath(activeRole);

  const recentNotifications = notifications.slice(0, 5);

  const handleNotificationClick = (notif: AppNotification) => {
    // Optimistic in the store: never make the tap wait on the network.
    if (!notif.isRead) void markAsRead(notif.id);
    setOpen(false);
    router.push(resolveNotificationDestination(notif, activeRole).href);
  };

  const panel = open ? (
    <>
          <div
            className="fixed inset-0 z-[55] bg-black/20 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            className={`${
              placement === "bottom"
                ? "fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] flex max-h-[70dvh] flex-col sm:inset-x-auto sm:right-4 sm:w-96 sm:max-w-sm"
                : "fixed inset-x-3 top-20 flex max-h-[70dvh] flex-col sm:inset-x-auto sm:block sm:max-w-md sm:w-96 sm:absolute sm:right-0 sm:top-full sm:mt-2"
            } z-[60] overflow-hidden rounded-2xl border bg-popover p-0 text-popover-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-150`}
          >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-secondary/30">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead()}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary sm:hidden"
            >
              <X className="h-5 w-5" />
            </button>
            </div>
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/60 sm:max-h-80 sm:flex-none">
            {isLoading && recentNotifications.length === 0 ? (
              <div className="divide-y divide-border/40 p-2 space-y-2">
                {[1, 2, 3].map((idx) => (
                  <div key={idx} className="flex items-start gap-3 p-2.5 animate-pulse">
                    <div className="h-8 w-8 rounded-full bg-muted/80 shrink-0" />
                    <div className="flex-1 space-y-1.5 py-0.5">
                      <div className="h-3 w-3/4 bg-muted/80 rounded" />
                      <div className="h-2.5 w-full bg-muted/50 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium text-foreground">
                  No notifications yet
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  We will notify you about your orders, payments, and account updates.
                </p>
              </div>
            ) : (
              recentNotifications.map((notif) => (
                <div
                  key={notif.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => handleNotificationClick(notif)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleNotificationClick(notif);
                    }
                  }}
                  className={`flex items-start gap-3 p-3.5 transition-colors cursor-pointer hover:bg-secondary/60 ${
                    !notif.isRead ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    {getNotificationIcon(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p
                        className={`text-xs font-semibold truncate ${
                          !notif.isRead ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {notif.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatRelativeTime(notif.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
                      {notif.message}
                    </p>
                  </div>
                  {!notif.isRead && (
                    <div className="h-2 w-2 rounded-full bg-primary shrink-0 self-center" />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border p-2 bg-secondary/20 flex items-center justify-between gap-2 px-3">
            <Link
              href={allNotificationsHref}
              onClick={() => setOpen(false)}
              className="flex-1 text-center rounded-xl py-1.5 text-xs font-semibold text-primary hover:bg-secondary transition-colors"
            >
              View all notifications
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setIsPreferencesOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground py-1.5 px-2 rounded-xl hover:bg-secondary transition-colors cursor-pointer shrink-0"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
              <span>Preferences</span>
            </button>
          </div>
        </div>
    </>
  ) : null;

  return (
    <div
      className={placement === "bottom" ? "relative flex min-w-0 justify-center" : "relative"}
      ref={dropdownRef}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        aria-expanded={open}
        className={`relative flex items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground focus:outline-hidden ${
          placement === "bottom"
            ? "min-h-11 w-full flex-col py-1"
            : "h-9 w-9"
        }`}
      >
        <Bell className="h-5 w-5" />
        {placement === "bottom" && (
          <span className="mt-1 text-[10px] tracking-tight">Alerts</span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-xs animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (usePortal ? (hydrated ? createPortal(panel, document.body) : null) : panel)}

      <NotificationPreferencesDialog
        open={isPreferencesOpen}
        onOpenChange={setIsPreferencesOpen}
      />
    </div>
  );
}
