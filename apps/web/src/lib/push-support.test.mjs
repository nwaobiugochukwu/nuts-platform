import assert from "node:assert/strict";
import test from "node:test";

import { detectPushSupport, explainSubscribeError, nextPromptDelayMs } from "./push-support.ts";

const base = {
  isSecureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
  isBrave: false,
  isStandalone: false,
};

test("a normal modern browser is supported", () => {
  assert.equal(detectPushSupport(base).status, "supported");
});

test("Brave without Google push explains how to turn it on", () => {
  const r = detectPushSupport({ ...base, hasPushManager: false, isBrave: true });
  assert.equal(r.status, "unsupported");
  assert.equal(r.reason, "brave-push-disabled");
  assert.match(r.steps.join(" "), /brave:\/\/settings\/privacy/);
});

test("iPhone Safari outside the Home Screen asks to install", () => {
  const r = detectPushSupport({
    ...base,
    hasPushManager: false,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
  });
  assert.equal(r.reason, "ios-install-required");
  assert.equal(
    detectPushSupport({ ...base, userAgent: "iPhone Safari", isStandalone: true }).status,
    "supported",
  );
});

test("an insecure page is called out first", () => {
  assert.equal(detectPushSupport({ ...base, isSecureContext: false }).reason, "insecure-context");
});

test("a browser with no push API is plainly unsupported", () => {
  assert.equal(detectPushSupport({ ...base, hasPushManager: false }).reason, "no-push-api");
});

test("subscribe failures get a useful explanation", () => {
  const abort = Object.assign(new Error("Registration failed - push service error"), { name: "AbortError" });
  assert.match(explainSubscribeError(abort, { isBrave: true }), /Brave/);
  assert.match(explainSubscribeError(abort, { isBrave: false }), /VPN or firewall/);
  const denied = Object.assign(new Error("x"), { name: "NotAllowedError" });
  assert.match(explainSubscribeError(denied, { isBrave: false }), /blocked/);
});

test("the prompt backs off after each dismissal", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(nextPromptDelayMs(0), 0);
  assert.equal(nextPromptDelayMs(1), 3 * day);
  assert.equal(nextPromptDelayMs(2), 14 * day);
  assert.equal(nextPromptDelayMs(9), 60 * day);
});
