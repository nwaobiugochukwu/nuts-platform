import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NOTIFICATION_STREAM_FAILURES,
  shouldRetryNotificationHttpStatus,
  shouldRetryNotificationStream,
} from "./notification-stream-policy.ts";

test("notification stream retries only a bounded number of consecutive failures", () => {
  assert.equal(MAX_NOTIFICATION_STREAM_FAILURES, 3);
  assert.equal(shouldRetryNotificationStream(1), true);
  assert.equal(shouldRetryNotificationStream(2), true);
  assert.equal(shouldRetryNotificationStream(3), false);
  assert.equal(shouldRetryNotificationStream(4), false);
});

test("gateway 502 fails fast while other transient HTTP failures stay bounded", () => {
  assert.equal(shouldRetryNotificationHttpStatus(502), false);
  assert.equal(shouldRetryNotificationHttpStatus(503), true);
  assert.equal(shouldRetryNotificationHttpStatus(504), true);
  assert.equal(shouldRetryNotificationHttpStatus(429), true);
  assert.equal(shouldRetryNotificationHttpStatus(404), false);
});
