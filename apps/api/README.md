# NUTS API

The API is a NestJS modular monolith exposed under `/api/v1`. Its domain modules share PostgreSQL/Prisma, Redis, RabbitMQ, logging, configuration, and provider integrations. The [backend module map](../../docs/reference/backend-module-map.md) follows every folder in `src/modules` and links each module to its domain and frontend surface. End-to-end behavior belongs in the [domain guides](../../docs/domains/README.md). The **NUTS Engineering & Distributed Systems Field Manual** is in [the documentation guide](../../docs/engineering/field-manual/README.md). The root README is the project landing page and quickstart. This file focuses on API development, contracts, and operations.

## Backend layout

- [`src/modules`](src/modules) — domain controllers, services, DTOs, and jobs. The [backend module map](../../docs/reference/backend-module-map.md) provides code navigation; domain behavior is documented in the [domain guides](../../docs/domains/README.md).
- [`src/common`](src/common) — shared DTOs, decorators, guards, filters, pipes, pagination, and utilities.
- [`src/infrastructure`](src/infrastructure) — Prisma, Redis/cache, RabbitMQ, outbox, configuration, logging, mail, media, and resilience.
- [`src/app.e2e-spec.ts`](src/app.e2e-spec.ts) and [`src/modules/payments/tests/payment-flow.e2e-spec.ts`](src/modules/payments/tests/payment-flow.e2e-spec.ts) — HTTP end-to-end suites (`npm run test:e2e`, configured by [`src/jest-e2e.json`](src/jest-e2e.json)); they boot the whole application with the database and infrastructure replaced by stand-ins. Unit tests live in each module's `tests/` folder, one flat folder with no subfolders.
- [`packages/database`](../../packages/database) — Prisma schema and ordered migrations.

Layers depend one way: `modules → common → infrastructure`, and a module never imports another module's `controllers/` or `jobs/`. `npm run check:architecture` enforces this in CI; see [Code organization and dependency rules](../../docs/architecture/code-organization.md).

The API is not a microservice per module and does not implement system-wide CQRS or event sourcing. Selected business writes persist outbox rows in the same transaction. Outbox delivery is at least once, so consumers need idempotency.

## API contracts

- Base path: `/api/v1`.
- Successful responses use `{ success, message, data, meta?, timestamp }`; pagination metadata varies by endpoint. Follow the endpoint's Swagger contract.
- Customer, vendor, and admin routes have separate authorization boundaries. Vendor access additionally depends on account activation and approval.
- **Canonical RESTful Resource Hierarchy:** Resources follow standard parent-child REST hierarchies with backward-compatible aliases for legacy routes:
  - Product Reviews: Canonical `GET /api/v1/products/:productId/reviews` (aliased to legacy `/api/v1/reviews/product/:productId`).
  - Order Payments: Canonical `GET /api/v1/orders/:orderId/payment` (aliased to legacy `/api/v1/payments/order/:orderId`).
  - Vendor Product Variants: Canonical `POST` & `GET /api/v1/vendors/products/:productId/variants` (aliased to `/api/v1/vendors/products/variants`).
  - Admin Product Variants: Canonical `POST` & `GET /api/v1/admin/products/:productId/variants` (aliased to `/api/v1/admin/products/variants`).
  - Vendor Follows & Public Storefront: Canonical `POST` & `DELETE /api/v1/vendors/:vendorId/follow`, and public store endpoints `GET /api/v1/vendors/:storeSlug`, `/products`, `/followers/count`. `VendorFollowsController` is registered before `PublicStoreController` in `VendorsModule` so the explicit `GET /api/v1/vendors/follows` path is not shadowed by the `:storeSlug` wildcard. Follow buttons on the storefront use optimistic state updates (no "Checking…" loading state).
