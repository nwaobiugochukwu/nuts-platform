import { safeInternalPath } from "./safe-internal-path.ts";

export function notificationListPath(role?: string | null): string {
  const normalized = (role ?? "").toLowerCase();
  return (
    normalized === "admin"
      ? "/admin/notifications"
      : normalized === "vendor"
        ? "/vendor/notifications"
        : "/notifications"
  );
}

export function notificationDetailPath(
  role: string | null | undefined,
  notificationId: string,
): string {
  return `${notificationListPath(role)}/${encodeURIComponent(notificationId)}`;
}

export interface NotificationLinkSource {
  actionUrl?: string | null;
  link?: string | null;
  type?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Which section of the order page a notification is about. A payment message opens the
 * payment/receipt section and a progress message opens the tracking section, so "Payment
 * received" and "Order confirmed" no longer open the same view.
 */
export function orderSectionFor(type?: string): "payment" | "tracking" | null {
  switch (type) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_FAILED":
    case "PAYMENT_REFUNDED":
      return "payment";
    case "ORDER_PLACED":
    case "ORDER_CONFIRMED":
    case "ORDER_SHIPPED":
    case "ORDER_DELIVERED":
      return "tracking";
    default:
      return null;
  }
}

function withOrderSection(path: string, type?: string): string {
  const section = orderSectionFor(type);
  if (!section || !/^\/order\/[^/#?]+$/.test(path)) return path;
  return `${path}#${section}`;
}

/**
 * Resolves the true destination URL of a related resource (e.g. order, product, payment)
 * for the user's active role, preventing 404s, malformed paths, or bare table redirects.
 */
export function resolveNotificationTargetUrl(
  notification: NotificationLinkSource,
  role?: string | null,
): string | null {
  const normRole = (role ?? "").toLowerCase();

  // "New follower" belongs on the followers section of store analytics, however
  // the stored link was written (older rows point at the page top).
  if (notification.type === "VENDOR_FOLLOWED" && normRole === "vendor") {
    return "/vendor/analytic#followers";
  }

  const rawUrl = notification.actionUrl || notification.link;

  // 1. Process explicit link if provided
  if (rawUrl && typeof rawUrl === "string" && rawUrl.trim()) {
    let path = rawUrl.trim();

    // Fix plural vs singular /vendor/orders -> /vendor/order
    if (path.startsWith("/vendor/orders/")) {
      path = path.replace("/vendor/orders/", "/vendor/order/");
    } else if (path === "/vendor/orders") {
      path = "/vendor/order";
    }

    // Fix plural vs singular /admin/orders -> /admin/order
    if (path.startsWith("/admin/orders/")) {
      path = path.replace("/admin/orders/", "/admin/order/");
    } else if (path === "/admin/orders") {
      path = "/admin/order";
    }

    // Role-scoped order translation if link is generic /order/:id
    if (path.startsWith("/order/")) {
      const orderId = path.replace("/order/", "");
      if (normRole === "vendor") {
        path = `/vendor/order/${orderId}`;
      } else if (normRole === "admin") {
        path = `/admin/order/${orderId}`;
      }
    }

    // If admin has bare /admin/order and metadata has orderId, enrich it
    if (path === "/admin/order" && notification.metadata?.orderId) {
      path = `/admin/order/${notification.metadata.orderId}`;
    }

    // If vendor has bare /vendor/order and metadata has orderId, enrich it
    if (path === "/vendor/order" && notification.metadata?.orderId) {
      path = `/vendor/order/${notification.metadata.orderId}`;
    }

    const safe = safeInternalPath(path, "");
    if (safe) return normRole === "vendor" || normRole === "admin" ? safe : withOrderSection(safe, notification.type);
  }

  // 2. Synthesize from metadata if explicit link was absent or rejected
  const orderId =
    notification.metadata?.orderId ??
    notification.metadata?.order_id ??
    notification.metadata?.id;

  if (orderId && typeof orderId === "string" && orderId.trim()) {
    const id = encodeURIComponent(orderId.trim());
    if (normRole === "vendor") return `/vendor/order/${id}`;
    if (normRole === "admin") return `/admin/order/${id}`;
    return withOrderSection(`/order/${id}`, notification.type);
  }

  const paymentId =
    notification.metadata?.paymentId ?? notification.metadata?.payment_id;
  if (paymentId && typeof paymentId === "string" && paymentId.trim()) {
    if (normRole === "admin") return `/admin/order`;
    if (normRole === "vendor") return `/vendor/wallet`;
  }

  return null;
}
