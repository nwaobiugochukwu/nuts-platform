# NUTS API

The API is a NestJS modular monolith exposed under `/api/v1`. Its domain modules share PostgreSQL/Prisma, Redis, RabbitMQ, logging, configuration, and provider integrations. The [backend module map](../../docs/reference/backend-module-map.md) follows every folder in `src/modules` and links each module to its domain and frontend surface. End-to-end behavior belongs in the [domain guides](../../docs/domains/README.md). The **NUTS Engineering & Distributed Systems Field Manual** is in [the documentation guide](../../docs/engineering/field-manual/README.md). The root README is the project landing page and quickstart. This file focuses on API development, contracts, and operations.

## Backend layout

- [`src/modules`](src/modules) — domain controllers, services, DTOs, and jobs. The [backend module map](../../docs/reference/backend-module-map.md) provides code navigation; domain behavior is documented in the [domain guides](../../docs/domains/README.md).
- [`src/common`](src/common) — shared DTOs, decorators, guards, filters, pipes, pagination, and utilities.
- [`src/infrastructure`](src/infrastructure) — Prisma, Redis/cache, RabbitMQ, outbox, configuration, logging, mail, media, and resilience.
- [`test`](test) — HTTP/E2E-style API tests; the current suites mock database and infrastructure dependencies.
- [`packages/database`](../../packages/database) — Prisma schema and ordered migrations.

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
  - Vendor Follows & Public Storefront: Canonical `POST` & `DELETE /api/v1/vendors/:vendorId/follow`, and public store endpoints `GET /api/v1/vendors/:storeSlug`, `/products`, `/followers/count`.
- **Unified Endpoints via `@OptionalAuth()`:** The recommendation engine (`/api/v1/recommendations/for-you`, `/trending`, `/daily-mix`, `/by-category`) uses the custom `@OptionalAuth()` decorator. It transparently attaches authenticated user context if valid JWT credentials exist, but permits anonymous guests without throwing `401 Unauthorized` or `403 Forbidden`. Legacy `/session` endpoints (e.g. `/for-you/session`) are retained via array route decorators for zero-downtime backwards compatibility.
- Product discovery uses `GET /api/v1/discover` and keyset cursors. Search and some administrative lists use page-based pagination; do not assume a single pagination shape.
- Paystack webhooks are verified against the raw request body and provider signature. Full refunds create a durable attempt and settle local order, stock, and vendor-earning changes only after provider confirmation. Partial refunds and post-shipment returns are not currently supported.
- Customer and vendor Google sign-in accept verified Google Identity Services ID tokens, then issue the normal role-scoped session. Sign-in routes (`POST /api/v1/auth/google` and `POST /api/v1/vendors/auth/google`) never create accounts; explicit registration routes (`POST /api/v1/auth/google/register` and `POST /api/v1/vendors/auth/google/register`) handle Google signup. API `GOOGLE_CLIENT_ID` must match the web `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- Selected order, payment, refund, notification, and vendor-follow events use the transactional outbox. The relay claims batches with `FOR UPDATE SKIP LOCKED`, retries broker publishing up to its configured limit, and delivers at least once. Consumer failures currently go to the shared DLQ without a delayed retry queue.

## Important API surfaces

- **Authentication:** `/api/v1/auth`, `/api/v1/vendors/auth`, `/api/v1/admin/auth`.
- **Catalog and discovery:** `/api/v1/products`, `/api/v1/categories`, `/api/v1/discover`, `/api/v1/search`.
- **Customer commerce:** `/api/v1/cart`, `/api/v1/orders`, `/api/v1/payments`, `/api/v1/wallet`, `/api/v1/wishlist`, `/api/v1/reviews`.
- **Vendor operations:** vendor-scoped products, variants, orders, discounts, wallet, analytics, account and store routes.
- **Marketplace engagement:** `/api/v1/recommendations`, `/api/v1/analytics`, `/api/v1/vendors/follows`, and referral routes.
- **Platform governance:** `/api/v1/admin/platform`, `/api/v1/admin/staff`, `/api/v1/admin/announcements`, and role-scoped admin catalog/order/user routes.
- **Notifications and health:** notification inbox/preferences/push/SSE routes and `/api/v1/health`.

See the generated Swagger contract for exact route methods, DTOs, role requirements, response fields, and endpoint-specific pagination.

## Analytics and event behavior

Analytics definitions, current ingestion mechanisms, failure cases, and reporting flows are in [Analytics and Measurement](../../docs/domains/analytics-and-measurement.md). Storage alternatives are in [Analytics at Scale](../../docs/scaling/analytics-at-scale.md), while capacity methodology and results belong in [Performance and Capacity](../../docs/performance/README.md). Dashboards share PostgreSQL with commerce and the web currently polls them. No measured request or event capacity is published yet.

## Swagger

Swagger UI is available at `http://localhost:3001/api/docs` when enabled. `SWAGGER_ENABLED=true` works in development and explicitly selected staging; production disables Swagger even if the flag is set. JSON and YAML documents are available at `/api/docs-json` and `/api/docs-yaml` when Swagger is enabled.

The Swagger documentation taxonomy is structured into 5 enterprise domain groups:
1. **Customer Commerce:** Catalog, Cart, Checkout, Orders, Payments, Customer Wallet, Reviews, Wishlist, Recommendations, and Analytics.
2. **Merchant & Vendor Operations:** Vendor Auth, Store Profile, Products, Variants, Inventory, Fulfillment, Escrow Wallet, Discounts, and Metrics.
3. **Platform Administration & Governance:** Platform Settings, Staff Lifecycle, Vendor Approvals, Global Taxonomy, Order Management, and Platform Announcements.
4. **Identity & Security:** Customer & Staff Auth, Google OIDC Integration, OTP Lifecycle, Multi-Session Management, and Tokens.
5. **System & Infrastructure:** Health, Outbox, Distributed Locks, and System Metrics.

Tag alphabetical sorting is disabled (`tagsSorter: 'alpha'` removed) to preserve business domain hierarchy and natural operational workflows.

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

The production and staging Compose profiles run a migration job before the API. GitHub Actions publishes API images to GHCR; host rollout, readiness verification, and rollback remain outside that workflow. See the [architecture diagrams](../../docs/architecture/README.md), [codebase audit](../../docs/audits/CODEBASE_AUDIT.md), and [Scaling Strategy](../../docs/scaling/README.md).
