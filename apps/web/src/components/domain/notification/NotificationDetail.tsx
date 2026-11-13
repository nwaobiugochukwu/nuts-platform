"use client";

import type { AppNotification, NotificationType } from "@/api/notifications";
import { notificationsApiForRole } from "@/api/notifications";
import { Button } from "@/component/ui/button";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { queryKey } from "@/lib/query-key";
import {
  notificationListPath,
  resolveNotificationTargetUrl,
} from "@/lib/notification-path";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { useNotificationsStore } from "@/zustand/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Package,
  Trash2,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function getNotificationPresentation(type: NotificationType) {
  switch (type) {
    case "ORDER_PLACED":
    case "ORDER_CONFIRMED":
    case "ORDER_SHIPPED":
    case "ORDER_DELIVERED":
    case "ORDER_CANCELLED":
      return {
        label: "Order update",
        Icon: Package,
        iconClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
      };
    case "PAYMENT_RECEIVED":
    case "PAYMENT_FAILED":
    case "PAYMENT_REFUNDED":
    case "PAYOUT_PROCESSED":
      return {
        label: type === "PAYOUT_PROCESSED" ? "Payout update" : "Payment update",
        Icon: CreditCard,
        iconClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "LOW_STOCK_ALERT":
      return {
        label: "Inventory alert",
        Icon: AlertTriangle,
        iconClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "SYSTEM_ANNOUNCEMENT":
      return {
        label: "Announcement",
        Icon: Bell,
        iconClass: "bg-primary/10 text-primary",
      };
    case "VENDOR_FOLLOWED":
      return {
        label: "Store update",
        Icon: Bell,
        iconClass: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
      };
    default:
      return {
        label: "Notification",
        Icon: Bell,
        iconClass: "bg-primary/10 text-primary",
      };
  }
}

function getMetadataString(
  metadata: AppNotification["metadata"],
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function formatNotificationDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function NotificationDetailSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading notification"
      className="mx-auto w-full max-w-3xl space-y-5 py-4 sm:py-8"
    >
      <div className="h-9 w-36 animate-pulse rounded-lg bg-muted" />
      <div className="space-y-6 rounded-2xl border border-border bg-card p-5 sm:p-8">
        <div className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
        <div className="h-8 w-3/4 animate-pulse rounded-lg bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </main>
  );
}

export function NotificationDetail({ id }: { id: string }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const rawRole = useAuthStore((state) => state.role ?? state.user?.role);
  const role = normalizeRole(rawRole) ?? "user";
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notification = useQuery({
    queryKey: [...queryKey.notification.detail(`${role}:${user?.id ?? ""}`, id)],
    queryFn: async ({ signal }) =>
      (await notificationsApiForRole(role).getById(id, signal)).data,
    enabled: isAuthenticated && Boolean(user?.id && id),
  });

  const markAsRead = useNotificationsStore((state) => state.markAsRead);
  const deleteNotification = useNotificationsStore(
    (state) => state.deleteNotification,
  );
  const backHref = notificationListPath(role);
  const item = notification.data;
  const markRequested = useRef<string | null>(null);

  useEffect(() => {
    if (
      notification.data &&
      !notification.data.isRead &&
      markRequested.current !== notification.data.id
    ) {
      markRequested.current = notification.data.id;
      void markAsRead(notification.data.id, true);
    }
  }, [notification.data, markAsRead]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const deleteMutation = useMutation({
    mutationFn: () => notificationsApiForRole(role).delete(id),
    onSuccess: () => {
      deleteNotification(id);
      toast.success("Notification deleted");
      router.push(backHref);
    },
    onError: () => toast.error("Could not delete this notification. Please try again."),
  });

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success("Reference copied");
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      toast.error("Could not copy the reference");
    }
  };

  if (notification.isPending) return <NotificationDetailSkeleton />;

  if (notification.isError || !item) {
    return (
      <main className="mx-auto w-full max-w-3xl py-8 sm:py-12">
        <section className="rounded-2xl border border-border bg-card px-5 py-12 text-center sm:px-8">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            We couldn’t load this notification
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            It may have been removed, or there may be a temporary connection issue.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link href={backHref}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Back to notifications
              </Link>
            </Button>
            {notification.isError && (
              <Button type="button" onClick={() => void notification.refetch()}>
                Try again
              </Button>
            )}
          </div>
        </section>
      </main>
    );
  }

  const presentation = getNotificationPresentation(item.type);
  const Icon = presentation.Icon;
  const actionPath = resolveNotificationTargetUrl(item, role);
  const orderId = getMetadataString(item.metadata, "orderId", "order_id");
  const orderNumber = getMetadataString(item.metadata, "orderNumber", "order_number");
  const paymentId = getMetadataString(item.metadata, "paymentId", "payment_id");
  const referenceId = orderId ?? paymentId;
  const referenceLabel = orderId ? "Order reference" : paymentId ? "Payment reference" : "Related item";
  const actionLabel = orderId
    ? "View order"
    : paymentId
      ? "View payment"
      : "Open related page";
  const isUrgent = item.priority === "HIGH" || item.priority === "URGENT";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 py-3 sm:space-y-5 sm:py-8">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 gap-2 px-2 text-muted-foreground hover:text-foreground"
        >
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>All notifications</span>
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete notification"
          title="Delete notification"
          onClick={() => setIsDeleteOpen(true)}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <div className="space-y-6 p-5 sm:p-8">
          <header className="flex items-start gap-3 sm:gap-4">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${presentation.iconClass}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {presentation.label}
                </span>
                {isUrgent && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {item.priority === "URGENT" ? "Urgent" : "High priority"}
                  </span>
                )}
              </div>
              <p className="flex flex-wrap items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <time dateTime={item.createdAt}>{formatNotificationDate(item.createdAt)}</time>
              </p>
            </div>
          </header>

          <div className="space-y-3 border-t border-border/70 pt-6">
            <h1 className="break-words text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
              {item.title}
            </h1>
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
              {item.message}
            </p>
          </div>
        </div>

        {(actionPath || referenceId || orderNumber) && (
          <section
            aria-label="Related information"
            className="flex flex-col gap-4 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {orderId ? "Related order" : paymentId ? "Related payment" : "Related item"}
              </p>
              {orderNumber && (
                <p className="break-all text-sm font-semibold text-foreground">
                  Order #{orderNumber}
                </p>
              )}
              {referenceId && (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {referenceLabel}: {referenceId}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(referenceId, referenceId)}
                    aria-label={`Copy ${referenceLabel.toLowerCase()}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copiedKey === referenceId ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              )}
            </div>
            {actionPath && (
              <Button asChild className="w-full shrink-0 gap-2 sm:w-auto">
                <Link href={actionPath}>
                  {actionLabel}
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </section>
        )}
      </article>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete notification?"
        description="This removes the notification from your inbox. This action cannot be undone."
        confirmText="Delete notification"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </main>
  );
}
