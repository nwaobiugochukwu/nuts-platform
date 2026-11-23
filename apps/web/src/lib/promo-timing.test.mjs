import assert from "node:assert/strict";
import test from "node:test";

import { MAX_DWELL_MS, MIN_DWELL_MS, RESUME_AFTER_INTERACTION_MS, dwellMs } from "./promo-timing.ts";

test("a short offer stays 5 seconds", () => {
  assert.equal(MIN_DWELL_MS, 5000);
  assert.equal(dwellMs(0), 5000);
  assert.equal(dwellMs(40), 5000);
});

test("longer text gets more reading time, up to 8 seconds", () => {
  assert.equal(dwellMs(60), 5800); // 20 chars over * 40 ms
  assert.equal(dwellMs(500), MAX_DWELL_MS);
  assert.equal(MAX_DWELL_MS, 8000);
});

test("rotation resumes 10 seconds after the shopper stops interacting", () => {
  assert.equal(RESUME_AFTER_INTERACTION_MS, 10_000);
});