- **Unified Endpoints via `@OptionalAuth()`:** The recommendation engine (`/api/v1/recommendations/for-you`, `/trending`, `/daily-mix`, `/by-category`) uses the custom `@OptionalAuth()` decorator. It transparently attaches authenticated user context if valid JWT credentials exist, but permits anonymous guests without throwing `401 Unauthorized` or `403 Forbidden`. Legacy `/session` endpoints (e.g. `/for-you/session`) are retained via array route decorators for zero-downtime backwards compatibility.
- Product discovery uses `GET /api/v1/discover` and keyset cursors. Search and some administrative lists use page-based pagination; do not assume a single pagination shape.
- Paystack webhooks are verified against the raw request body and provider signature. Full refunds create a durable attempt and settle local order, stock, and vendor-earning changes only after provider confirmation. Partial refunds and post-shipment returns are not currently supported.
- Customer and vendor Google sign-in accept verified Google Identity Services ID tokens, then issue the normal role-scoped session. Sign-in routes (`POST /api/v1/auth/google` and `POST /api/v1/vendors/auth/google`) never create accounts; explicit registration routes (`POST /api/v1/auth/google/register` and `POST /api/v1/vendors/auth/google/register`) handle Google signup. API `GOOGLE_CLIENT_ID` must match the web `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- Selected order, payment, refund, notification, and vendor-follow events use the transactional outbox. The relay claims batches with `FOR UPDATE SKIP LOCKED`, retries broker publishing up to its configured limit, and delivers at least once. Consumer failures currently go to the shared DLQ without a delayed retry queue.

## Important API surfaces

- **Authentication & identity:** `/api/v1/auth`, `/api/v1/vendors/auth`, `/api/v1/admin/auth`.
- **Catalog & discovery:** `/api/v1/products`, `/api/v1/categories`, `/api/v1/discover`, `/api/v1/search`.
- **Customer commerce:** `/api/v1/cart`, `/api/v1/orders`, `/api/v1/payments`, `/api/v1/wallet`, `/api/v1/wishlist`, `/api/v1/reviews`.
- **Marketplace engagement & telemetry:** `/api/v1/recommendations`, `/api/v1/analytics`, `/api/v1/vendors/follows`, and referral routes.
- **Voucher wallet and automatic discounts:** `GET/POST/DELETE /api/v1/discounts/claims` manage a customer's claimed vouchers (limited-quantity codes hold a 24-hour reservation; automatic offers cannot be claimed). `GET /api/v1/cart/discount-preview` accepts `codes` and `automatic=1`; with `automatic=1` it also applies automatic (no-code) discounts and reports per-voucher problems instead of failing. Checkout sends only typed/claimed `discountCodes`; automatic discounts are resolved server-side by the same engine. Customer order responses include `appliedVouchers` (code or offer name, scope, amount, `automatic`).
- **Public discount discovery:** `GET /api/v1/public/discounts/campaigns` returns active and upcoming platform campaigns; `POST /api/v1/public/discounts/best-value-deal` calculates card deals for single products or batches up to 100 product IDs; `GET /api/v1/public/discounts/:productId/available-product-deals-and-vouchers` returns the complete deal evaluation and claimable voucher intelligence for a product detail page. High-performance two-tier Redis caching (180s TTL) with instant invalidation upon discount mutations ensures zero stale data. Optional authentication hides first order offers from shoppers with a non-cancelled order.
- **Telemetry & Self-View Exclusion:** `POST /api/v1/analytics/events` and `POST /api/v1/analytics/events/store-view` implement server-side self-view filtering. Administrators viewing products or stores, as well as vendors viewing their own store or their own products, are quietly dropped from view counters, conversion funnels, and recent-view tables, while peer vendor and shopper interactions are recorded. For store accounts browsing peer merchants, views are attributed via `visitorId` (e.g. `vendor:<id>`) without populating customer `userId` foreign key columns, strictly preventing relational constraint errors (`P2003`) while preserving authentic traffic analytics.
- **Review Caching:** `GET /api/v1/products/:productId/reviews` and `/api/v1/reviews/product/:productId` utilize 5-minute Redis caching (`product:reviews:<productId>:v2`) and respond with HTTP `Cache-Control: public, max-age=60, s-maxage=120, stale-while-revalidate=60`. Cache entries are purged immediately upon review submission or deletion.
- **Notifications & health:** `/api/v1/notifications` (inbox, preferences, push, SSE stream) and `/api/v1/health`.

The notification stream is `GET /api/v1/notifications/sse/stream`. It authenticates with the standard bearer `Authorization` header or HttpOnly access cookie; JWTs in query parameters are not accepted. `Last-Event-ID` may be sent as a header, with `lastEventId` as a non-secret replay fallback.

The push sub-module exposes:
- `GET /api/v1/notifications/push/vapid-key` — public endpoint returning the VAPID public key for browser subscription.
- `POST /api/v1/notifications/push/subscribe` — upserts a browser `PushSubscription` record (endpoint + VAPID crypto keys) for the authenticated user.
- `POST /api/v1/notifications/push/unsubscribe` — removes a push subscription record by endpoint.
- `GET /api/v1/notifications/push/status?endpoint=<url>` — returns `{ registered, pushEnabled }` for a given push endpoint, used by the client sync loop.
- `POST /api/v1/notifications/push/test` — sends a test push notification to all registered devices for the authenticated user.

Toggling `pushEnabled` via `PATCH /api/v1/notifications/preferences` is the sole control for enabling/disabling push delivery. The backend's `NotificationPreferencesService` checks `pushEnabled` before dispatching any push message; the browser subscription record is **not deleted** when the user disables push (only the preference flag changes). This allows instant re-activation without FCM re-negotiation on the next toggle-on.
- **Platform governance & administration:** `/api/v1/admin/platform`, `/api/v1/admin/staff`, `/api/v1/admin/announcements`, and role-scoped admin catalog/order/user routes.
- **Vendor operations:** vendor-scoped products, variants, orders, discounts, wallet, analytics, account, and store routes.

See the generated Swagger contract for exact route methods, DTOs, role requirements, response fields, and endpoint-specific pagination.

## Analytics and event behavior

Analytics definitions, current ingestion mechanisms, failure cases, and reporting flows are in [Analytics and Measurement](../../docs/domains/analytics-and-measurement.md). Storage alternatives are in [Analytics at Scale](../../docs/scaling/analytics-at-scale.md), while capacity methodology and results belong in [Performance and Capacity](../../docs/performance/README.md). Dashboards share PostgreSQL with commerce and the web currently polls them. No measured request or event capacity is published yet.

Recent browsing is persisted in PostgreSQL `recent_product_views` and served by `/api/v1/recommendations/recently-viewed`; anonymous rows expire after 180 days, while account rows are retained for account continuity. Anonymous session/visitor IDs are browser-local identifiers, not the product history itself. `product_views` are retained for 730 days, while recommendation attribution events are retained for 180 days except follow/unfollow events. `/api/v1/recommendations/for-you` computes its response from those records plus searches, cart and wishlist activity, qualifying orders, category activity, and follows; recommendation results are not persisted as a browser-side list.

The global exception response preserves `maintenanceMode: true` and the configured message on blocked requests, including in production, so clients can render the notice without a separate status-polling endpoint.

## Swagger

Swagger UI is available at `http://localhost:3001/api/docs` when enabled. `SWAGGER_ENABLED=true` works in development and explicitly selected staging; production disables Swagger even if the flag is set. JSON and YAML documents are available at `/api/docs-json` and `/api/docs-yaml` when Swagger is enabled.

