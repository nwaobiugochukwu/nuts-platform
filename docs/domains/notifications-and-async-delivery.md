# Notifications and Asynchronous Delivery

> **Scope:** Transactional outbox publication, broker delivery, in-app notifications, SSE, email side effects, and recovery. The [domain index](README.md) maps this guide to its owning API modules; the [backend module map](../reference/backend-module-map.md) provides source and frontend navigation. Current behavior and proposed scale work are labeled separately.

## Domain boundary and outcomes

Transactional outbox publication, broker delivery, in-app notifications, SSE, email side effects, and recovery.

<a id="notifications-and-async-delivery-design"></a>
## Notifications and Asynchronous Delivery: end-to-end design

### Domain model and actors
Maintains real-time browser updates via Server-Sent Events (SSE), routes domain messages through RabbitMQ queues, provides high-concurrency transactional outbox relay, and dispatches transactional emails via Brevo.

### Problems and controls
- **The Dual-Write Problem & Concurrent Multi-Instance Outbox Relay:**
  - *The Failure Mode:* Saving an entity to PostgreSQL and publishing a message to RabbitMQ in separate operations risks message loss upon crashes. In a multi-replica deployment, multiple instances polling the same outbox table concurrently cause duplicate publishing races or message contention.
  - *How NUTS Solved It:* Implemented the **Transactional Outbox Pattern** with PostgreSQL row-level locks using `SELECT ... FOR UPDATE SKIP LOCKED` inside an atomic transaction. Replicas claim distinct batches of up to 50 events and transition them to `PROCESSING`. The relay wakes when notified of a new event and also polls every 10 seconds, recovers claims older than 5 minutes, and returns failed broker publishes to `FAILED` with an incremented attempt count.
- **Outbox Table Bloat & High-Volume Data Retention:**
  - *The Failure Mode:* In high-throughput commerce platforms, historical outbox events swell the `outbox_events` table into millions of rows, degrading query performance and consuming excessive storage.
  - *How NUTS Solved It:* An automated daily retention cron (`prunePublishedEvents` at `0 0 3 * * *`, Africa/Lagos) deletes up to **1,000** `PUBLISHED` events older than **90 days** per run. If more rows qualify, later runs continue cleanup. A composite index on status and processed time supports the retention query.
- **Dropped SSE Connections via Cloud Proxies:**
  - *The Failure Mode:* Intermediaries may close idle HTTP streaming connections, interrupting live notification delivery.
  - *How NUTS Solved It:* Emits an SSE heartbeat every **15 seconds**. The stream authenticates the user at connection setup and supports replay, but the heartbeat does not revalidate the user's session on every pulse.
- **Unified Multi-Role Real-Time Streaming:**
  - *The Failure Mode:* Maintaining separate SSE controller endpoints for Customers, Admins, and Vendors introduces route redundancy, fragmented client stores, and reverse-proxy route maintenance overhead.
  - *How NUTS Solved It:* Consolidated SSE streaming into a single, unified canonical endpoint at `/notifications/sse/stream` supporting all authenticated roles (`user`, `vendor`, `admin`) with zero-trust capability filtering and unified client Zustand lifecycle management.
- **Distributed Cron Mutex Safety & Lua Renewal Heartbeats:**
  - *The Failure Mode:* Distributed cron cleanups (`NotificationRetentionCron`) or asynchronous buffer flushes (`ProductViewsService`) taking longer than a fixed lock TTL risk split-brain duplicate executions when another container claims the expired lock.
  - *How NUTS Solved It:* Built a resilient distributed mutex pattern using Redis:
    - Generates a cryptographically random UUID `lockToken`.
    - Iterative batch sweeps execute atomic Lua scripts to renew the TTL (`renewLock()`) only while verifying ownership of the `lockToken`.
    - Atomically releases the lock using Lua `eval` checking `KEYS[1] == ARGV[1]`.
    - For `ProductViewsService`, implemented 2-phase buffer migration (`viewBufferKey` -> `viewProcessingKey` with automatic recovery of orphaned views on startup) before queue dispatch.
- **Duplicate Notification Replay on Worker Restarts:**
  - *The Failure Mode:* At-least-once outbox delivery can publish an event again if the relay crashes after broker confirmation but before marking its row published. RabbitMQ can also redeliver an unacknowledged message.
  - *How NUTS Solved It:* Notification consumers use stable event/business dedupe keys backed by a database uniqueness constraint, preventing duplicate inbox rows. This protects notification persistence; it does not make every external side effect exactly once.

