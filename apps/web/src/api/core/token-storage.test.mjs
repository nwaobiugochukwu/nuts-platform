import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAuthTokens,
  getAuthSessionRole,
  getAuthToken,
  setAuthTokens,
} from "./token-storage.ts";

test("access tokens remain isolated by explicit account role", () => {
  clearAuthTokens();
  setAuthTokens("vendor", { accessToken: "vendor-access" });
  setAuthTokens("admin", { accessToken: "admin-access" });

  assert.equal(getAuthToken("vendor"), "vendor-access");
  assert.equal(getAuthToken("admin"), "admin-access");
  assert.equal(getAuthToken("user"), null);

  clearAuthTokens("vendor");
  assert.equal(getAuthToken("vendor"), null);
  assert.equal(getAuthToken("admin"), "admin-access");
  clearAuthTokens();
});

test("getAuthSessionRole returns role from in-memory token or null", () => {
  clearAuthTokens();
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });

  try {
    assert.equal(getAuthSessionRole(), null);

    const mockAdminToken =
      "header." +
      Buffer.from(JSON.stringify({ role: "admin" })).toString("base64") +
      ".sig";
    setAuthTokens("admin", { accessToken: mockAdminToken });
    assert.equal(getAuthSessionRole(), "admin");
    clearAuthTokens();
    assert.equal(getAuthSessionRole(), null);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});

test("getApiBaseUrl returns relative /api/v1 in browser for same-origin BFF proxy", async () => {
  const { getApiBaseUrl } = await import("./client.ts");
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });

  try {
    const url = getApiBaseUrl();
    assert.equal(url, "/api/v1");
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});