Swagger documentation tags and operations are arranged in alphabetical order (`tagsSorter: 'alpha'`, `operationsSorter: 'alpha'`) with alphabetically declared OpenAPI domain tags (`ADMIN - *`, `AUTH`, `CART`, `CATEGORIES`, `NOTIFICATIONS`, `ORDERS`, `PRODUCTS`, `VENDOR - *`, etc.) for intuitive scanning and consistent contract generation in development and staging environments.

## Local development

From the repository root:

```bash
npm ci
cp -n apps/api/.env.example apps/api/.env.development
npm run db:up
npm run db:generate
npm run migrate:dev
npm run dev:api
```

Before starting the API, set its local environment to use PostgreSQL at `localhost:5433` (`nuts_dev` / `postgres` / `postgrespassword`), Redis at `localhost:6379`, and RabbitMQ at `amqp://nuts:nuts_local_dev@localhost:5672`. The checked-in API example contains hosted-database placeholders; replace them for local development. `npm run dev` from the root starts the database Compose stack and workspace development tasks together.

## Useful commands

| Command | Purpose |
|---|---|
| `npm run dev:api` | Start the API development workflow from the repository root. |
| `npm run build:api` | Build the API. |
| `npm run typecheck:api` | Type-check the API. |
| `npm run lint:api` | Lint API sources. |
| `npm run test:api` | Run the API Jest suites. |
| `npm run --prefix apps/api test:e2e` | Run the API HTTP/E2E-style suite. |
| `npm run db:generate` | Generate Prisma Client. |
| `npm run migrate:dev` | Apply development migrations. |
| `npm run migrate:status` | Inspect migration state. |

The current automated suites cover unit and HTTP-level behavior with mocked infrastructure; they do not prove real PostgreSQL transaction, broker, or production-load behavior. Capacity methodology is in [Performance and Capacity](../../docs/performance/README.md); proposed scale architecture is in the [Scaling Strategy](../../docs/scaling/README.md).

## Configuration and deployment

Use [`apps/api/.env.example`](.env.example) as the API variable inventory. For production/staging Compose, environment files are selected with root `APP_ENV`; keep provider secrets in the deployment secret manager. When runtime uses a transaction-pool URL, configure `DIRECT_URL` for migration operations. The API and web server-side session checks must use matching JWT verification secrets. Do not commit populated environment files.

**Push notification (VAPID) variables** that must be set in every deployed environment:

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | EC P-256 uncompressed public key (URL-safe base64). Must match `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the web client. |
| `VAPID_PRIVATE_KEY` | EC P-256 private key (URL-safe base64, keep secret). |
| `VAPID_SUBJECT` | Contact URI for VAPID auth header, e.g. `mailto:you@example.com`. |

Generate a fresh VAPID key pair with: `npx web-push generate-vapid-keys`.

The production and staging Compose profiles run a migration job before the API. GitHub Actions publishes API images to GHCR; host rollout, readiness verification, and rollback remain outside that workflow. See the [architecture diagrams](../../docs/architecture/README.md), and [Scaling Strategy](../../docs/scaling/README.md).
