# NUTS Scaling, Concurrency, and Traffic Strategy

This is the source of truth for proposed scaling directions across NUTS. It describes how to respond as traffic, concurrency, catalog size, event volume, and operational load grow. The steps are proposals with evidence-based triggers, not commitments or capacity claims. Current behavior belongs in the [domain guides](../domains/README.md); measured results belong in [Performance and Capacity](../performance/README.md).

## Current capacity status

NUTS has no reproducible production-like load-test result, so its sustainable concurrent clients, requests per second, analytics events per second, and latency under load are **unknown**. Repository settings provide test inputs, not throughput guarantees. The [performance guide](../performance/README.md) records the current configuration and the benchmark method needed to compare it with future deployment profiles.

Do not estimate capacity by multiplying a per-process pool size, throttle setting, or batch limit. Report concurrent clients, requests per second, event rate, latency, errors, and resource pressure separately. Compare profiles only with the same workload, data shape, service versions, and acceptance targets.

## Recommended sequence

1. **Set service targets and measure the current profile.** Define latency/error targets for browsing, search, checkout, analytics ingestion, reports, and notifications. Benchmark the checked-in Compose resource shape with representative data, then record the first bottleneck and recovery behavior.
2. **Fix the measured bottleneck and bound work.** Prefer query/index improvements, short transactions, bounded buffers, batch writes, backpressure, queue-age alerts, and idempotent retries before adding infrastructure.
3. **Scale application replicas with shared-resource budgets.** Budget database pools across every API process, worker, migration, and operator client. Verify shared scheduler coordination, consumer behavior, rate limits, cache/session consistency, and the deployment topology before increasing replicas. The production Compose API has a fixed container name, which must be removed before running multiple copies in the same Compose project.
4. **Separate workloads that compete with commerce.** Analytics reads and ingestion are the first candidates because they scan and write event data while sharing PostgreSQL with orders, inventory, payments, and wallets. Keep transactional business truth in PostgreSQL while moving derived analytics to separately sized storage only when measurements justify it.
5. **Introduce specialized systems only for demonstrated needs.** A search cluster, stream processor, model-serving system, or independently deployed service adds data synchronization and operations. Adopt one only when a measured requirement cannot be met by a simpler stage and an owner can operate it.

## System-by-system scale plan

