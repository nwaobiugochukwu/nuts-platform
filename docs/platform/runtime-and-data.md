# Platform Runtime and Data

This guide covers shared runtime boundaries and cross-cutting infrastructure. Business workflows belong in the [domain guides](../domains/README.md); diagrams live in the [architecture gallery](../architecture/README.md); host-specific actions belong in [Operations](../operations/README.md).

## Deployable units and system boundary

NUTS is a TypeScript monorepo with two deployable applications and shared packages. The backend is a NestJS modular monolith. Its modules own domain use cases and HTTP controllers; shared infrastructure provides PostgreSQL/Prisma, Redis, RabbitMQ, logging, email, media, and payment integrations. The web app is a Next.js App Router application with storefront, vendor, and admin route groups.

This is not a microservice-per-domain system. API modules share one process and database, and selected workflows publish messages through a transactional outbox. Database transactions remain the consistency boundary for commerce state.

## Repository boundaries

| Path | Responsibility |
| --- | --- |
| apps/api/src/common | Shared DTOs, decorators, filters, guards, pipes, and utilities |
| apps/api/src/infrastructure | Prisma, Redis/cache, RabbitMQ, outbox, configuration, and observability |
| apps/api/src/modules | Domain modules and their controllers, DTOs, and application services |
| apps/web/src/app | Next.js route groups and server-rendered page entry points |
| apps/web/src/components | Shared UI and customer, vendor, and admin surfaces |
| apps/web/src/api | Typed browser clients and server-side API adapters |
| packages/database | Prisma schema and ordered PostgreSQL migrations |
| packages/config | Shared lint/build configuration |
| packages/types | Types shared between workspaces |
| nginx | Reverse proxy configuration and production TLS mounts |

API domains currently include admin, analytics, auth, cart, categories, discounts, health, notifications, orders, payments, products, recommendations, referrals, reviews, search, security, upload, users, vendors, wallets, and wishlists.

## Runtime, consistency, and data ownership

- The API is a NestJS modular monolith and the web application is a separate Next.js process. PostgreSQL is the system of record; Prisma is the data access layer. Redis supports caching and coordination. The API does not implement system-wide CQRS or event sourcing.
- Selected business writes and their outbox events commit in the same database transaction. The relay delivers messages at least once; notification consumers deduplicate by business key or event ID. Email dispatch remains a separate asynchronous flow.
- Payment confirmation verifies Paystack before settlement. A captured payment that cannot transition its order into processing is recorded for reconciliation and does not credit vendor earnings. Vendor earnings remain pending until delivery.
- Full refund requests create a durable attempt and stable Paystack reference. The API returns `202` while a refund is pending; shipment is blocked, and payment, stock, and vendor-earnings changes occur only after `refund.processed`. `refund.failed` restores the prior order/payment state. Partial refunds and post-shipment returns are not supported.

## Platform implementation design

### Platform model
Governs how the NestJS API communicates with PostgreSQL, manages connection lifecycles, runs database migrations safely, and logs slow queries.

### Problems and controls
- **PostgreSQL Connection Starvation & Pool Exhaustion:**
  - *The Failure Mode:* Cloud containers and traffic surges can multiply application database connections until they exceed PostgreSQL's connection budget.
  - *How NUTS Solved It:* `PrismaService` uses `@prisma/adapter-pg` with a configurable per-process pool. `DB_CONNECTION_LIMIT` defaults to 15 in code (the example environment sets 10); the total upper bound grows with API replicas. A hosting provider's transaction pooler can be used via `DATABASE_URL`, but no PgBouncer service is bundled with the application.
- **Migration Advisory Lock Conflicts on Pooled Connections:**
  - *The Failure Mode:* Some transaction-mode poolers do not support session-level behavior required by schema migration tooling.
  - *How NUTS Solved It:* The checked-in environment example separates runtime `DATABASE_URL` from migration `DIRECT_URL`. The actual host and ports come from the configured database provider; when a transaction pooler is used at runtime, point migrations at a direct/session connection.

### Current backend configuration
- **Runtime PostgreSQL Pool:** `@prisma/adapter-pg` owns the API process pool. `DB_CONNECTION_LIMIT` defaults to 15 in code; `DB_IDLE_TIMEOUT_MS` defaults to 300,000 ms; `DB_POOL_TIMEOUT` defaults to 30 seconds. The pool enables TCP keepalive. The checked-in example overrides some defaults, so deployed values must be read from deployment configuration.
- **Migration URL:** `DIRECT_URL` is provided separately in the example for migration tooling when the runtime URL points to a transaction pooler. Pooler host/port details are provider-specific rather than a fixed in-repository topology.

