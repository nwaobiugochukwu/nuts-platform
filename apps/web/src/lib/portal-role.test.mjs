import assert from "node:assert/strict";
import test from "node:test";
import { getPortalRoleFromPath, evaluateAuthPageRedirect } from "./portal-role.ts";

test("getPortalRoleFromPath resolves correct portal role", () => {
  assert.equal(getPortalRoleFromPath("/auth/admin/login"), "admin");
  assert.equal(getPortalRoleFromPath("/admin/analytic"), "admin");
  assert.equal(getPortalRoleFromPath("/auth/vendor/login"), "vendor");
  assert.equal(getPortalRoleFromPath("/vendor/order"), "vendor");
  assert.equal(getPortalRoleFromPath("/auth/login"), "user");
  assert.equal(getPortalRoleFromPath("/account"), "user");
  assert.equal(getPortalRoleFromPath("/"), "user");
});

test("evaluateAuthPageRedirect redirects when active role matches target portal", () => {
  // Vendor on vendor login -> redirect to vendor dashboard
  const vendorRes = evaluateAuthPageRedirect("/auth/vendor/login", true, "vendor");
  assert.equal(vendorRes.shouldRedirect, true);
  assert.equal(vendorRes.targetPath, "/vendor/analytic");

  // Admin on admin login -> redirect to admin dashboard
  const adminRes = evaluateAuthPageRedirect("/auth/admin/login", true, "admin");
  assert.equal(adminRes.shouldRedirect, true);
  assert.equal(adminRes.targetPath, "/admin");

  // User on user login -> redirect to storefront
  const userRes = evaluateAuthPageRedirect("/auth/login", true, "user");
  assert.equal(userRes.shouldRedirect, true);
  assert.equal(userRes.targetPath, "/");
});

test("CRITICAL: evaluateAuthPageRedirect does NOT redirect on cross-role access to prevent infinite loops", () => {
  // Customer on vendor login -> MUST NOT redirect to /vendor/analytic!
  const userOnVendorRes = evaluateAuthPageRedirect("/auth/vendor/login", true, "user");
  assert.equal(userOnVendorRes.shouldRedirect, false);
  assert.equal(userOnVendorRes.isCrossRoleAccess, true);

  // Customer on admin login -> MUST NOT redirect to /admin!
  const userOnAdminRes = evaluateAuthPageRedirect("/auth/admin/login", true, "user");
  assert.equal(userOnAdminRes.shouldRedirect, false);
  assert.equal(userOnAdminRes.isCrossRoleAccess, true);

  // Vendor on customer login -> MUST NOT redirect
  const vendorOnUserRes = evaluateAuthPageRedirect("/auth/login", true, "vendor");
  assert.equal(vendorOnUserRes.shouldRedirect, false);
  assert.equal(vendorOnUserRes.isCrossRoleAccess, true);
});

test("evaluateAuthPageRedirect does NOT redirect unauthenticated users", () => {
  const unauthRes = evaluateAuthPageRedirect("/auth/vendor/login", false, null);
  assert.equal(unauthRes.shouldRedirect, false);
});
