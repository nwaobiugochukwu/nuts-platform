#!/usr/bin/env node
/**
 * Architecture guardrails for the NUTS modular monolith.
 *
 * Enforces the dependency rules in docs/architecture/README.md so the structure
 * cannot silently erode. Run: `npm run check:architecture` (also part of CI).
 *
 * Rules
 *  API  1. `common/` and `infrastructure/` are lower layers: they must not import
 *          `modules/*`. There are no exceptions.
 *       2. A module never reaches into another module's `controllers/`, `jobs/`,
 *          `consumers/` or `listeners/`.
 *          Only providers (services), DTOs, constants and types are shared.
 *       3. Database transactions are opened only through `TransactionRunner`
 *          (infrastructure/database). Files that still call `$transaction`
 *          directly are listed in API_RAW_TRANSACTION_LEGACY and may only shrink.
 *       4. Temporal workflow files (`infrastructure/workflows/workflows/`) are deterministic
 *          sandbox code: they may import only `@temporalio/workflow`, relative pure
 *          modules and type-only imports. No Nest, Prisma, `@api/` or Node built-ins.
 *       5. Audit events are declared with `@Audit(...)` on the controller method and
 *          enriched with `auditDetails(...)`; services do not call the audit log
 *          directly. The few calls that run outside any request (scheduled or
 *          background code) are listed in API_DIRECT_AUDIT_ALLOWED with their exact
 *          count, and may only shrink.
 *       6. Layout and naming (scripts/architecture-layout-rules.mjs): every file is
 *          `<kebab-name>.<allowed-kind>.ts`; a service, controller, module, consumer,
 *          job, guard, interceptor, pipe, filter, middleware, listener or strategy
 *          exports a class named after its file; a module holds only its `*.module.ts`
 *          files and the standard folders; consumers live in `modules/<domain>/consumers`
 *          (or `infrastructure/workflows`); `@api/*` is the only internal alias.
 *          Known exceptions are listed in API_LAYOUT_LEGACY and may only shrink.
 *  WEB  3. One import alias: `@/`. No relative imports that climb out of a layer
 *          directory more than two levels (use `@/`).
 *       4. Shared UI layers (`components/ui|form|data|feedback|modal|navigation|theme`)
 *          never import feature code (`components/domain`, `app`).
 *       5. `lib/`, `api/`, `zustand/` and `hooks/` never import React components or `app/`.
 *       6. Nothing imports from `app/` (routes are leaves).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkAlias, checkClassName, checkConsumerLocation, checkFileName, checkModuleEntry,
} from "./architecture-layout-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    entry.isDirectory() ? walk(full, out) : /\.(ts|tsx|mjs)$/.test(entry.name) && out.push(full);
  }
  return out;
}
const importsOf = (file) =>
  [...fs.readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

// ── API ───────────────────────────────────────────────────────────────────────
const API_SRC = path.join(root, "apps/api/src");

// Files that still open transactions with `prisma.$transaction` directly. Convert them to
// `TransactionRunner.run(...)` and remove them from this list. Do not add to it.
const API_RAW_TRANSACTION_LEGACY = new Set([
  "apps/api/src/infrastructure/messaging/outbox/outbox.relay.ts",
  "apps/api/src/modules/products/consumers/inventory.consumer.ts",
  "apps/api/src/modules/auth/services/admin-auth.service.ts",
  "apps/api/src/modules/auth/services/auth.service.ts",
  "apps/api/src/modules/auth/services/refresh-session.service.ts",
  "apps/api/src/modules/categories/services/categories.service.ts",
  "apps/api/src/modules/discounts/services/voucher-claims.service.ts",
  "apps/api/src/modules/notifications/services/order-event-notifications.service.ts",
  "apps/api/src/modules/orders/services/orders.service.ts",
  "apps/api/src/modules/products/services/product-variants.service.ts",
  "apps/api/src/modules/products/services/products.service.ts",
  "apps/api/src/modules/recommendations/services/personalized-feed.service.ts",
  "apps/api/src/modules/referrals/services/referral.service.ts",
  "apps/api/src/modules/vendors/services/vendor-follows.service.ts",
  "apps/api/src/modules/wallets/services/wallet.service.ts",
]);
// Direct audit-log calls that run OUTSIDE a request, where there is no controller to
// carry `@Audit`. path -> number of calls allowed. Do not raise a number; lower it.
const API_DIRECT_AUDIT_ALLOWED = new Map([
  ["apps/api/src/modules/announcements/services/admin-announcements.service.ts", 2],
  ["apps/api/src/modules/products/services/products.service.ts", 1],
  ["apps/api/src/modules/users/services/users.service.ts", 1],
]);
// Layout/naming exceptions that still exist. Do not add to this set; fix the file and remove it.
const API_LAYOUT_LEGACY = new Set([]);
const DIRECT_AUDIT_CALL = /this\.(?:auditLog|audit)\s*\.\s*(?:log|logWithRequest)\s*\(/g;

const TRANSACTION_RUNNER_FILE = "apps/api/src/infrastructure/database/transaction-runner.service.ts";
for (const file of walk(API_SRC)) {
  const r = rel(file);
  const isSpec = /\.spec\.ts$/.test(r) || r.includes("/test/");
  const layer = r.split("/")[3]; // apps/api/src/<layer>/...
  if (!isSpec && r.startsWith("apps/api/src/infrastructure/workflows/workflows/")) {
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) {
      const [, typeOnly, spec] = m;
      if (typeOnly) continue;
      const allowed = spec === "@temporalio/workflow" || spec.startsWith(".");
      if (!allowed) violations.push(`[api:4] ${r} imports "${spec}" (workflow code may only import @temporalio/workflow and relative pure modules)`);
    }
  }
  if (!isSpec && !r.startsWith("apps/api/src/modules/audit/")) {
    const calls = (fs.readFileSync(file, "utf8").match(DIRECT_AUDIT_CALL) ?? []).length;
    const allowed = API_DIRECT_AUDIT_ALLOWED.get(r) ?? 0;
    if (calls > allowed) {
      violations.push(`[api:5] ${r} calls the audit log directly ${calls} time(s) (allowed ${allowed}); declare it with @Audit on the controller and auditDetails(...) instead`);
    }
  }
  if (!isSpec && r !== TRANSACTION_RUNNER_FILE && !API_RAW_TRANSACTION_LEGACY.has(r) && /\$transaction\s*\(/.test(fs.readFileSync(file, "utf8"))) {
    violations.push(`[api:3] ${r} opens a transaction directly; use TransactionRunner.run(...)`);
  }
  if (!r.includes("/test/")) {
    const fromSrc = r.slice("apps/api/src/".length);
    const problems = [
      ...checkFileName(fromSrc),
      ...(isSpec ? [] : checkClassName(fromSrc, fs.readFileSync(file, "utf8"))),
      ...checkConsumerLocation(fromSrc),
      ...(layer === "modules" ? checkModuleEntry(fromSrc.split("/").slice(2).join("/")) : []),
    ];
    if (!API_LAYOUT_LEGACY.has(r)) for (const problem of problems) violations.push(`[api:6] ${r}: ${problem}`);
  }
  for (const spec of importsOf(file)) {
    for (const problem of checkAlias(spec)) violations.push(`[api:6] ${r}: ${problem}`);
    if (!spec.startsWith("@api/modules/")) continue;
    if (!isSpec && (layer === "common" || layer === "infrastructure")) {
      violations.push(`[api:1] ${r} (lower layer) imports ${spec}`);
    }
    const target = spec.split("/")[2];
    const own = layer === "modules" ? r.split("/")[4] : null;
    if (layer === "modules" && own && target !== own && /\/(controllers|jobs|consumers|listeners)\//.test(spec) && !isSpec) {
      violations.push(`[api:2] ${r} imports another module's internals: ${spec}`);
    }
  }
}

// ── WEB ───────────────────────────────────────────────────────────────────────
const WEB_SRC = path.join(root, "apps/web/src");
const SHARED_UI = ["components/ui/", "components/form/", "components/data/", "components/feedback/", "components/modal/", "components/navigation/", "components/theme/"];
const NON_UI = ["lib/", "api/", "zustand/", "hooks/"];
for (const file of walk(WEB_SRC)) {
  const r = path.relative(WEB_SRC, file).split(path.sep).join("/");
  const isTest = /\.test\.mjs$/.test(r);
  for (const spec of importsOf(file)) {
    if (spec.startsWith(".")) {
      if (/^(\.\.\/){3,}/.test(spec)) violations.push(`[web:3] src/${r} climbs too far with "${spec}" (use "@/")`);
      continue;
    }
    if (!spec.startsWith("@/")) continue;
    const target = spec.slice(2);
    if (target.startsWith("app/") && !isTest) violations.push(`[web:6] src/${r} imports from the routes layer: ${spec}`);
    if (SHARED_UI.some((p) => r.startsWith(p)) && (target.startsWith("components/domain") || target.startsWith("app/"))) {
      violations.push(`[web:4] shared UI src/${r} imports feature code: ${spec}`);
    }
    if (NON_UI.some((p) => r.startsWith(p)) && !isTest && target.startsWith("components/")) {
      violations.push(`[web:5] src/${r} (non-UI layer) imports a component: ${spec}`);
    }
  }
}

if (violations.length) {
  console.error(`Architecture check failed (${violations.length}):\n` + violations.map((v) => "  - " + v).join("\n"));
  process.exit(1);
}
console.log("Architecture check passed.");