### Application interaction
- **Next.js Server Component Fetcher (`server-fetcher.ts`):** Direct server-to-server API calls with upstream latency tracking and automatic timeout aborts (3.5s prod, 15s dev).
- **Next.js Standalone Build:** The web Dockerfile uses Next.js standalone output to package the runtime application. Record actual image sizes from built artifacts before making size-reduction claims.

### Platform terms
- **PgBouncer:** A lightweight connection pooler for PostgreSQL that allows thousands of client connections to share a small pool of actual database connections.
- **Session Pooling vs. Transaction Pooling:** In session pooling, a client keeps one physical connection until it disconnects. In transaction pooling, the client borrows a connection only for the millisecond duration of a single query or transaction.

### Failure scenarios and edge cases
- Database restarts handled gracefully via pool reconnect backoff.
- Slow query detection without logging sensitive user parameters.
- Schema migration lock timeouts preventing deployment deadlocks.

### Trade-offs and design considerations
- *Never run Prisma migrations through a transaction-mode connection pooler; migrations require direct session mode.*
- *Cap application connection pool sizes to prevent database connection exhaustion during traffic spikes.*

---

## API health and readiness

Hosts need to distinguish a running process from an API whose required dependencies are unavailable.

#### Current backend mechanism

The API exposes health routes used by Compose probes; dependency readiness is limited to the checks defined by the health controller.

#### Failure scenarios and trade-offs

Keep liveness cheap and separate from dependency readiness. Do not make transient optional providers take down liveness; add dependency-specific operational monitoring where health responses do not provide enough diagnosis.

## Swagger and API contract publication

Swagger is registered at /api/docs only when `SWAGGER_ENABLED=true` in development or when staging is explicitly selected with NODE_ENV=staging or APP_ENV=staging. A staging hostname alone does not enable it. Production blocks Swagger even when enabled. The JSON document is /api/docs-json and YAML is /api/docs-yaml when enabled.

Controllers should document the actual response envelope, auth requirement, query filters, cursor metadata, and error responses. Public endpoints must not inherit bearer requirements from a controller-wide annotation. Generated API contracts should be reviewed alongside DTO or route changes.

## Deployment and runtime configuration

The root workspace uses npm workspaces and Turborepo. Docker builds the API and web applications separately. The web production image uses Next standalone output and runs as a non-root user. Compose production runs api-migrate once before api-prod and client-prod; it also expects Nginx TLS files at nginx/certs/origin.pem and nginx/certs/origin-key.pem.

GitHub Actions CI validates the lockfile, runs lint and typecheck, runs API and web authentication test suites, and builds both applications. The workflow named deploy builds and pushes SHA and environment-tagged images to GitHub Container Registry after successful CI; it does not roll those images onto a host or verify a live rollout. Manual production image publishing is restricted to the `main` ref. Host deployment, health verification, and rollback remain external operational steps and should be documented with the selected hosting platform.

Production configuration must provide external secrets and service URLs; the checked-in environment files are examples. The API uses Prisma's `pg` adapter with a per-process pool; `DB_CONNECTION_LIMIT` defaults to 15 in code and pool settings multiply by API replica count. The example uses a provider transaction-pool URL for runtime and a direct/session `DIRECT_URL` for migrations, but provider and port are deployment choices. The API requires an enabled RabbitMQ broker URL using AMQPS and a non-guest account in production because the outbox depends on the relay. Configure the API and web JWT secret consistently. Use a deployment secret manager, TLS termination, database backups, migration roll-forward procedures, health monitoring, and broker/Redis persistence appropriate to the chosen host.

## Related operator guidance

- [Release and recovery](../operations/runbooks/release-and-recovery.md)
- [Performance and Capacity](../performance/README.md)
- [Engineering Field Manual](../engineering/field-manual/README.md)

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#platform-runtime-and-database-concurrency) is the canonical plan for database connection budgets, API replicas, shared background work, observability, and deployment growth. The benchmark method and current configuration are in [Performance and Capacity](../performance/README.md).
