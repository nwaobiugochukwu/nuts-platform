# Isolation and scale audit (phase 3A)

Date: 2026-11-27. Read-only audit of the code and compose files on `development`. Nothing was changed to produce it, and nothing here was load-tested. Where a statement needs a running system to confirm, it says **to verify** and names the phase that verifies it.

The architecture stays a modular monolith. One image runs as separate roles, and each role can be given more or fewer containers.

## 1. Architecture map (what exists)

| Role | Entry point | Starts | Health | Metrics | May have replicas? |
|---|---|---|---|---|---|
| api | `main.ts` | HTTP, SSE | `:3001/api/v1/health` (liveness), `/health/ready` (database and Redis) | 9464 | Yes |
| worker | `bootstrap/worker.ts` | RabbitMQ consumers, outbox relay | `:3002/health` (heartbeat plus broker state) | 9465 | Yes, with the caveats in section 3 |
| jobs | `bootstrap/worker.ts` | every scheduled job | `:3003/health` | 9466 | **No**, exactly one |
| temporal-worker | `bootstrap/temporal-worker.ts` | Temporal workflows and activities | `:3004/health` | 9467 | Yes (Temporal supports it), dev only today |
| all | `main.ts` | everything in one process | api health | 9464 | No (it includes crons) |

- Supervision: PM2 inside each container (`ecosystem.config.cjs`) with crash-loop protection (`min_uptime 20s`, `max_restarts 10`, exponential backoff), a graceful memory restart (`PM2_MAX_MEMORY` 600M) and `wait_ready`. Docker then restarts the container if PM2 gives up.
- Data stores: Postgres (Prisma with the pg driver adapter, pool per process), Redis (cache, throttler, cron locks, live-notification pub/sub), RabbitMQ (one connection and one confirm channel per process), Cloudinary (images), Temporal (dev).
- Staging today: Render runs one process (`PM2_APP=all`), so there the roles fail together. This is on the paused staging track (S1, S7).

## 2. Already correct (keep)

- Roles are separate processes from one image, started by `PROCESS_ROLE`; non-jobs roles stop their crons (`stopCronsUnlessJobsRole`).
- Statelessness: no in-memory session or shared state was found. The `Map`s in services are local to one request. Authentication is a token plus a database refresh session. Rate limiting is in Redis (`RedisThrottlerStorage`, with a bounded in-memory fallback). Live notifications fan out through a Redis subscriber. Images go to Cloudinary, not local disk.
- Outbox: rows are claimed with `FOR UPDATE SKIP LOCKED`, so two relays cannot take the same row; stale claims are reclaimed after 5 minutes.
- RabbitMQ: durable queues, persistent messages, a confirm channel with a publisher buffer, manual acknowledgements, a dead-letter queue, reconnect with backoff, and re-binding of consumers after reconnect.
- Cron locks: four jobs use `runWithCronLock` (Redis `SET NX PX` with compare-and-delete release; skips the run if Redis is down, which is the safe direction).
- Outbound calls: Paystack, email and Cloudinary go through timeouts and circuit breakers (cockatiel); Paystack `fetch` also has `AbortSignal.timeout`.
- Resources: per-service memory and CPU limits in the production profile; `--max-old-space-size=350` against the 600M restart threshold and the 768M and 512M container limits.
- Transactions: the transaction runner has presets, timeouts, isolation levels and retries, and exports timing and retry metrics.
- Readiness: the api has a real readiness endpoint (database and Redis) separate from liveness.

## 3. Findings

Severity is judged against what happens when you scale a role or when a dependency fails. Nothing is Critical today because today there is one of each role; items marked **on scale** become real the moment a second replica starts.

### High

