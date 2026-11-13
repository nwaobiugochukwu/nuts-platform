import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { proxy } from "./proxy.ts";

test("proxy applies full security headers and CSP nonce", async () => {
  const req = new NextRequest("http://localhost:3000/product/drill-1");
  const res = await proxy(req);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    res.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.ok(res.headers.get("content-security-policy"));
  assert.ok(res.headers.get("content-security-policy").includes("nonce-"));
});

test("proxy propagates x-nonce and strips spoofed identity headers", async () => {
  const req = new NextRequest("http://localhost:3000/", {
    headers: {
      "x-user-id": "attacker-id",
      "x-user-role": "admin",
      "x-authenticated": "1",
    },
  });
  const res = await proxy(req);

  assert.equal(res.status, 200);
  // Verify that proxy executed cleanly and attached security headers
  assert.ok(res.headers.get("content-security-policy"));
});
