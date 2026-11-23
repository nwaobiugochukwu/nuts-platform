import assert from "node:assert/strict";
import test from "node:test";

import {
  canGoBackInApp,
  describePath,
  previousPath,
  recordHistoryPop,
  recordNavigation,
  resetNavigationHistory,
} from "./navigation-history.ts";

test("remembers where the user came from", () => {
  resetNavigationHistory();
  recordNavigation("/notifications");
  assert.equal(canGoBackInApp(), false);
  recordNavigation("/order/o1");
  assert.equal(previousPath(), "/notifications");
});

test("going back drops the page being left, and does not duplicate", () => {
  resetNavigationHistory();
  recordNavigation("/a");
  recordNavigation("/b");
  recordNavigation("/c");
  recordHistoryPop(); // browser back from /c to /b
  recordNavigation("/b"); // route-change effect fires for /b: already on top
  assert.equal(previousPath(), "/a");
  recordNavigation("/b");
  assert.equal(previousPath(), "/a");
});

test("names common origins accurately", () => {
  assert.equal(describePath("/notifications?x=1"), "notifications");
  assert.equal(describePath("/vendor/notifications"), "notifications");
  assert.equal(describePath("/unknown/page"), null);
  assert.equal(describePath(null), null);
});

test("a single page is never called its list", () => {
  assert.equal(describePath("/notifications/n1"), "the notification");
  assert.equal(describePath("/vendor/notifications/n1"), "the notification");
  assert.equal(describePath("/order"), "your orders");
  assert.equal(describePath("/order/o1"), "your order");
  assert.equal(describePath("/vendor/order"), "orders");
  assert.equal(describePath("/vendor/order/o1"), "the order");
  assert.equal(describePath("/admin/order/o1"), "the order");
});

test("portal pages get their own name instead of a generic dashboard", () => {
  assert.equal(describePath("/vendor/product"), "your products");
  assert.equal(describePath("/vendor/discount"), "your discounts");
  assert.equal(describePath("/vendor/wallet"), "your wallet");
  assert.equal(describePath("/admin/discount"), "discounts");
  assert.equal(describePath("/admin/category"), "categories");
  assert.equal(describePath("/vendor"), "stores");
  assert.equal(describePath("/vendor/aba-shoes"), "the store");
  assert.equal(describePath("/vouchers"), "your vouchers");
  assert.equal(describePath("/cart"), "your cart");
});

test("a page that renders before it is recorded still finds its origin", () => {
  resetNavigationHistory();
  recordNavigation("/notifications");
  // /order/o1 is rendering but the tracker effect has not run yet.
  assert.equal(previousPath("/order/o1"), "/notifications");
  recordNavigation("/order/o1");
  assert.equal(previousPath("/order/o1"), "/notifications");
});
