#!/usr/bin/env node
/**
 * Architecture guardrails for the NUTS modular monolith.
 *
 * Enforces the dependency rules in docs/architecture/README.md so the structure
 * cannot silently erode. Run: `npm run check:architecture` (also part of CI).
 *
 * Rules
 *  API  1. `common/` and `infrastructure/` are lower layers: they must not import
 *          `modules/*` (known legacy exceptions are listed in API_LEGACY_EXCEPTIONS
 *          and may only shrink).
 *       2. A module never reaches into another module's `controllers/` or `jobs/`.
 *          Only providers (services), DTOs, constants and types are shared.
 *       3. Database transactions are opened only through `TransactionRunner`
 *          (infrastructure/transaction). Files that still call `$transaction`
 *          directly are listed in API_RAW_TRANSACTION_LEGACY and may only shrink.
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
// Legacy inversions (lower layer -> module). Do not add to this list; remove entries.
const API_LEGACY_EXCEPTIONS = new Set([
  "apps/api/src/common/guards/registrations.guard.ts",
  "apps/api/src/common/guards/maintenance-mode.guard.ts",
  "apps/api/src/common/guards/otp.guard.ts",
  "apps/api/src/common/decorators/otp-required.decorator.ts",
  "apps/api/src/common/middleware/maintenance-mode.middleware.ts",
]);

// Files that still open transactions with `prisma.$transaction` directly. Convert them to
// `TransactionRunner.run(...)` and remove them from this list. Do not add to it.
const API_RAW_TRANSACTION_LEGACY = new Set([
  "apps/api/src/infrastructure/outbox/outbox.relay.ts",
  "apps/api/src/infrastructure/rabbitmq/inventory.consumer.ts",
  "apps/api/src/modules/auth/admin-auth.service.ts",
  "apps/api/src/modules/auth/auth.service.ts",
  "apps/api/src/modules/auth/sessions/refresh-session.service.ts",
  "apps/api/src/modules/categories/categories.service.ts",
  "apps/api/src/modules/discounts/voucher-claims.service.ts",
  "apps/api/src/modules/notifications/listeners/notification.listener.ts",
  "apps/api/src/modules/orders/orders.service.ts",
  "apps/api/src/modules/payments/payments.service.ts",
  "apps/api/src/modules/products/product-variants.service.ts",
  "apps/api/src/modules/products/products.service.ts",
  "apps/api/src/modules/recommendations/personalized-feed.service.ts",
  "apps/api/src/modules/referrals/referral.service.ts",
  "apps/api/src/modules/vendors/vendor-follows.service.ts",
  "apps/api/src/modules/wallets/wallet.service.ts",
]);
const TRANSACTION_RUNNER_FILE = "apps/api/src/infrastructure/transaction/transaction-runner.ts";
for (const file of walk(API_SRC)) {
  const r = rel(file);
  const isSpec = /\.spec\.ts$/.test(r) || r.includes("/test/");
  const layer = r.split("/")[3]; // apps/api/src/<layer>/...
  if (!isSpec && r !== TRANSACTION_RUNNER_FILE && !API_RAW_TRANSACTION_LEGACY.has(r) && /\$transaction\s*\(/.test(fs.readFileSync(file, "utf8"))) {
    violations.push(`[api:3] ${r} opens a transaction directly; use TransactionRunner.run(...)`);
  }
  for (const spec of importsOf(file)) {
    if (!spec.startsWith("@api/modules/")) continue;
    if (!isSpec && (layer === "common" || layer === "infrastructure") && !API_LEGACY_EXCEPTIONS.has(r)) {
      violations.push(`[api:1] ${r} (lower layer) imports ${spec}`);
    }
    const target = spec.split("/")[2];
    const own = layer === "modules" ? r.split("/")[4] : null;
    if (layer === "modules" && own && target !== own && /\/(controllers|jobs)\//.test(spec) && !isSpec) {
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
