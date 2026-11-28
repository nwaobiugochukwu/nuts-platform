import assert from "node:assert/strict";
import test from "node:test";

import { createIntentIds } from "./intent-id.ts";

const counter = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

test("the same intent keeps the same id, so a double click or a retry is one action", () => {
  const ids = createIntentIds(counter());
  assert.equal(ids.forIntent("p1|5|recount"), "id-1");
  assert.equal(ids.forIntent("p1|5|recount"), "id-1");
  assert.equal(ids.forIntent("p1|5|recount"), "id-1");
});

test("a different intent gets a new id, so a changed request is never mistaken for a repeat", () => {
  const ids = createIntentIds(counter());
  assert.equal(ids.forIntent("p1|5|recount"), "id-1");
  assert.equal(ids.forIntent("p1|6|recount"), "id-2");
  // going back to the first is a new request again, not a resurrection of the old id
  assert.equal(ids.forIntent("p1|5|recount"), "id-3");
});

test("after the action is done, an identical request is a new action", () => {
  const ids = createIntentIds(counter());
  assert.equal(ids.forIntent("p1|5|"), "id-1");
  ids.done();
  assert.equal(ids.forIntent("p1|5|"), "id-2");
});

test("the real id is a UUID, and different each time", () => {
  const ids = createIntentIds();
  const a = ids.forIntent("x");
  ids.done();
  const b = ids.forIntent("x");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(a, uuid);
  assert.match(b, uuid);
  assert.notEqual(a, b);
});