| ID | Finding | Evidence | Why it matters | Fix lands in |
|---|---|---|---|---|
| I1 | Production compose services cannot be scaled: `api-prod`, `worker-prod` and `jobs-prod` set `container_name`, which makes `docker compose up --scale` fail. nginx names a single upstream (`server api-prod:3001`) and resolves it once at start, so new api replicas would not receive traffic until nginx reloads. | `docker-compose.yml` lines 174, 221, 260; `nginx/nginx.conf` 40–43 | You cannot scale the api or worker independently without editing files. | Phase 7 (scaling recipe), small |
| I2 | Four scheduled jobs had no lock at all: low-stock, abandoned-cart reminders, vendor weekly summary (each checks an "already sent" key, then sends: read-then-write, so two instances both send) and the refund reconciler (its per-refund claim is not exclusive, so two instances both ask Paystack). **Correction to the first version of this audit:** five other jobs have their own hand-written Redis locks and the announcements publisher uses a database lease, so they were already protected, only inconsistently (audit H15). | Unlocked jobs listed above; hand-written locks in `notification-retention`, `wishlist-alerts`, `unpaid-orders`, `recommendation-events-retention`, `analytics-event-retention` | A second jobs container, or `all` running next to `jobs`, would send duplicate customer emails and duplicate Paystack calls. | Phase 4 (4.3), **done**: the four jobs use `runWithCronLock`; the hand-written locks stay as they are, and new jobs use the shared helper |
| I3 | Worker shutdown does not drain. On SIGTERM the worker closes the health and metrics servers, and the RabbitMQ service then closes the channel straight away: consumers are not cancelled first and in-flight handlers are not awaited, so their acknowledgements fail and the broker redelivers. | `worker.ts` 66–72, `rabbitmq.service.ts` 59–66 and 298 | Every deploy or scale-down redelivers up to 10 messages per replica. Without idempotent consumers (R8, still open) that means duplicate emails and double side effects. | Phase 4 (4.6, 4.9) |
| I4 | Docker's stop timeout does not match PM2's. PM2 allows 30 s to drain (`PM2_KILL_TIMEOUT_MS`), but no `stop_grace_period` is set in compose, so Docker's 10 s default kills the container first. | `ecosystem.config.cjs` line 32; no `stop_grace_period` in `docker-compose.yml` | Graceful shutdown is cut short on every compose deploy. | Phase 7 (one line per service), verify in 7.4 |
| I5 | The inventory consumer reads stock, computes the new value and writes it (read, modify, write) instead of an atomic increment. With more than one worker replica, or prefetch 10 on one, two adjustments to one product can overwrite each other. | `inventory.consumer.ts` 43–57 (audit R21) | Lost stock updates under concurrency. | Phase 4 (4.10) |
| I6 | Database connection budget is not enforced per role. One `env_file` and one default pool (15) apply to every service, so api, worker and jobs each may open up to 15 connections, 45 for one set, multiplied by every replica. The advice for api 10, worker 5, jobs 3 exists only as a comment. | `prisma.service.ts` 101; `.env.example` 150–158; no `DB_CONNECTION_LIMIT` in the production services | Scaling replicas can exhaust the database (or the Supabase pooler) before it exhausts CPU. | Phase 7 (set per service, add the formula and a startup warning) |

### Medium

| ID | Finding | Evidence | Fix lands in |
|---|---|---|---|
| I7 | One RabbitMQ channel is used for publishing and consuming, with one global `prefetch(10)` and no per-queue prefetch or handler timeout. A slow handler on one queue can hold the whole channel's window. | `rabbitmq.service.ts` 110 and 245 (audit R15) | Phase 4 (4.9) |
| I8 | Docker's health check for the api calls liveness (`/health`), which does not check the database or Redis. A container with a dead database connection still reports healthy. `/health/ready` exists but is not used by compose or by any probe. | `docker-compose.yml` healthchecks; `health.controller.ts` | Phase 7 (use readiness for traffic, keep liveness for restarts) |
| I9 | Circuit breakers cover Paystack, email and Cloudinary only, expose no metric, and an open circuit currently dead-letters work instead of delaying it (audit R9 to R13). | `circuit-breaker.service.ts`; `payments.service.ts`; `email.service.ts` | Phase 4 (4.7, 4.8) |
| I10 | The outbox relay has no backoff and no terminal state: a row that fails five times is skipped silently forever (`attempts < 5`) with no alert (audit R3). | `outbox.relay.ts` claim query | Phase 4 (4.1) |
| I11 | Metrics gaps (section 5). | `metrics.service.ts`, `ops/prometheus/alerts.yml` | Phases 4, 7 |
| I12 | PM2 cluster mode for the api (`PM2_API_INSTANCES>1`) is a second way to scale. It shares one container's memory and CPU limit and one set of database pools, so it competes with container replicas. | `ecosystem.config.cjs` | Phase 7 (document: scale with containers, leave at 1) |
| I13 | `LocalStorageStrategy` is registered as the `StorageStrategy` provider but nothing injects it; uploads use Cloudinary. If someone wires it in, files land on one container's disk and break with replicas. | `upload.module.ts`; no other users | Phase 3B cleanup, delete it |
| I14 | The PDF generator writes to a caller-supplied `outputPath`. **To verify** it is a temporary directory removed afterwards and not a path other replicas need. | `pdf-generator.util.ts` 25–29 | Phase 4 (4.6) check |

