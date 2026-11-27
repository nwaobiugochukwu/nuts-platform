# Platform Reliability Plan: Process Isolation, PM2, Audit Pipeline and Temporal Workflows

- **Status:** Proposed. Decisions are in [ADR 0003](adr/0003-process-model-audit-pipeline-and-durable-workflows.md).
- **Date:** 2026-11-25
- **Relationship to the delivery plan:** this is a separate track. Its phases are named **P1-P7** so they are not confused with Phases 0-4 of the [hub fulfillment plan](hub-fulfillment-and-delivery-plan.md). The recommended order is in [section 9](#9-phases).

## Implementation status (2026-11-25)

Built and verified locally: **P1** transaction runner (cart converted; the other files are on a shrink-only list), **P2** `api` / `worker` / `jobs` programs under PM2, **P3** Prometheus metrics, alert rules (checked with `promtool`) and a Grafana dashboard, **P4** the audit pipeline, **P5** the Temporal foundation, request ids end to end, the dead-letter tool, heartbeats and the deploy check.

Release 1 (on the `feat/release1-hardening` branch, not yet merged) adds: `PM2_APP` defaulting to `all` (the earlier safety net did not work under PM2), per-program ports and documented env files, the Redis connection budget, the Render guide and template, a local Prometheus and Grafana stack, PM2 for development with an `npm run dev` that shows every service independently, and audit declared with `@Audit` on 60 endpoints instead of written inline in services.

Not started: **P6** (W1-W8 workflows), **P7** (fulfillment on Temporal), moving the remaining raw `$transaction` sites and the critical audit events to the runner, and the delivery plan's Phases 1-4. Not verified here: anything needing Docker (the Docker development profile, the full `npm run dev` start, live-service checks), because Docker was unavailable in the environment used for the last part of this work.

## 1. Goals

1. A failure in one concern (a batch job, a message consumer, an audit write, one slow endpoint) must not stop checkout or the storefront.
2. Every long-running business process has one place that shows where it is, retries itself, and can be tested.
3. Audit logging never slows or fails a request, and critical audit records are never lost.
4. We can see what the system is doing (logs, metrics, queues, workflows) and are told when it is unhealthy.

## 2. What the scan found

| Area | Today |
|---|---|
| Process | One NestJS process: HTTP, server-sent events, 14 cron jobs, 5 RabbitMQ consumers, outbox relay, announcement and refund reconcilers. |
| Scheduling | `@nestjs/schedule` crons. Some take a Redis lock (`cron:lock:...`), some do not; announcements use a database "lease"; the refund and announcement reconcilers poll every 5 minutes and every minute. Scaling `api` to more than one instance would run every job on every instance. |
| Messaging | One topic exchange, queues `emails`, `notifications`, `analytics`, `vendor-events`, `inventory`, one dead-letter queue. Outbox table plus a relay polling every 10 s. |
| Notifications to the browser | SSE with a Redis pub/sub broadcast channel, so it already works across processes. |
| Audit | `AuditLogService.log()` awaited inside services (64 call sites). Two near-identical services exist: `common/audit-log` and `modules/security/audit`. Failures are logged and swallowed. |
| Shutdown | `enableShutdownHooks()` is on, but consumers and jobs are not drained deliberately. |
| Monitoring | Sentry (errors, 10% traces in production) and pino JSON logs. No metrics endpoint, no queue or outbox alerts, health endpoints are per process, no worker heartbeat. |
| Deploy | Docker Compose behind nginx; `api-prod` limited to 768 MB and 1 CPU; migrations run in a separate one-shot `api-migrate` service. |

## 3. Target process topology

| Role | Runs | Instances | Mode | Notes |
|---|---|---|---|---|
| `api` | HTTP, SSE, auth, all request/response modules | 1 now, 2+ later | PM2 cluster | No crons, no consumers. Stateless, so it can scale. |
| `worker` | RabbitMQ consumers (emails, notifications, analytics, vendor-events, inventory), outbox relay | 1 (more for throughput) | PM2 fork | Competing consumers make extra instances safe. Outbox relay uses `FOR UPDATE SKIP LOCKED` claiming (already claim-based) so duplicates are safe. |
| `jobs` | Remaining scheduled jobs | exactly 1 | PM2 fork | Singleton by design. Each job keeps its Redis lock as a second guard. Shrinks as jobs move to Temporal. |
| `temporal-worker` | Temporal workflows and activities | 1+ | PM2 fork | Added in P5. Scales horizontally. |
| `web` | Next.js standalone | 1+ containers | PM2 fork (one process) | Scale by adding containers, not PM2 cluster; same supervision as the other roles. |

Isolation is two-layered: separate compose services (a container crash or OOM kill only restarts that role) and PM2 inside each (a crash restarts the process with backoff before the container is even considered unhealthy).

### 3.1 PM2 settings (one `ecosystem.config.cjs`)

- Started with `pm2-runtime` (foreground, forwards signals, streams logs to stdout) in the container `CMD`, selecting a role with `--only`.
- Per app: `exec_mode` (cluster for `api` only when the host has spare CPUs; fork for every other role including `web`), `instances`, `max_memory_restart` below the container limit (so PM2 restarts gracefully before the kernel kills it), `exp_backoff_restart_delay`, `max_restarts` with `min_uptime` (a crash loop stops instead of spinning), `kill_timeout` long enough to drain, `wait_ready` plus `listen_timeout` so a role is "up" only after Nest signals ready, and `shutdown_with_message` off in favour of SIGTERM handled by Nest.
- Cluster mode only for `api`, and only when the host has more than one CPU; on the current 1 CPU limit run one instance and keep the benefit of supervision and graceful reload.
- Logs: pino JSON on stdout only. No PM2 file logs inside containers (they would grow unbounded); the Docker log driver ships them. If PM2 ever runs on a VM without Docker, add `pm2-logrotate`.
- PM2 Plus is a hosted third-party service that receives process data; it is not part of this plan. Metrics come from Prometheus instead (section 5).

### 3.2 Splitting the code

- Add `src/worker.ts`, `src/jobs.ts` and later `src/temporal-worker.ts` entry points built with `NestFactory.createApplicationContext` (no HTTP listener), and keep `main.ts` for `api`.
- Compose modules by role: a `CoreModule` (config, Prisma, Redis, logging, outbox publisher) plus role modules. `AppModule` is split into `ApiModule`, `WorkerModule`, `JobsModule`. The architecture check gains a rule that `api` must not import consumer or cron providers.
- Move every `@Cron` provider and consumer out of modules that `api` imports into role modules (feature modules keep their services; only the entry points move).
- The notification consumer in `worker` publishes through the existing Redis broadcast, so SSE keeps working without the API process hosting the consumer.
- Graceful shutdown per role: stop accepting new work, finish in-flight messages (`prefetch` bounded), close channels, flush audit buffer and Sentry, then exit. `api` also drains HTTP connections and SSE streams.
- Health: `api` exposes liveness and readiness (database, Redis, broker); `worker` and `jobs` expose a tiny internal HTTP health port reporting last-heartbeat age, broker connection and queue consumer status. Compose healthchecks use them.

## 4. Logging and monitoring

**Logs**
- One JSON line per event with `role`, `service version`, `requestId`, `traceId`, `userId` (hashed or id only), `orderId` where relevant. Redact secrets, tokens, cookies, card and bank fields centrally in the pino config.
- Correlation: the request id is placed in RabbitMQ message headers and in Temporal headers/memo, and restored by consumers and activities so one order can be followed across processes.
- Ship to a log store (Grafana Loki, Better Stack or similar) with a retention policy (for example 14 days hot, 90 days cold). Never log full payloads of payment webhooks; keep references.

**Metrics (Prometheus format, one endpoint per role on an internal port)**
- Runtime: event-loop lag, heap, RSS, GC, active handles; per-process restarts from PM2.
- API: request rate, errors and latency by route group (RED), SSE connections, auth failures.
- Dependencies: Prisma query latency and pool usage, Redis latency, circuit-breaker state (the repo already has one), outbound calls to Paystack and email.
- RabbitMQ: queue depth, unacked messages, consumer count and oldest-message age per queue (from the broker's Prometheus plugin), **dead-letter queue size**, consumer error and retry counts.
- Outbox: pending count and age of the oldest pending event (the single best "pipeline is stuck" signal).
- Temporal: the SDK's Prometheus metrics (workflow task and activity failures, schedule-to-start latency, task-queue backlog).
- Business: orders created and paid per minute, payment success rate, webhook-to-confirmation latency, refund time-to-complete, notification delivery rate.

**Alerts (examples; route to email or chat)**
- Any message in the dead-letter queue; queue oldest-message age over 5 minutes; outbox oldest pending over 60 seconds.
- A role missing its heartbeat for 2 minutes; restart count above 3 in 10 minutes; memory over 85% of the limit.
- 5xx rate or p95 latency above threshold; payment webhook failures; reconcile jobs not running.
- Temporal task-queue backlog growing or workflows failing a retry policy.

**Dashboards:** one overview (health of every role and queue), one money dashboard (orders, payments, refunds, settlements), one workflow dashboard (running, failed, stuck by type). Sentry stays for exceptions and traces.

## 4a. Transaction runner

**Today:** 33 call sites use `prisma.$transaction(...)` directly and 25 signatures take a `Prisma.TransactionClient`, so passing the transaction down is already the house style. Gaps found in the scan: the two Serializable transactions (cart checkout and referral rewards) never retry on a serialization conflict; timeouts are set by hand in a few places and default elsewhere; and `OutboxService.appendEvent` wakes the relay from inside the open transaction, before it has committed (the 10-second poll hides this).

**Design:** one injectable `TransactionRunner` that you call and pass where needed.

```ts
await this.tx.run(async (ctx) => {
  await this.wallet.settleVendorEarning(vendorId, amount, orderId, ctx.tx);
  await ctx.emit('order', orderId, 'order.settled', { orderId });     // outbox, same transaction
  await ctx.audit({ action: 'VENDOR_SETTLED', entity: 'Order', entityId: orderId }); // critical audit, same transaction
  ctx.afterCommit(() => this.cache.invalidateVendor(vendorId));        // runs only after COMMIT
}, { name: 'order.settle', preset: 'critical' });
```

- **Explicit, not ambient.** The callback receives `ctx` and you pass `ctx.tx` (a normal Prisma transaction client) into any service that must take part. This matches the existing services, keeps data flow visible, and avoids the hidden-state problems of an ambient (AsyncLocalStorage) transaction. An ambient lookup can be added later behind the same API if it proves useful.
- **Joining a parent.** Services that may or may not run inside a transaction take `tx?: Prisma.TransactionClient`; `this.tx.run(fn, { parent: tx })` reuses it instead of nesting, and `db(tx)` returns `tx ?? prisma`.
- **Presets:** `default` (timeout 15 s, wait 5 s), `short` (5 s), `critical` (Serializable, up to 3 retries with jittered backoff on write conflict, deadlock and serialization failure: Prisma `P2034`, SQLSTATE `40001`, `40P01`). Anything can be overridden. Retries re-run the whole callback, so callbacks must not do external I/O.
- **After-commit and after-rollback hooks** run once, in order, only after the outcome is known. A failing hook is logged and never turns a committed transaction into an error. This is where cache invalidation, notifications and relay wake-ups belong.
- **Outbox and audit built in:** `ctx.emit` appends the outbox event inside the transaction and wakes the relay after commit; `ctx.audit` writes the critical-tier audit event inside the transaction (see the audit pipeline).
- **Guard rails:** every run carries a `name`; the runner records duration, retries, rollbacks and slow transactions (over a threshold, for example 2 s) as metrics and Sentry breadcrumbs. A lint rule (added to the architecture check) forbids raw `$transaction` outside the runner and forbids awaiting HTTP, email or broker calls inside a transaction callback.
- **Testing:** a `FakeTransactionRunner` runs the callback against the mocked Prisma client and executes hooks on success, so existing service specs barely change. Integration tests cover retry on a forced conflict and hook ordering.
- **With Temporal:** each activity uses the runner for its own atomic database step; a transaction never spans two activities.
- **Migration:** convert money paths first (payments, wallets, orders, refunds), then auth and sessions, then the rest; the old calls keep working until each file is converted.

## 5. Audit pipeline

### 5.1 The decorator

```ts
@Audit({
  action: 'PRODUCT_UPDATED',
  entity: 'Product',
  entityId: (ctx) => ctx.params.id,
  critical: false,                // true: written to the outbox in the same transaction
  capture: { before: (ctx) => this.products.snapshot(ctx.params.id) }, // optional
  redact: ['password', 'token'],  // merged with the global redact list
  onFailure: false,               // true for security events (login failure, 403)
})
@Patch(':id')
update(...) { ... }
```

An interceptor runs after the handler returns (a `tap` on the response stream), builds the event from the request (actor, role, IP, user agent, request id, route, outcome status, selected response fields) and hands it off without awaiting. By default it records only 2xx outcomes; `onFailure` also records selected 4xx security outcomes. Non-HTTP callers (jobs, consumers, workflows) use `AuditService.record(...)` which follows the same pipeline.

### 5.2 Delivery tiers

| Tier | Used for | How it is written | Guarantee |
|---|---|---|---|
| **Critical** | money movement, refunds, payouts, login and session events, role or permission changes, vendor approval and suspension, admin deletions | The service method appends the audit event to the outbox **inside the same database transaction** as the change; the relay publishes it | Exactly as durable as the change itself, at-least-once delivery, de-duplicated by event id |
| **Standard** | everything else (catalog edits, settings, views of sensitive data) | Decorator publishes to RabbitMQ after the response with publisher confirms | At-least-once while the broker is up; if the publish fails the event goes to a small bounded local buffer that retries and, past a limit, is logged to Sentry so loss is visible |

A single `audit` consumer in `worker` batches inserts (for example every second or 200 events), idempotent on `eventId` (unique index), so redelivery never duplicates.

### 5.3 Data and safety

- One append-only `audit_events` table: event id, occurred-at, actor type and id, action, entity and id, outcome, request id, trace id, IP, user agent, redacted `before`/`after` diff, source role. The application database user is granted INSERT and SELECT only; retention is handled by a separate maintenance role.
- Central redaction (passwords, tokens, card numbers, bank details, full addresses where not needed) before anything leaves the request.
- Merge the two existing audit services into one (done: they were identical, and the unused copy under `modules/security/audit` is removed); keep the old `log()` as a thin shim during migration so the 64 call sites move gradually, critical ones first.
- Admin audit viewer keeps working: reads the same table (the current table is the starting point, so no history is lost; the new columns are additive).
- Later option: a hash chain over events for tamper evidence.

## 6. Temporal

### 6.1 What it is used for, and what stays on RabbitMQ

| Use Temporal when... | Keep RabbitMQ when... |
|---|---|
| The process has waits (minutes to days), timers, or waits for a person or webhook | The work is one step and fire-and-forget |
| Several steps must complete or be compensated together | A failed message can simply be retried or dead-lettered |
| You need to ask "where is order X's process right now?" | You need fan-out to many independent consumers |
| It must survive deploys and crashes mid-way | Throughput matters more than per-item visibility (analytics, cache) |

The **outbox** stays as the reliable bridge: a relay consumer starts workflows from outbox events using the business key as the workflow id (`order-payment:<orderId>`), so a duplicate start is a no-op.

### 6.2 Integration approach

- TypeScript SDK (`@temporalio/client`, `worker`, `workflow`, `activity`, `testing`). A thin in-repo `TemporalModule` (client provider, worker bootstrap, interceptors for correlation id and logging) rather than a third-party Nest wrapper, so we control versioning and testing.
- Layout: `apps/api/src/modules/<feature>/workflows/*.workflow.ts` (deterministic code, no I/O), `*.activities.ts` (all I/O, calls existing services, idempotent), registered in `temporal-worker`. Workflow code may only import pure helpers and activity types; the architecture check enforces it.
- Conventions: activities have explicit timeouts and retry policies and are idempotent (keys on business ids); money activities check current state before acting; workflows use signals for external events (payment webhook, admin decision, customer choice), queries for status, timers for deadlines, child workflows for fan-out, and `patched()` for any change to a running workflow.
- Namespaces `nuts-dev`, `nuts-staging`, `nuts-prod`; task queues per concern (`payments`, `fulfillment`, `comms`, `lifecycle`) so a noisy queue cannot starve payments. Search attributes: `orderId`, `vendorId`, `userId`, `workflowKind`.
- Hosting: dev and staging self-hosted in Docker (Temporal server, its PostgreSQL, Web UI). Production decision (open item): Temporal Cloud versus self-hosted on a dedicated VM; do not run the server inside the same memory-limited host as the API.
- Testing: `@temporalio/testing` time-skipping environment for unit-level workflow tests (a 72-hour deadline runs in milliseconds), replay tests against recorded histories before deploying workflow changes, activity tests against the existing service mocks.

### 6.3 Workflow catalogue (from the scan)

| # | Workflow | Replaces / adds | Steps, signals and timers | Compensation |
|---|---|---|---|---|
| W1 | **OrderPayment** (per order) | `UnpaidOrdersCron` plus the payment-expiry path | Order created, then wait for the `paymentConfirmed` signal (from the webhook) with the checkout TTL timer. On timeout: ask Paystack for the real status first (covers a lost webhook), then confirm or cancel | Cancel order, restore stock, release voucher claim and referral hold |
| W2 | **Refund** (per refund) | `reconcilePendingRefunds` (5-minute poll) and the refund pipeline | Request refund from Paystack, wait for webhook signal or poll with backoff, record, debit vendor pending, credit wallet if applicable, notify | Mark failed and alert for manual action; never double-refund (idempotency key) |
| W3 | **ParcelFulfillment** and child **VendorHandover** (Delivery Phase 1) | New (replaces the vendor-sets-status flow) | Per-vendor SLA timers: reminders at 50% and 90%, mark late, open customer choice (signal), hard deadline at 72 h; hub check-in and pack signals; derive order status | Auto-cancel late item with partial refund (starts W2), restore stock |
| W4 | **VendorSettlement** (per vendor per order) | Current "settle everyone on DELIVERED" | Wait for delivery signal, then the 48 h dispute timer (a dispute signal cancels it), then settle that vendor only | Reverse on a late refund; hold on open dispute |
| W5 | **Delivery** (Delivery Phase 3) | New | Request rider, assignment timeout and reassignment, out-for-delivery, code verification signal, failed-delivery retry or return to hub | Return to hub, refund rules for re-delivery |
| W6 | **AnnouncementPublish** | `processScheduledAnnouncements` (every minute) and the PUBLISHING lease | Sleep until the scheduled time, then fan out recipients in chunks (child workflows), resumable and visible progress, cancel on archive | Stop remaining chunks; already-sent stay sent |
| W7 | **AbandonedCartRecovery** (per cart) | `abandoned-cart.cron` and `abandoned-cart-purge.cron` | Start on cart inactivity; reminder timers (for example 1 h, 24 h); cancel on checkout or return signal; purge after the retention period | None |
| W8 | **AccountDeletion** (per user) | `user-account-cleanup.cron` | Request, then grace period timer, cancel on sign-in signal, then anonymise across tables as steps | Each step idempotent and resumable; failures alert |
| W9 | **VendorOnboarding** and **VendorSuspension** | Status transitions in `admin-vendors.service` | Submit, wait for admin decision signal with an SLA reminder timer, notify; suspension cascades: hide products, pause payouts, handle open orders | Reinstatement reverses the cascade |
| W10 | **ReferralReward** | Fire-and-forget after DELIVERED | After the dispute window, grant the reward once | Revoke on refund |
| W11 | **PeriodicDigests** as Temporal Schedules: wishlist alerts (15 min), low-stock alerts, vendor summaries | Crons with Redis locks | Schedule with overlap policy "skip"; each run is a workflow of batch activities | None |

**Deliberately not workflows:** the retention purges (analytics, recommendation events, recent views, notification retention, voucher-claim cleanup) are idempotent batch deletes. They move to the `jobs` role and stay cron-based; migrating them adds cost without benefit. Notifications, emails, analytics ingestion and cache invalidation stay on RabbitMQ. Login, token refresh and single-request operations stay synchronous.

### 6.4 RabbitMQ improvements that go with it

- Add a dead-letter inspection and replay tool (admin screen or script) with per-message reason, so the DLQ is operable instead of a graveyard.
- Add the `audit` queue and a `workflow-start` consumer for outbox events.
- Set bounded `prefetch` per consumer, consumer-level retry with delay exchanges before dead-lettering, and publisher confirms on critical publishes.
- Publish the topology (exchanges, queues, bindings, ownership) in the docs and assert it at startup.

## 7. Security and data

- Audit and workflow payloads carry ids, not personal data; large or sensitive content is referenced, not embedded.
- Temporal and the metrics ports are internal-network only; the Web UI sits behind authentication (SSO or VPN), never public.
- Workflow histories are retained for a bounded period (for example 30 days after completion) so personal data does not accumulate.
- The audit table is append-only for the application user; the audit viewer is restricted to admin roles and its reads are themselves audited.

## 8. Trade-offs and edge cases

- **PM2 and containers overlap.** With one container per role, Docker already restarts a crashed role; PM2 mostly adds backoff, crash-loop protection, cluster mode and one declarative description. We accept the small redundancy for consistency.
- **Cluster mode and memory.** Each cluster worker holds its own copy of the app; with 768 MB and 1 CPU one instance is correct. Raise limits before raising instances.
- **Cron on `api` replicas.** Until the move to `jobs` is complete, `api` must run as a single instance. This is why P2 comes early.
- **Audit loss window.** Standard-tier events can be lost if the process dies between the response and the broker confirm. This is accepted and made visible; critical events have no such window.
- **Audit volume.** Success-only logging keeps volume manageable; read-audits are limited to sensitive screens; batching and partitioning by month keep inserts cheap.
- **Temporal operations.** It adds a stateful service to run, back up, upgrade and monitor, plus determinism rules and workflow versioning discipline. For a practice project start with dev and staging only; decide production hosting before the first money workflow ships there.
- **Dual running during migration.** For each crons-to-workflow move, run both behind a flag and compare for a week before removing the cron; every activity is idempotent so overlap is safe.
- **Webhook ordering.** The payment webhook can arrive before the workflow exists (fast payment) or after it timed out. W1 starts at order creation and the webhook handler uses "signal-with-start" so both orders work.
- **Clock and timezone.** Business deadlines use workflow timers (durations) rather than wall-clock cron strings; user-facing times keep the Africa/Lagos zone.
- **Workflow code changes.** Any change to a running workflow uses versioning; replay tests run in CI against saved histories.
- **Cost.** Temporal Cloud bills per action; self-hosted costs memory and upkeep. Both are small at this scale.

## 9. Phases

| Phase | Scope | Size | Exit criteria |
|---|---|---|---|
| **P1. Transaction runner** | `TransactionRunner` in `infrastructure/database`, retry and timeout presets, after-commit hooks, outbox and critical-audit helpers, test fake, lint rule, migration of the 33 existing `$transaction` sites (money paths first) | S-M | No raw `$transaction` outside the runner; Serializable paths retry on conflict; events are announced only after commit |
| **P2. Process isolation and PM2** | `PROCESS_ROLE` entry points (`api`, `worker`, `jobs`), module split, `ecosystem.config.cjs`, compose services per role, graceful shutdown, per-role health, architecture-check rules | M | Killing `worker` or `jobs` does not interrupt checkout; `api` can run two instances without duplicate jobs; every role restarts with backoff and drains cleanly |
| **P3. Observability** | Prometheus metrics on every role, RabbitMQ and outbox metrics, correlation ids through HTTP/AMQP, log shipping, alerts, three dashboards | M | A stuck outbox, dead-lettered message or silent worker raises an alert within minutes |
| **P4. Audit pipeline** | `@Audit` decorator and interceptor, merged `AuditService`, `audit_events` table (additive migration), outbox path for critical events, `audit` consumer with batching and idempotency, shim for old call sites, migration of critical call sites | M | No request waits on an audit write; killing the broker mid-request loses no critical audit event; viewer shows old and new events |
| **P5. Temporal foundation** | Temporal in compose (dev, staging), `TemporalModule`, `temporal-worker` role, correlation interceptors, time-skipping test setup, outbox `workflow-start` consumer, RabbitMQ DLQ tooling | M | A sample workflow starts from an outbox event, survives a worker restart and is visible in the UI and metrics |
| **P6. First workflows** | W1 OrderPayment, W2 Refund, W6 AnnouncementPublish, W7 AbandonedCartRecovery, W8 AccountDeletion (each behind a flag, run alongside the cron for a week, then the cron is removed) | L | Matching outcomes versus the crons; the unpaid-order, refund and announcement crons are gone; per-order process state is queryable |
| **P7. Fulfillment on Temporal** | W3 ParcelFulfillment and VendorHandover, W4 VendorSettlement, W5 Delivery, W9, W10, W11 as the delivery plan's Phases 1-3 reach them | XL | Delivery Phase 1 exit criteria met with timers, reminders, auto-cancel and settlement driven by workflows |

### Recommended order with the other work

1. Finish and merge the open Phase 0 PR (payout guard, scroll, personalisation).
2. **P1** (transaction runner, small and used by everything after it), then **P2, P3, P4** (process isolation, observability, audit). They are independent of Temporal and make everything after them safer.
3. **P5, P6** (Temporal foundation and first workflows).
4. Delivery Phase 1 built directly on Temporal (**P7**), because parcel deadlines, reminders, auto-cancel and the dispute-window settlement are exactly what workflows are for. Doing Phase 1 first and migrating later would mean writing the SLA jobs twice.
5. Delivery Phases 2-4 continue as planned.

## 10. How we build and verify it

- Every phase ships behind a flag, in additive steps, with its own branch and PR (into `development`, then `staging`).
- **Tests:** unit tests for the decorator, interceptor, redaction and batching; integration tests for the outbox-to-audit path and the broker-down fallback; workflow tests with time skipping and replay; a chaos check per phase (kill a role, restart the broker, restart the Temporal worker mid-workflow) recorded in the runbook.
- **Runbooks:** start, stop and restart each role; replay the dead-letter queue; terminate or reset a workflow; roll back a workflow version; restore audit from backup.
- **Docs:** update the architecture guide and the deployment docs with the role diagram, the topology table and the workflow catalogue as each phase lands.

## 11. Decisions (recommended, awaiting confirmation)

| Question | Recommendation | Why |
|---|---|---|
| Production host | **Stay on Docker Compose on one VM**, one compose service per role. Revisit an orchestrator only when you need several hosts or autoscaling. | It fits the current deploy flow (images built per environment, nginx in front), keeps operations small, and the role split already gives crash isolation. Size the VM for the API, worker, jobs, web, broker and cache with headroom; keep the database and, in production, Temporal off this host. |
| Temporal in production | **Self-host for dev and staging; use Temporal Cloud for production** when the first money workflow goes live. If budget rules Cloud out, self-host on a separate small VM with a managed PostgreSQL and tested backups. | The server's database, upgrades and backups are the real burden, and payments and refunds should not depend on a single self-managed box. Pricing is usage-based and changes, so check current terms before committing. |
| Logs and metrics | **Hosted free tier first** (for example Grafana Cloud: logs, Prometheus metrics, dashboards and alerts), agent shipping from the VM. | No servers to run or patch, and it covers the planned dashboards and alerts. Free tiers have volume and retention caps, so keep log volume sane (redaction, no payload dumps) and move to self-hosted only if the caps bite. |
| Audit retention and access | **Keep 1 year in PostgreSQL** (monthly partitions), then archive compressed to object storage; keep **financial and permission events for 6 years** (confirm the exact requirement with an accountant or lawyer). **Read access:** super-admin and compliance roles see everything; support staff see an entity's timeline only; vendors see their own store's events only; every read is itself audited; nobody can edit or delete. | A year is enough for investigations and disputes; longer retention costs little in cold storage and matches typical financial record-keeping. Narrow read access limits exposure of personal data. |
| `web` process | **A single Next.js process per container under PM2 fork mode; scale by adding containers.** No PM2 cluster. | Next.js already runs as one Node process. On a 1-CPU limit clustering adds memory and no speed, and in-process caches would diverge between workers. Containers scale more predictably. |
