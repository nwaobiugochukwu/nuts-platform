import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
  cooldownMsFromRateLimit,
  createRefreshCooldown,
} from "./refresh-cooldown.ts";

test("waits for the Retry-After header, in seconds", () => {
  assert.equal(cooldownMsFromRateLimit("42"), 42_000);
  assert.equal(cooldownMsFromRateLimit(" 7 "), 7_000);
});

test("falls back to the body's retryAfter when the header is missing or zero", () => {
  assert.equal(cooldownMsFromRateLimit(undefined, 15), 15_000);
  // the stock rate limiter used to send "Retry-After: 0", which means nothing useful
  assert.equal(cooldownMsFromRateLimit("0", 15), 15_000);
});

test("never means retry now, and never waits more than two minutes", () => {
  assert.equal(cooldownMsFromRateLimit("0"), DEFAULT_COOLDOWN_MS);
  assert.equal(cooldownMsFromRateLimit(undefined, undefined), DEFAULT_COOLDOWN_MS);
  assert.equal(cooldownMsFromRateLimit("abc"), DEFAULT_COOLDOWN_MS);
  assert.equal(cooldownMsFromRateLimit("-5"), DEFAULT_COOLDOWN_MS);
  assert.equal(cooldownMsFromRateLimit("0.2"), MIN_COOLDOWN_MS);
  assert.equal(cooldownMsFromRateLimit("86400"), MAX_COOLDOWN_MS);
});

test("a cool-down is active until its time has passed, per role", () => {
  let now = 1_000;
  const cooldown = createRefreshCooldown(() => now);

  assert.equal(cooldown.isActive("user"), false);
  cooldown.start("user", 30_000);
  assert.equal(cooldown.isActive("user"), true);
  assert.equal(cooldown.isActive("vendor"), false);
  assert.equal(cooldown.remainingMs("user"), 30_000);

  now += 29_999;
  assert.equal(cooldown.isActive("user"), true);
  now += 1;
  assert.equal(cooldown.isActive("user"), false);
  assert.equal(cooldown.remainingMs("user"), 0);
});

test("starting again extends a cool-down but never shortens it", () => {
  let now = 0;
  const cooldown = createRefreshCooldown(() => now);

  cooldown.start("user", 60_000);
  cooldown.start("user", 5_000);
  assert.equal(cooldown.remainingMs("user"), 60_000);

  cooldown.start("user", 90_000);
  assert.equal(cooldown.remainingMs("user"), 90_000);
});
