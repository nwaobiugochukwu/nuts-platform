import type { AppNotification } from "@/api/services/notifications";
import {
  notificationDetailPath,
  resolveNotificationTargetUrl,
} from "./notification-path.ts";

/**
 * Where tapping a notification should take the user.
 *
 * Production inboxes open the thing the notification is ABOUT (the order, the
 * payout, ...) in one tap. The standalone notification page is only the
 * fallback for messages that have nothing to open (announcements, follows).
 */
export function resolveNotificationDestination(
  notification: AppNotification,
  role?: string | null,
): { href: string; kind: "target" | "detail" } {
  // Announcements are content-first: the message itself is what the sender wants
  // read (up to 2,000 characters, which a list preview truncates), with its link
  // offered as a button on the page. Transactional alerts are destination-first.
  if (notification.type === "SYSTEM_ANNOUNCEMENT") {
    return { href: notificationDetailPath(role, notification.id), kind: "detail" };
  }

  const target = resolveNotificationTargetUrl(notification, role);
  return target
    ? { href: target, kind: "target" }
    : { href: notificationDetailPath(role, notification.id), kind: "detail" };
}

/** The call to action for a notification that opens something: says what the user will see. */
export function notificationActionLabel(type?: string): string {
  switch (type) {
    case "PAYMENT_RECEIVED":
      return "View receipt";
    case "PAYMENT_REFUNDED":
      return "View refund";
    case "PAYMENT_FAILED":
      return "Retry payment";
    case "ORDER_PLACED":
    case "ORDER_CONFIRMED":
    case "ORDER_SHIPPED":
      return "Track order";
    case "ORDER_DELIVERED":
    case "ORDER_CANCELLED":
      return "View order";
    case "VENDOR_FOLLOWED":
      return "View followers";
    case "PAYOUT_PROCESSED":
      return "View payout";
    case "LOW_STOCK_ALERT":
      return "Restock";
    default:
      return "Open";
  }
}

export type NotificationDayGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export function notificationDayGroup(createdAt: string, now = new Date()): NotificationDayGroup {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const time = date.getTime();
  if (time >= startOfToday) return "Today";
  if (time >= startOfToday - day) return "Yesterday";
  if (time >= startOfToday - 6 * day) return "This week";
  return "Earlier";
}

export function formatRelativeTime(dateString: string, now = Date.now()): string {
  const time = new Date(dateString).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
