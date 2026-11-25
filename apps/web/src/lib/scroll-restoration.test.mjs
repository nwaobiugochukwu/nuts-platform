import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_RESTORE_OFFSET,
  TRAVERSAL_WINDOW_MS,
  canReachOffset,
  decideRestore,
  isRecentTraversal,
  parseSavedScroll,
  wasReachedByTraversal,
} from "./scroll-restoration.ts";

test("parseSavedScroll ignores missing, invalid and near-top values", () => {
  assert.equal(parseSavedScroll(null), null);
  assert.equal(parseSavedScroll(""), null);
  assert.equal(parseSavedScroll("abc"), null);
  assert.equal(parseSavedScroll(String(MIN_RESTORE_OFFSET - 1)), null);
  assert.equal(parseSavedScroll("1200"), 1200);
});

test("a popstate just before mount counts as Back/Forward, an old one does not", () => {
  assert.equal(isRecentTraversal(10_000, 10_000 - 100), true);
  assert.equal(isRecentTraversal(10_000, 10_000 - TRAVERSAL_WINDOW_MS - 1), false);
  assert.equal(isRecentTraversal(10_000, null), false);
});

test("a full page load via back_forward counts, but only on the first mount", () => {
  const base = { now: 5_000, lastPopstateAt: null };
  assert.equal(
    wasReachedByTraversal({ ...base, navigationType: "back_forward", isFirstMountOfDocument: true }),
    true,
  );
  assert.equal(
    wasReachedByTraversal({ ...base, navigationType: "back_forward", isFirstMountOfDocument: false }),
    false,
  );
  assert.equal(
    wasReachedByTraversal({ ...base, navigationType: "reload", isFirstMountOfDocument: true }),
    false,
  );
  assert.equal(
    wasReachedByTraversal({ ...base, navigationType: "navigate", isFirstMountOfDocument: true }),
    false,
  );
});

test("a fresh visit clears the saved offset instead of restoring it", () => {
  assert.deepEqual(decideRestore({ saved: "1800", isTraversal: false }), { action: "clear" });
  assert.deepEqual(decideRestore({ saved: null, isTraversal: false }), { action: "none" });
});

test("Back restores a meaningful saved offset and ignores junk", () => {
  assert.deepEqual(decideRestore({ saved: "1800", isTraversal: true }), {
    action: "restore",
    top: 1800,
  });
  assert.deepEqual(decideRestore({ saved: "5", isTraversal: true }), { action: "none" });
  assert.deepEqual(decideRestore({ saved: null, isTraversal: true }), { action: "none" });
});

test("canReachOffset needs the page to be tall enough", () => {
  assert.equal(canReachOffset(3000, 800, 2000), true);
  assert.equal(canReachOffset(3000, 800, 2300), false);
  assert.equal(canReachOffset(800, 800, 100), false);
});
