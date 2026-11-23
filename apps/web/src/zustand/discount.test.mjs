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
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });

const { useDiscountStore } = await import("./discount.ts");
const KEY = "nuts.claimed-voucher.v1";
const state = () => useDiscountStore.getState();

beforeEach(() => {
  storage.clear();
  useDiscountStore.setState({
    appliedDiscount: null,
    claimedCode: null,
    identityId: undefined,
  });
});

test("a guest's claim is adopted by the account that signs in", () => {
  state().syncIdentity(null);
  state().claimCode("save10", { silent: true, copy: false });
  assert.equal(state().claimedCode, "SAVE10");

  state().syncIdentity("user-1");
  assert.equal(state().claimedCode, "SAVE10");
  assert.equal(JSON.parse(storage.get(KEY)).ownerId, "user-1");
});

test("a claim survives a page reload for the same account", () => {
  state().syncIdentity("user-1");
  state().claimCode("SAVE10", { silent: true, copy: false });

  // Fresh page: nothing in memory, identity not yet resolved.
  useDiscountStore.setState({ claimedCode: null, identityId: undefined });
  state().hydrate();
  assert.equal(state().claimedCode, "SAVE10");

  state().syncIdentity("user-1");
  assert.equal(state().claimedCode, "SAVE10");
});

test("logout drops an account's claim", () => {
  state().syncIdentity("user-1");
  state().claimCode("SAVE10", { silent: true, copy: false });
  state().syncIdentity(null);
  assert.equal(state().claimedCode, null);
  assert.equal(storage.has(KEY), false);
});

test("a different account never inherits someone else's claim", () => {
  state().syncIdentity("user-1");
  state().claimCode("SAVE10", { silent: true, copy: false });
  state().syncIdentity("user-2");
  assert.equal(state().claimedCode, null);
});

test("an account-owned leftover is dropped when the session resolves as guest", () => {
  storage.set(KEY, JSON.stringify({ code: "SAVE10", claimedAt: Date.now(), ownerId: "user-1" }));
  state().hydrate();
  assert.equal(state().claimedCode, "SAVE10"); // shown until auth resolves
  state().syncIdentity(null);
  assert.equal(state().claimedCode, null);
});

test("claims expire after 24 hours", () => {
  storage.set(
    KEY,
    JSON.stringify({ code: "OLD", claimedAt: Date.now() - 25 * 60 * 60 * 1000, ownerId: null }),
  );
  state().hydrate();
  assert.equal(state().claimedCode, null);
  assert.equal(storage.has(KEY), false);
});

test("claiming a different voucher replaces the applied discount so it is re-evaluated", () => {
  state().syncIdentity("user-1");
  state().claimCode("OLD10", { silent: true, copy: false });
  state().setAppliedDiscount({ code: "OLD10", amount: 500 });

  state().claimCode("BIG50", { silent: true, copy: false });
  assert.equal(state().claimedCode, "BIG50");
  assert.equal(state().appliedDiscount, null);
});

test("re-claiming the same voucher keeps the applied discount", () => {
  state().syncIdentity("user-1");
  state().claimCode("SAVE10", { silent: true, copy: false });
  state().setAppliedDiscount({ code: "SAVE10", amount: 500 });
  state().claimCode("save10", { silent: true, copy: false });
  assert.deepEqual(state().appliedDiscount, { code: "SAVE10", amount: 500 });
});

test("clearApplied keeps the claim; clearDiscount removes both", () => {
  state().syncIdentity("user-1");
  state().claimCode("SAVE10", { silent: true, copy: false });
  state().setAppliedDiscount({ code: "SAVE10", amount: 500 });

  state().clearApplied();
  assert.equal(state().appliedDiscount, null);
  assert.equal(state().claimedCode, "SAVE10");

  state().clearDiscount();
  assert.equal(state().claimedCode, null);
  assert.equal(storage.has(KEY), false);
});

test("with storage blocked the in-memory claim survives identity resolution", () => {
  globalThis.window.localStorage.setItem = () => {
    throw new Error("blocked");
  };
  state().syncIdentity(null);
  state().claimCode("SAVE10", { silent: true, copy: false });
  state().syncIdentity("user-1");
  assert.equal(state().claimedCode, "SAVE10");
});