### Current backend mechanism
- **High-Concurrency Transactional Outbox Pattern:**
  - Business entities and `OutboxEvent` records are inserted in the **same atomic SQL transaction**.
  - Background relay claims batches using `SELECT ... FOR UPDATE SKIP LOCKED` (batch size: **50 events**).
  - Stale in-flight recovery: Automatically reclaims events in `PROCESSING` status older than **5 minutes** (`staleClaimMs = 300,000ms`).
  - Max retry attempts: **5 attempts** before permanent failure flagging.
  - Retention purge: Scheduled daily at `03:00` Africa/Lagos (`0 0 3 * * *`), deleting up to **1,000** `PUBLISHED` events older than **90 days** per run; additional qualifying rows are left for later runs.
- **Publisher Confirms & RabbitMQ Topology:**
  - Dedicated `ConfirmChannel` (`createConfirmChannel()`) with asynchronous broker acknowledgements.
  - Durable work queues include `q.nuts.emails`, `q.nuts.notifications`, `q.nuts.analytics`, `q.nuts.vendor-events`, and `q.nuts.inventory`; rejected consumer messages route through `nuts.dlx` to shared durable queue `q.nuts.dlq`.
- **SSE Connection Keepalive:**
  - Heartbeat ping emitted every **15 seconds**; this does not query PostgreSQL or Redis for every ping.
  - The stream authenticates at connection setup and filters by recipient and role. It supports offline replay using `Last-Event-ID`; the current stream does not revalidate the account on each heartbeat.

### Frontend experience and flow
- **Zustand Notification Store (`useNotificationStore`):** Manages live unread badge count, toast popups, and SSE stream lifecycle.
- **Opening a notification:** a tap marks the item read (optimistic in the store) and opens what it is about. Transactional alerts are *destination-first*: order and payment events open the order for the viewer's role at the section they are about, so two messages for one purchase are never the same view. **Payment received** (and failed/refunded) opens the order at `#payment` (the receipt and payment breakdown; "View receipt", or "Retry payment" for a failure), while **Order confirmed**, shipped and delivered open it at `#tracking` ("Track order"). The order page scrolls to and briefly highlights that section once the order has loaded, and the section is decided on the client, so notifications stored before this change get it too (`orderSectionFor`, `notificationActionLabel`). payouts open the wallet, and a new follower opens the followers section of store analytics (`/vendor/analytic#followers`). Announcements are *content-first*: they open the full message (up to 2,000 characters) with their link offered as a button, because a list preview truncates the text the sender wants read. Routing lives in `src/lib/notification-open.ts` and `src/lib/notification-path.ts`; `/notifications/[id]` is the fallback for items with nothing to open.
- **Going back:** a notification opens its destination in the same tab, and the destination's Back link returns to where the user came from (`BackLink`, backed by an in-memory navigation history in `src/lib/navigation-history.ts`). If the page was opened directly (shared link, reload) it falls back to a sensible parent. The inbox keeps its loaded list, filters and scroll position when the user returns.
- **No duplicate alerts:** while the app is open and focused, the live stream already shows the notification, so the service worker skips the system notification for it (only when an in-app copy exists, so nothing is lost). Every push carries a tag (the notification id, or a fresh one) so a repeat delivery replaces itself silently and different notifications never overwrite each other.
- **Push is on by default:** once the browser permission is granted, a device that is not yet registered is registered quietly after sign-in unless the user switched push off in preferences; while the permission is undecided, the in-app prompt asks first.
- **Push permission and browser support:** the web client asks through an in-app prompt first (snoozed with backoff) and opens the browser dialog only on the user's tap; unsupported browsers get a specific reason and fix (Brave's push setting, iOS Home Screen install, HTTPS) rather than a bare "Unsupported". See `src/lib/push-support.ts` and the [web guide](../../apps/web/README.md).
- **Inbox:** the list is grouped by day (Today, Yesterday, This week, Earlier), filtered by tabs, loads older items as the user scrolls, and offers mark-read and delete per row. On phones the bell opens a compact five-item popup rather than a full-screen panel.
- **Persistent Connection across Navigation:** SSE connection lives in the root provider, surviving Next.js route transitions without reconnecting.
- **Auto-Reconnect with Backoff:** The web client uses a fetch-based SSE reader, exponential backoff with jitter, and sends its latest `Last-Event-ID` on reconnect. Retry delays are capped at 60 seconds; the stream pauses after repeated failures and resumes on browser connectivity events.

### Domain terminology
- **Dual-Write Problem:** A distributed systems challenge where writing to two separate systems (DB + Message Queue) cannot be done atomically without a two-phase commit or an outbox pattern.
- **SSE (Server-Sent Events):** A persistent, unidirectional HTTP connection where the server pushes live updates to the client without the overhead of WebSockets.
- **DLQ (Dead Letter Queue):** A queue for messages rejected by a consumer. In the current RabbitMQ topology, consumer handler failures are routed directly to the shared DLQ; automatic delayed retries are not configured.

