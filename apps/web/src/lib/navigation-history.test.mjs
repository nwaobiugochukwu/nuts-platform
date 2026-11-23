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

test("names common origins", () => {
  assert.equal(describePath("/notifications?x=1"), "notifications");
  assert.equal(describePath("/vendor/notifications"), "notifications");
  assert.equal(describePath("/order/o1"), "your orders");
  assert.equal(describePath("/vendor/order/o1"), "orders");
  assert.equal(describePath("/unknown/page"), null);
  assert.equal(describePath(null), null);
});

test("a page that renders before it is recorded still finds its origin", () => {
  resetNavigationHistory();
  recordNavigation("/notifications");
  // /order/o1 is rendering but the tracker effect has not run yet.
  assert.equal(previousPath("/order/o1"), "/notifications");
  recordNavigation("/order/o1");
  assert.equal(previousPath("/order/o1"), "/notifications");
});
