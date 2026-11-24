import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRelativeTime,
  notificationActionLabel,
  notificationDayGroup,
  resolveNotificationDestination,
} from "./notification-open.ts";

const base = {
  id: "n1",
  userId: "u1",
  type: "ORDER_SHIPPED",
  priority: "MEDIUM",
  title: "t",
  message: "m",
  isRead: false,
  createdAt: "2026-11-23T10:00:00Z",
  updatedAt: "2026-11-23T10:00:00Z",
};

test("opens the related order directly, not the notification page", () => {
  const dest = resolveNotificationDestination({ ...base, metadata: { orderId: "o1" } }, "user");
  // A shipped order opens at its tracking section.
  assert.deepEqual(dest, { href: "/order/o1#tracking", kind: "target" });
});

test("vendors land on their own order page", () => {
  const dest = resolveNotificationDestination({ ...base, metadata: { orderId: "o1" } }, "vendor");
  assert.equal(dest.href, "/vendor/order/o1");
});

test("falls back to the notification page when there is nothing to open", () => {
  const dest = resolveNotificationDestination({ ...base, type: "SYSTEM_ANNOUNCEMENT" }, "user");
  assert.deepEqual(dest, { href: "/notifications/n1", kind: "detail" });
});

test("groups by calendar day", () => {
  const now = new Date(2026, 10, 23, 15, 0, 0);
  assert.equal(notificationDayGroup(new Date(2026, 10, 23, 1, 0).toISOString(), now), "Today");
  assert.equal(notificationDayGroup(new Date(2026, 10, 22, 23, 0).toISOString(), now), "Yesterday");
  assert.equal(notificationDayGroup(new Date(2026, 10, 19, 12, 0).toISOString(), now), "This week");
  assert.equal(notificationDayGroup(new Date(2026, 9, 1, 12, 0).toISOString(), now), "Earlier");
});

test("relative time is compact", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(formatRelativeTime("2026-11-23T11:59:30Z", now), "Just now");
  assert.equal(formatRelativeTime("2026-11-23T11:30:00Z", now), "30m");
  assert.equal(formatRelativeTime("2026-11-23T09:00:00Z", now), "3h");
  assert.equal(formatRelativeTime("2026-11-21T12:00:00Z", now), "2d");
});

test("a new follower opens the followers section of store analytics", () => {
  const dest = resolveNotificationDestination(
    { ...base, type: "VENDOR_FOLLOWED", actionUrl: "/vendor/analytic" },
    "vendor",
  );
  assert.deepEqual(dest, { href: "/vendor/analytic#followers", kind: "target" });
});

test("an announcement opens the message first, even when it has a link", () => {
  const dest = resolveNotificationDestination(
    { ...base, type: "SYSTEM_ANNOUNCEMENT", actionUrl: "/cart" },
    "user",
  );
  assert.deepEqual(dest, { href: "/notifications/n1", kind: "detail" });
});

test("payment and order-confirmed notifications open different sections of the order", () => {
  const payment = resolveNotificationDestination(
    { ...base, type: "PAYMENT_RECEIVED", actionUrl: "/order/o1", metadata: { orderId: "o1" } },
    "user",
  );
  const confirmed = resolveNotificationDestination(
    { ...base, type: "ORDER_CONFIRMED", actionUrl: "/order/o1", metadata: { orderId: "o1" } },
    "user",
  );
  assert.equal(payment.href, "/order/o1#payment");
  assert.equal(confirmed.href, "/order/o1#tracking");
  assert.notEqual(payment.href, confirmed.href);
});

test("older stored links without a section still get one, and a stored section is kept", () => {
  assert.equal(
    resolveNotificationDestination({ ...base, type: "ORDER_SHIPPED", actionUrl: "/order/o9" }, "user").href,
    "/order/o9#tracking",
  );
  assert.equal(
    resolveNotificationDestination({ ...base, type: "PAYMENT_RECEIVED", actionUrl: "/order/o9#payment" }, "user").href,
    "/order/o9#payment",
  );
});

test("vendors and cancelled orders keep their plain targets", () => {
  assert.equal(
    resolveNotificationDestination({ ...base, type: "ORDER_CONFIRMED", metadata: { orderId: "o1" } }, "vendor").href,
    "/vendor/order/o1",
  );
  assert.equal(
    resolveNotificationDestination({ ...base, type: "ORDER_CANCELLED", actionUrl: "/order/o1" }, "user").href,
    "/order/o1",
  );
});

test("each notification says what the tap will show", () => {
  assert.equal(notificationActionLabel("PAYMENT_RECEIVED"), "View receipt");
  assert.equal(notificationActionLabel("ORDER_CONFIRMED"), "Track order");
  assert.equal(notificationActionLabel("PAYMENT_FAILED"), "Retry payment");
  assert.equal(notificationActionLabel("SYSTEM_ANNOUNCEMENT"), "Open");
});
