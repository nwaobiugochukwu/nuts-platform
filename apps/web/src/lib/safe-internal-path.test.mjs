import assert from "node:assert/strict";
import test from "node:test";

import { safeInternalPath } from "./safe-internal-path.ts";

test("preserves internal paths and their query and fragment", () => {
  assert.equal(
    safeInternalPath("/account/orders?status=pending#recent", "/"),
    "/account/orders?status=pending#recent",
  );
});

test("rejects external, protocol-relative, and malformed redirect targets", () => {
  for (const candidate of [
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/account\u0000",
  ]) {
    assert.equal(safeInternalPath(candidate, "/"), "/", candidate);
  }
});

test("uses the fallback for empty redirect targets", () => {
  assert.equal(safeInternalPath("", "/home"), "/home");
  assert.equal(safeInternalPath(null, "/home"), "/home");
});