### Failure scenarios and edge cases
- Temporary RabbitMQ network partition.
- Browser tab sleeping or entering background mode.
- Rate-limited email provider (Brevo) backed by an internal Circuit Breaker.

### Trade-offs and design considerations
- *Solve the dual-write problem by saving domain events into an outbox table in the same database transaction as the business entity.*
- *Maintain long-lived SSE connections by sending 15-second heartbeat comments to prevent reverse proxies from dropping idle connections.*

---

## Cross-application behavior and integration contracts

### Outbox and asynchronous flow

For selected business events, the API writes an outbox row in the same transaction as the domain change. Payment confirmation, refund completion, order status changes, and vendor follow changes enqueue events this way. A relay wakes on a newly persisted event and also polls every 10 seconds, claiming up to 50 rows with `FOR UPDATE SKIP LOCKED`. It can recover `PROCESSING` claims older than five minutes and allows up to five broker publish attempts. A `PENDING` row with zero attempts was never claimed; broker availability and relay health should be checked before changing data manually. Notification messages carry stable event IDs and business dedupe keys, and the notification table enforces those keys. Delivery is at least once: a crash after broker confirmation and before marking the row published can produce a duplicate. Vendor unfollow events are consumed without sending a vendor notification. Email delivery remains a separate asynchronous side effect and does not share the same transactional guarantee.

RabbitMQ consumer exceptions are rejected to the shared durable `q.nuts.dlq` through `nuts.dlx`; the current topology has no delayed retry queue or automatic DLQ replay. This is a different failure stage from an outbox publish failure: once RabbitMQ confirms publish, the outbox row can be marked `PUBLISHED` even if a later consumer fails. Monitor both outbox age/attempts and broker queue/DLQ depth.

Redis is used for cache, rate/coordination, session, and buffered analytics workloads. It is not the source of truth for orders, payments, wallet balances, or product inventory.

### Operator interpretation of outbox state

An old `PENDING` outbox row with `attempts: 0` has not been claimed by the relay. Check that RabbitMQ is enabled and reachable and that the relay is running; pending rows are retried after recovery. A `FAILED` row with attempts indicates an outbox publish attempt failed; consumer-handler errors happen after publish and go through RabbitMQ's dead-letter route, so they do not explain an outbox `FAILED` status. Do not mark rows published or delete them manually before verifying downstream delivery and idempotency. Route delayed and exhausted-row alerts to operational monitoring.

## Implementation details by capability

The sections below describe each capability’s problem, current API mechanism, failure cases, and trade-offs. The [backend module map](../reference/backend-module-map.md) provides folder and source navigation.

### In-app notifications and delivery

Customers, vendors, and admins need persistent in-app messages plus timely browser updates and delivery preferences.

#### Current backend mechanism

Notification APIs manage inbox and preferences; SSE streams authenticated updates; push uses stored subscriptions. Selected business events use the transactional outbox and RabbitMQ consumers.

#### Failure scenarios and trade-offs

Outbox delivery is at least once, so inbox persistence uses deduplication. Consumer failures go to the shared DLQ without a delayed retry queue. Email confirmation/status delivery is not covered by the same transaction guarantee; durable idempotent email jobs and a controlled retry/replay process are future work.

## Operational notes: programs, tracing and recovery

- **Which program does what.** Queue consumers run only in the `worker` program (or in `all`); the `api` serves requests and the live notification streams; scheduled jobs run only in `jobs`. They share Redis, RabbitMQ and PostgreSQL and never call each other. See [How the system works](../architecture/how-it-works.md).
- **Live notifications across programs.** A notification created by the worker is published through Redis; only the `api` holds the subscriber that feeds open browser streams, so the worker and jobs hold one fewer Redis connection.
- **Tracing.** The request id travels with every outbox event and queue message (`x-request-id` header) and appears in worker logs, so one order can be followed from the request to its email.
- **Recovery.** Failed messages land in the dead-letter queue; `npm run dlq -- list | replay | purge` inspects and replays them (original routing key, acknowledged after broker confirmation, at most three replays unless forced, bodies shown redacted). An alert fires when the queue is not empty, and `GET /api/v1/health/background` plus `scripts/verify-deploy.sh` report a worker that is not running.

## Scaling and traffic direction

The [Scaling Strategy](../scaling/README.md#notifications-and-asynchronous-delivery) contains the staged concurrency, traffic, and growth recommendations for this domain. Scale notification delivery, outbox relays, consumers, email, and SSE independently using queue age, deduplication, backpressure, and replay controls.
