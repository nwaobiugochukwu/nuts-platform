import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Minimal browser surface for the store (no jsdom in this repo's node tests).
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
};
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
});

const { useDiscountStore, MAX_CLAIMED_VOUCHERS } = await import("./discount.ts");
const KEY = "nuts.claimed-vouchers.v2";
const state = () => useDiscountStore.getState();
const claim = (code) => state().claimCode(code, { silent: true, copy: false });

beforeEach(() => {
  storage.clear();
  useDiscountStore.setState({
    appliedDiscounts: [],
    claimedCodes: [],
    identityId: undefined,
  });
});

test("a guest's claims are adopted by the account that signs in", () => {
  state().syncIdentity(null);
  claim("save10");
  assert.deepEqual(state().claimedCodes, ["SAVE10"]);

  state().syncIdentity("user-1");
  assert.deepEqual(state().claimedCodes, ["SAVE10"]);
  assert.equal(JSON.parse(storage.get(KEY)).ownerId, "user-1");
});

test("claims survive a page reload for the same account", () => {
  state().syncIdentity("user-1");
  claim("SAVE10");

  // Fresh page: nothing in memory, identity not yet resolved.
  useDiscountStore.setState({ claimedCodes: [], identityId: undefined });
  state().hydrate();
  assert.deepEqual(state().claimedCodes, ["SAVE10"]);

  state().syncIdentity("user-1");
  assert.deepEqual(state().claimedCodes, ["SAVE10"]);
});

test("logout drops an account's claims", () => {
  state().syncIdentity("user-1");
  claim("SAVE10");
  state().syncIdentity(null);
  assert.deepEqual(state().claimedCodes, []);
  assert.equal(storage.has(KEY), false);
});

test("a different account never inherits someone else's claims", () => {
  state().syncIdentity("user-1");
  claim("SAVE10");
  state().syncIdentity("user-2");
  assert.deepEqual(state().claimedCodes, []);
});

test("an account-owned leftover is dropped when the session resolves as guest", () => {
  storage.set(
    KEY,
    JSON.stringify({ codes: ["SAVE10"], claimedAt: Date.now(), ownerId: "user-1" }),
  );
  state().hydrate();
  assert.deepEqual(state().claimedCodes, ["SAVE10"]); // shown until auth resolves
  state().syncIdentity(null);
  assert.deepEqual(state().claimedCodes, []);
});

test("claims expire after 24 hours", () => {
  storage.set(
    KEY,
    JSON.stringify({
      codes: ["OLD"],
      claimedAt: Date.now() - 25 * 60 * 60 * 1000,
      ownerId: null,
    }),
  );
  state().hydrate();
  assert.deepEqual(state().claimedCodes, []);
  assert.equal(storage.has(KEY), false);
});

test("two vouchers can be held (one store + one platform); a third replaces the oldest", () => {
  assert.equal(MAX_CLAIMED_VOUCHERS, 2);
  state().syncIdentity("user-1");
  claim("STORE20");
  claim("PLAT10");
  assert.deepEqual(state().claimedCodes, ["STORE20", "PLAT10"]);

  claim("NEWER5");
  assert.deepEqual(state().claimedCodes, ["PLAT10", "NEWER5"]);
});

test("re-claiming a held voucher refreshes it instead of duplicating", () => {
  state().syncIdentity("user-1");
  claim("STORE20");
  claim("PLAT10");
  claim("store20");
  assert.deepEqual(state().claimedCodes, ["PLAT10", "STORE20"]);
});

test("removeClaim forgets one voucher and its applied discount only", () => {
  state().syncIdentity("user-1");
  claim("STORE20");
  claim("PLAT10");
  state().setAppliedDiscounts([
    { code: "STORE20", amount: 2000 },
    { code: "PLAT10", amount: 1800 },
  ]);

  state().removeClaim("store20");
  assert.deepEqual(state().claimedCodes, ["PLAT10"]);
  assert.deepEqual(state().appliedDiscounts, [{ code: "PLAT10", amount: 1800 }]);
});

test("clearApplied keeps the claims; clearDiscount removes everything", () => {
  state().syncIdentity("user-1");
  claim("SAVE10");
  state().setAppliedDiscounts([{ code: "SAVE10", amount: 500 }]);

  state().clearApplied();
  assert.deepEqual(state().appliedDiscounts, []);
  assert.deepEqual(state().claimedCodes, ["SAVE10"]);

  state().clearDiscount();
  assert.deepEqual(state().claimedCodes, []);
  assert.equal(storage.has(KEY), false);
});

test("setClaims reconciles with the server wallet (newest two kept, applied pruned)", () => {
  state().syncIdentity("user-1");
  state().setAppliedDiscounts([{ code: "GONE", amount: 100 }]);
  state().setClaims(["a1", "b2", "c3"]);
  assert.deepEqual(state().claimedCodes, ["B2", "C3"]);
  assert.deepEqual(state().appliedDiscounts, []);
});

test("with storage blocked the in-memory claims survive identity resolution", () => {
  globalThis.window.localStorage.setItem = () => {
    throw new Error("blocked");
  };
  state().syncIdentity(null);
  claim("SAVE10");
  state().syncIdentity("user-1");
  assert.deepEqual(state().claimedCodes, ["SAVE10"]);
});