### Low

| ID | Finding | Fix lands in |
|---|---|---|
| I15 | The compose file mixes the dev and production profiles with a shared `nuts_api` name (production `api-prod` and the dev api). Fine for now, but another reason to remove `container_name` (I1). | Phase 7 |
| I16 | The worker health port and the metrics port are different servers per role. Keep, but document one table of ports (this document's section 1). | done here |

## 4. Capacity formulas (no test evidence yet)

Database connections for one environment:

`total = Σ over roles (replicas × DB_CONNECTION_LIMIT)`, plus about 3 for migrations and the DLQ tool.

The production compose services all use the default pool of 15, so with one of each role the upper bound is 45; with 3 api and 2 worker replicas it is `3×15 + 2×15 + 1×15 = 90`. That is the number to compare against the database's connection limit. With a pooler in transaction mode (Supabase port 6543, `pgbouncer=true`) the limit is the pooler's client limit, not Postgres `max_connections`. **To verify against your plan's real limits.**

Recommended starting values (to be tested, not promised): api 10, worker 5, jobs 3, which is 18 per set. Do not raise a pool to fix slowness until the slow-query and `Server-Timing` data says connections are the bottleneck.

Redis uses one connection per process, plus one for the api's notification subscriber. RabbitMQ uses one connection per process.

Can more worker replicas overwhelm things? Each replica takes up to 10 unacknowledged messages, and each handler needs a database connection (pool of 5). Ten messages in flight against 5 connections queue up inside the pool, which is acceptable backpressure; the risk is the downstream providers (Brevo, Paystack rate limits), which is why the handler timeout and breaker-aware retry (4.7, 4.9) come first. **To verify with the load test (7.3).**

## 5. Observability: what exists and what is missing

Exists: HTTP duration histogram (route, status), transaction duration and retries, outbox pending count and oldest age, `nuts_background_up`, RabbitMQ up, queue depth and consumers per queue; alerts for DLQ, queue backlog, no consumers, stalled workflow queue, stuck outbox, broker down, background program down, role missing, memory, event-loop lag, error rate, slow requests, transaction conflicts and slow transactions.

Missing (and where each lands):

| Gap | Phase |
|---|---|
| Consumer processing duration, failures, retries and acknowledgement counts per queue | 4.4–4.5 |
| Queue backlog **age** (oldest message), not only depth | 4.11 |
| Circuit-breaker state per dependency, and an alert | 4.8 |
| Outbox dead rows | 4.1 |
| Database pool in use, waiting and size; slow-query count | 7.2 |
| Redis memory, evictions, connected clients (needs a Redis exporter or the provider's metrics) | 7.2 |
| Container CPU, memory and restarts (cAdvisor or the platform's metrics) | 7.2 |
| Temporal task-queue backlog, workflow failures, activity retries, workflow duration (SDK metrics) | 8.1 |
| P50 and P99 on dashboards (the histogram already supports them) | 7.2 |

Metrics, logs, traces and error tracking stay separate tools: Prometheus holds numbers, structured JSON logs go to a log destination (staging decision S9), Sentry holds exceptions. **Tracing decision:** OpenTelemetry is worth adding only after the event backbone (phase 5), because a trace across API request, outbox, message, worker and workflow needs one envelope that carries a trace id. The request id already travels in a message header today, which covers most debugging in the meantime. Decide in phase 7.

## 6. Temporal: what has actually been built

- Foundation only, development only (`TEMPORAL_ENABLED=false` by default): client configuration, a worker started by `temporal-worker.ts` (glibc image), a task queue `q.nuts.workflows`, a workflow-start consumer on RabbitMQ, a sandbox rule that keeps workflow files deterministic (architecture rule api:4).
- No business workflow is implemented. Retry policies, timeouts, heartbeats, signals, timers, versioning and saga compensation are therefore not yet exercised; they are written per workflow in phase 8.
- Suitable processes, in order of value: order payment expiry (replaces the unpaid-orders cron), refunds (multi-step, must not duplicate), fulfillment, creator payouts and settlement, abandoned-cart timers, account deletion. Checkout, payment initialisation and inventory reservation stay inside one database transaction plus the outbox; Temporal is for long waits and multi-step recovery, not for a single request.
- Compatibility rule for later: each workflow change goes through Temporal's patching or a new workflow type name, so running executions are never broken by a deploy.

## 7. Fault-injection design (run in phase 7.4, development only)

Never against staging or production data. Manual scripted drills, not part of CI (slow and environment-dependent).

| Fault | Should happen | Stays up | Delayed | Recovery | Loss or duplicates | Metric that shows it |
|---|---|---|---|---|---|---|
| Kill api | PM2 restarts it; nginx retries another replica if there is one | worker, jobs, web | in-flight requests fail | automatic | none for committed work | `nuts_background_up`, http error rate |
| Kill worker | restart; unacknowledged messages redeliver | api, jobs | emails, inventory, analytics, audit | automatic | no loss; **duplicates possible** until consumers are idempotent (I3, R8) | queue depth, consumers per queue, DLQ |
| Kill jobs | restart; missed ticks run next interval | api, worker | cron work only | automatic | none (idempotent crons) | `nuts_background_up{program="jobs"}` |
| RabbitMQ down | api keeps accepting orders; the outbox keeps rows | api | everything asynchronous | broker returns, relay resumes | no loss (outbox) | `nuts_rabbitmq_up`, outbox age |
| Redis down | api serves; throttler falls back; cron jobs skip a tick | api | cache-heavy endpoints slower, cron skipped | automatic reconnect | none | readiness `redis`, latency |
| Postgres interrupted | readiness fails; requests error; pool reconnects | web, health | all writes | automatic | open transactions roll back | readiness, error rate, tx metrics |
| Temporal worker down | workflows pause | everything else | workflow steps | restart resumes from history | none | task-queue backlog (not yet exported) |
| Temporal server down | outbox-started workflows wait on the queue | everything else | workflow start | server returns | none | `WorkflowQueueStalled` |
| Paystack slow or down | circuit opens; checkout shows a retry message | catalogue, cart | payment init and verify | circuit half-opens | webhook is the source of truth, no loss | breaker state (missing, 4.8) |

## 8. Answers to your direct questions

- **Can API, worker and jobs scale independently?** The code allows it for the api and worker (stateless, queue competing consumers, SKIP LOCKED outbox). The deployment files do not yet (I1, I6), and jobs must never be scaled (I2 protects against a mistake).
- **What assumptions block scale today?** `container_name` and the single nginx upstream (I1), per-role pool sizes not set (I6), no drain on shutdown (I3, I4), unlocked crons if two jobs run (I2), the read-modify-write inventory consumer (I5).
- **Do PM2, Docker and the app overlap?** PM2 restarts a crashed process with backoff and a graceful memory restart; Docker restarts the container if PM2 gives up, runs health checks and limits resources; the app handles drain and readiness. Keep all three; align the timeouts (I4).
- **Microservices?** Not needed. Nothing found requires splitting the code.
- **Load capacity?** Unknown. No claim until the phase 7.3 test.

## 9. Changes this audit makes to the roadmap

- New phase 3A (this document), done.
- Phase 4: 4.3 now includes locking every cron (I2); 4.6 includes draining consumers on shutdown (I3); 4.9 includes a handler timeout and per-queue prefetch (I7).
- Phase 7: new items for the scaling recipe (I1, I4, I6, I8, I12), metrics gaps (section 5), and the fault-injection drills (section 7).
- Phase 3B (small cleanup, with phase 4): delete the unused `LocalStorageStrategy` (I13).
