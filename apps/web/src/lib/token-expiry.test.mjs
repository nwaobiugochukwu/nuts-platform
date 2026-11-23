import assert from "node:assert/strict";
import test from "node:test";

import { msUntilRefresh, readTokenExpiry } from "./token-expiry.ts";

const jwt = (payload) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

test("reads exp from a token and ignores garbage", () => {
  assert.equal(readTokenExpiry(jwt({ exp: 1_800_000_000 })), 1_800_000_000);
  assert.equal(readTokenExpiry(jwt({})), null);
  assert.equal(readTokenExpiry("not-a-jwt"), null);
  assert.equal(readTokenExpiry(null), null);
});

test("schedules the refresh a minute before expiry", () => {
  const now = 1_000_000_000_000;
  const exp = now / 1000 + 15 * 60; // 15 minutes from now
  assert.equal(msUntilRefresh(exp, now, 60_000), 14 * 60_000);
});

test("a token already inside the window refreshes immediately", () => {
  const now = 1_000_000_000_000;
  assert.equal(msUntilRefresh(now / 1000 + 30, now, 60_000), 0);
  assert.equal(msUntilRefresh(now / 1000 - 10, now, 60_000), 0);
});