| System area | First signal to watch | Recommended progression |
|---|---|---|
| [Web/API runtime and database](#platform-runtime-and-database-concurrency) | Web render latency, cache hit/miss, API p95/p99, pool wait, database CPU/IO, lock wait, replica pressure | Scale web and API independently, tune queries/pools, then add replicas within the connection budget; consider pooling or read isolation only for measured needs. |
| [Identity and security](#identity-and-security-traffic) | Redis throttle fallback, auth/refresh errors, abuse rate, token/session contention | Preserve database-authoritative session rules; move emergency limits to shared state and tune per-route controls from traffic evidence. |
| [Marketplace governance](#vendors-marketplace-and-governance) | Vendor-picker limits, slug conflicts, announcement backlog and lease recovery | Add server-side vendor search, bounded uniqueness retries, and observable resumable campaign processing as volume requires. |
| [Catalog, media, and reviews](#catalog-media-and-reviews) | Query plans, cursor latency, upload cost/orphans, review aggregate drift | Keep stable pagination and indexed reads; add facets, bulk operations, media quotas, cleanup, or aggregate repair when data size/policy requires them. |
| [Discovery and recommendations](#discovery-and-recommendations) | Search p95/relevance, recommendation query count, freshness and diversity | Tune PostgreSQL and bounded candidate reads first; evaluate a separate search index or ML ranker only against measured outcomes. |
| [Checkout, inventory, and orders](#checkout-inventory-promotions-and-orders) | Stock-row lock wait, transaction duration, deadlocks, checkout conflicts | Preserve atomic database inventory checks and idempotency; optimize lock scope/order before considering a bounded reservation workflow for proven hot items. |
| [Payments and financial ledgers](#payments-and-financial-ledgers) | Provider timeout/retry backlog, unreconciled captures/refunds, ledger mismatches | Keep provider state transitions durable and idempotent; add operator reconciliation and exception queues before expanding payment/refund behavior. |
| [Referrals and growth](#referrals-and-growth) | Duplicate reward attempts, abuse patterns, attribution inconsistency | Enforce unique reward/idempotency records and server-side eligibility; add campaign controls based on abuse and volume data. |
| [Analytics and reporting](#analytics-ingestion-and-reporting) | Event age, buffer/queue depth, DB write load, dashboard query cost/freshness | Bound and batch the current path, roll up and partition when useful, then isolate analytics storage or adopt a stream/store when justified. |
| [Notifications and asynchronous delivery](#notifications-and-asynchronous-delivery) | Outbox age, RabbitMQ ready/unacked/DLQ depth, SSE connections, delivery lag | Keep consumers idempotent, bound retries, add operator replay and durable email jobs, and load-test long-lived streams before scaling fan-out. |

## Platform runtime and database concurrency

The API is a modular monolith. Every API replica owns its own Prisma connection pool, while PostgreSQL remains the system of record. Redis and RabbitMQ support selected cache, coordination, buffering, and asynchronous workflows. See [Platform Runtime and Data](../platform/runtime-and-data.md) for current pool defaults and deployment boundaries.

Recommended steps:

1. Record active and waiting database connections, pool acquisition wait, query latency, lock wait, slow queries, API CPU/memory, and request p95/p99 during representative workloads.
2. Budget connections as `API replicas × pool limit + worker pools + migrations + operator clients`. Reserve capacity for database administration and maintenance. Do not raise every pool when requests queue; first determine whether the pool, database, or query plan is limiting.
3. Reduce avoidable query work, shorten transactions, and cap expensive report or list requests. Keep migrations on `DIRECT_URL` when runtime uses a transaction pooler.
4. Add API replicas only after checking total connection demand, distributed scheduler locks, RabbitMQ competing-consumer semantics, rate-limit consistency, health/readiness behavior, and the fixed Compose container-name constraint.
5. Consider a managed connection pooler when client connection count or churn exceeds the database's useful connection budget. Consider read replicas only for measured read pressure and only after the affected paths can tolerate replication lag. Payments, stock, order state, and wallet balance decisions must continue to use authoritative transactional state.
6. Keep the modular monolith while shared deployment and ownership remain useful. Extract a service only when it needs independent scaling or release cadence, has a clear data boundary, and the team can operate its network, retry, observability, and failure contracts.

**Trade-offs:** More API replicas add process capacity but also multiply pools, schedulers, and background consumers. Poolers reduce backend connection count but add a runtime boundary and can change transaction/session behavior. Read replicas lower primary read load but introduce lag and routing complexity.

### Web rendering and delivery

The Next.js web app is a separate deployable from the API. Public server-rendered pages, personalized shelves, and authenticated portal pages have different cache and compute needs.

Recommended steps:

1. Benchmark public browsing, personalized browsing, and authenticated vendor/admin work separately. Record CDN/static asset cache behavior, server-render latency, internal API latency, and browser-visible p95/p99.
2. Serve versioned static assets and public media through the configured CDN/provider. Cache public catalog responses only where invalidation and freshness rules are explicit; keep cart, account, order, and personalized recommendation responses private and correctly varied by identity.
3. Use existing server fetch timeouts and Next.js revalidation deliberately. Avoid increasing cache lifetime to hide slow database queries without defining stale-data tolerance and mutation invalidation.
4. Scale the web runtime independently from the API when rendering CPU, memory, or connection pressure is the bottleneck. Check server-to-server connection reuse, timeout budgets, and retry behavior so a web replica burst does not amplify failing API traffic.

**Trade-offs:** Shared caching reduces repeated public reads but can serve stale catalog data if invalidation is incomplete. Personalized caching needs identity-safe keys and can reduce hit rate; never let cache reuse cross customer, vendor, or admin boundaries.

## Identity and security traffic

Auth and security paths must preserve role enforcement, token rotation, lock checks, and abuse controls during load or infrastructure failure. The current Redis-outage throttle fallback is per process, so limits can multiply across replicas; refresh rotation also has a documented database-commit-to-Redis-cache race. Current details are in [Identity, Accounts, and Security](../domains/identity-and-account-security.md).

Recommended steps:

1. Measure authentication, OTP, refresh, account-lock, and authorization traffic independently. Track rejected requests, Redis errors, fallback activation, and concurrent refresh outcomes without logging credentials or tokens.
2. Alert immediately when Redis-backed throttling falls back. If cross-replica enforcement is required, use a shared limiter with atomic updates and explicit failure behavior rather than increasing per-process counters.
3. Keep database conditional updates authoritative for refresh rotation and account state. Add targeted concurrency/outage coverage before changing replay or revocation behavior.
4. Tune limits per route and risk profile after observing legitimate traffic. Apply request/body limits and provider quotas before scaling expensive auth or verification work horizontally.
5. Define data export, deletion/anonymization, and retention behavior across backups and derived analytics before account volume makes those paths operationally expensive.

## Vendors, marketplace, and governance

Vendor registration currently has a concurrent slug-uniqueness conflict path; the vendor picker is bounded, and admin announcements use resumable batches. Current flows are in [Vendors and Marketplace Governance](../domains/vendors-and-marketplace-governance.md).

Recommended steps:

1. Add a small bounded retry for generated store-slug uniqueness conflicts, handling only the expected unique-constraint race and returning a clear conflict when retries are exhausted.
2. Replace first-page-only vendor selection with server-side search or cursor pagination when the measured vendor count or picker latency makes the existing bound inadequate.
3. Track announcement campaign backlog, recipient throughput, expired leases, and failure rate. Preserve recipient idempotency and resumable keyset batches; tune batch size only against database and notification pressure.
4. Put late payment captures and refunds needing attention into a permissioned, audited operator work queue. Keep the exception workflow separate from ordinary vendor governance while linking the operational UI to the relevant payment record.

## Catalog, media, and reviews

Catalog growth affects search/list query plans, cursor stability, taxonomy reads, uploaded assets, and rating aggregates. Current mechanisms are in [Catalog and Product Content](../domains/catalog-and-product-content.md).

Recommended steps:

1. Benchmark public, vendor, and admin catalog queries using production-like counts and filters. Validate indexes against actual sort/filter/cursor combinations and inspect rows scanned and p95/p99 latency.
2. Preserve deterministic keyset ordering for long feeds. Add attribute facets, deeper taxonomy controls, or bulk vendor catalog operations only when measured use and query plans support them.
3. Add media size/type quotas, abandoned-upload cleanup, provider failure telemetry, and cost monitoring as upload volume or abuse risk grows. Do not let a product reference an asset before its provider upload is usable.
4. Add moderation and rating-aggregate reconciliation procedures as review volume and policy needs grow. Keep moderation state and visible ratings consistent.
5. Treat inventory write contention as a checkout concern: catalog reads may scale separately, but inventory availability displayed on a product page is advisory until checkout commits.

## Discovery and recommendations

Search and `/discover` have separate contracts. Search currently uses PostgreSQL full-text/trigram techniques; recommendations are deterministic application logic with multiple database reads and bounded candidate sets. See [Discovery and Personalization](../domains/discovery-and-personalization.md), the [recommendation scale plan](recommendations.md), and [Field Manual Part VII](../engineering/field-manual/07-discovery-analytics-recommendations.md).

Recommended steps:

1. For search, measure query latency, index use, relevance, and freshness under growing catalog/filter combinations. Tune indexes and queries before operating a separate search service. If a search cluster becomes justified, define reliable indexing, deletion propagation, rebuild/replay, and fallback behavior.
2. For recommendations, record reliable impressions, positions, clicks, add-to-cart, purchases, dismissals, and exposure deduplication. Evaluate the current ranker using offline measures and controlled online experiments before adopting a trained model.
3. Bound candidate queries and result sizes; monitor query count, database reads, cache hit rate, ranking latency, freshness, vendor/category diversity, and cold-start coverage.
4. If evaluation shows value, add candidate generation from co-purchase, content/category similarity, follows, and popular/new inventory; score a bounded candidate set and apply business-rule re-ranking for availability, freshness, and marketplace diversity.
5. Keep the deterministic ranker as a fallback with a strict inference timeout. Add embeddings, a feature store, or model-serving infrastructure only when quality/latency results and ownership justify their cost. Recommendation output must never reserve stock or block checkout.

## Checkout, inventory, promotions, and orders

Checkout is the authoritative price and inventory boundary. It uses transaction-scoped cart/stock locking, stable stock-row ordering, and conditional stock updates; the row-level database decision serializes purchases of a hot item. See [Shopping, Promotions, and Orders](../domains/shopping-promotions-and-orders.md).

Recommended steps:

1. Benchmark concurrent checkouts with shared items and varied cart sizes. Track transaction duration, row-lock wait, deadlocks, stock conflicts, retries, and checkout p95/p99.
2. Keep database transactions short and deterministic. Avoid provider network calls inside stock/order transactions. Preserve idempotency keys and conditional inventory updates; consistent lock ordering reduces but does not eliminate all deadlocks.
3. Enforce coupon usage limits and redemption records atomically under concurrent checkout. Test boundary cases such as the final allowed redemption and simultaneous retries.
4. If specific hot-item lock wait becomes the measured bottleneck, evaluate a bounded reservation/queue design with expiry, idempotent confirmation, abandoned-reservation cleanup, and a clear customer experience. Keep PostgreSQL authoritative; this adds state and recovery work and is not a default requirement.
5. Add cursor pagination to long order/admin lists when offset depth and concurrent inserts measurably affect query cost or page stability.
6. Keep partial refunds, returns, and more complex fulfillment transitions as explicit financial/product decisions because they change stock and ledger invariants.

## Payments and financial ledgers

Payment-provider latency and webhook retries must not create duplicate settlement or inconsistent balances. Current payment/refund transitions and wallet behavior are in [Payments and Financial Ledger](../domains/payments-and-financial-ledger.md).

Recommended steps:

1. Persist provider references and durable state before retryable external calls. Keep webhook verification, idempotency, amount/currency checks, and valid state transitions in the API.
2. Measure provider response time, webhook delay, reconciliation backlog, duplicate events, refund state age, and ledger discrepancies. Design operator recovery for late captures and `needs-attention` refunds before broadening refund types.
3. Reconcile wallet entries against payment/order sources. Enforce uniqueness/idempotency in the ledger and retain an auditable correction path rather than directly editing balances.
4. Keep orders, payments, and wallet ledgers in PostgreSQL as the source of truth. Do not move money decisions to caches, analytics stores, asynchronous model output, or eventually consistent read replicas.
5. Scale background reconciliation with bounded, idempotent batches and leases; alert on oldest pending age and make repeated work safe.

## Referrals and growth

Referral traffic can create registration bursts and duplicate reward attempts. Current behavior is described in [Referrals and Growth](../domains/referrals-and-growth.md).

Recommended steps:

1. Validate referral eligibility on the server at the committing operation; browser validation is only a convenience.
2. Use database uniqueness/idempotency for reward issuance so webhook, order, or registration retries cannot grant the same reward twice.
3. Apply route-specific abuse limits and monitor invalid-code rates, self-referral attempts, repeated accounts, and reward reversals while respecting privacy policy.
4. Add campaign-level controls or asynchronous reward issuance only when measured burst volume requires them; keep eligibility and ledger effects auditable.

## Analytics ingestion and reporting

Product views use Redis and RabbitMQ buffering, while recent-history upserts and several other event families still write to PostgreSQL. Reports query the commerce database; dashboards poll cached results. This creates both synchronous database writes and reporting read pressure. Current behavior and metric definitions are in [Analytics and Measurement](../domains/analytics-and-measurement.md); data-plane alternatives are detailed in [Analytics at Scale](analytics-at-scale.md).

Recommended steps:

1. Establish event-rate and freshness targets. Measure Redis buffer length, RabbitMQ queue age/depth, consumer drain rate, duplicates/loss, PostgreSQL writes, report query rows/latency, cache hit rate, and dashboard freshness.
2. Bound the in-memory/Redis work path and define overload behavior, maximum event age, retry/dedupe rules, and operator recovery. Batch consumer writes rather than inserting one row at a time where safe.
3. Precompute report summaries or daily rollups if repeated raw-table aggregation is the measured cost. Partition event tables when retention and time-filtered scans justify the operational complexity.
4. If analytics workload competes with commerce, move derived events and aggregates to an independently sized analytics database. Use an event stream plus analytical store when replay, multiple consumers, or sustained event volume justifies the extra platform.
5. Keep payment, inventory, order, and wallet truth in PostgreSQL. Analytics may be eventually consistent; publish its freshness target and show stale state when delayed.
6. For fresher dashboards, first serve incremental aggregates. Then compare compact snapshot polling with SSE updates. SSE can signal aggregate versions or small updates; it does not reduce ingest or query load by itself. WebSockets are unnecessary unless the product needs bidirectional interaction.

## Notifications and asynchronous delivery

Selected domain events use a transactional outbox and RabbitMQ; delivery is at least once. Notification consumers deduplicate, while consumer failures route to the shared DLQ without a complete delayed-retry/replay workflow. Current paths are in [Notifications and Asynchronous Delivery](../domains/notifications-and-async-delivery.md).

Recommended steps:

1. Monitor outbox oldest age/attempts, relay claims, RabbitMQ ready/unacked depth, consumer duration, DLQ depth, notification persistence lag, SSE connection count, and email provider outcomes.
2. Preserve idempotent consumers and stable business/event keys. Bound retries and batch sizes; distinguish a publish failure from a post-publish consumer failure.
3. Add a permissioned operator workflow for inspecting and replaying DLQ messages after fixing the cause. Never replay non-idempotent messages blindly.
4. Move email into a durable, idempotent job path with provider delivery state if its delivery guarantee matters. Keep email, push, SSE, and inbox persistence as separate outcomes.
5. Load-test SSE connection counts and proxy timeouts as online users grow. If a shared API process becomes the limit, evaluate a dedicated stream gateway only after defining event fan-out, authentication, reconnect, and backpressure semantics.

## Related plans and evidence

- [Analytics at Scale](analytics-at-scale.md) compares PostgreSQL batching/partitioning, separate analytics databases, event streams, and dashboard delivery options.
- [Recommendations](recommendations.md) details the staged path from deterministic ranking to optional AI/ML.
- [Performance and Capacity](../performance/README.md) owns the benchmark profiles and publishes only reproducible results.
- [Domain guides](../domains/README.md) own current behavior and implementation details.
