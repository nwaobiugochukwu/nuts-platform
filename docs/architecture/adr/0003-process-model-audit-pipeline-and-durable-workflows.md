# ADR 0003: Independent processes under PM2, an asynchronous audit pipeline and Temporal for durable workflows

- **Status:** Proposed (decisions below, awaiting go-ahead); implementation not started. See the [platform reliability plan](../platform-reliability-plan.md).
- **Date:** 2026-11-25
- **Owners:** Platform engineering
- **Related code:** [`main.ts`](../../../apps/api/src/main.ts), [`app.module.ts`](../../../apps/api/src/app.module.ts), [`rabbitmq/`](../../../apps/api/src/infrastructure/messaging/rabbitmq), [`outbox/`](../../../apps/api/src/infrastructure/messaging/outbox), [`audit-log.service.ts`](../../../apps/api/src/modules/audit/services/audit-log.service.ts)

## Context

The API is one NestJS process that does everything: it serves HTTP and server-sent events, runs fourteen cron jobs, consumes five RabbitMQ queues, relays the outbox and runs the announcement and refund reconcilers. A crash, memory leak or slow batch job in any one of them takes down all of them, including checkout. Cron jobs are protected from running twice by a Redis lock, but every extra API instance would still run every job.

Audit logging is awaited inside request handlers (64 call sites, two near-identical `AuditLogService` classes), so a slow audit write slows the response and a failed one is swallowed.

Database transactions are written by hand in 33 places. The two Serializable ones (cart checkout, referral rewards) never retry on a serialization conflict, timeouts are set inconsistently, and the outbox relay is woken from inside a transaction before it commits.

Long-running business processes (payment expiry, refunds, announcements, abandoned carts, account deletion, and soon parcel handover deadlines and payouts) are implemented as polling crons with ad-hoc "lease" columns. They work, but their state is spread across tables, retries are hand-written and nothing shows where a given order's process currently stands.

## Decisions

1. **One image, several independent process roles.** The same build runs as `api` (HTTP and SSE only), `worker` (RabbitMQ consumers and the outbox relay), `jobs` (scheduled jobs, exactly one instance) and later `workflow-worker`, plus `web`. A role is chosen by `PROCESS_ROLE`; each role loads only the modules it needs. A crash or restart in one role does not stop the others.
2. **PM2 (`pm2-runtime`) supervises the roles.** One `ecosystem.config.cjs` describes every role with restart backoff, memory ceilings, graceful-shutdown timeouts and (for `api`) cluster mode. In containers each role runs as its own compose service using the same ecosystem file with `--only <role>`, so isolation exists at both the container and process level. Logs stay structured JSON on stdout.
3. **Audit is a decorator plus a pipeline, never a wait.** `@Audit(...)` on a controller method records the event after a successful response (and, where marked, after selected failures). The request never waits for it. Critical actions (money, authentication, permissions, admin changes) write the audit event to the transactional outbox in the same database transaction as the change; everything else is published to RabbitMQ after the response. A dedicated consumer batches inserts into an append-only table. The two audit services are merged into one.
4. **Temporal runs durable multi-step workflows; RabbitMQ stays for fan-out.** Anything with timers measured in minutes to days, waits for a human or external signal, or compensating steps becomes a Temporal workflow with idempotent activities. RabbitMQ keeps fire-and-forget events (notifications, emails, analytics, inventory, cache). The outbox stays: a relay consumer starts workflows with a business key as the workflow id so starts are idempotent.
5. **One transaction runner.** A single injectable `TransactionRunner` replaces the 33 hand-written `$transaction` calls. It is called explicitly and passes a transaction client to the services that take part, retries serialization conflicts, applies timeout presets, runs after-commit hooks (cache, relay wake-up, notifications) only once the transaction has committed, and carries the outbox and critical-audit helpers so both are written atomically with the change.
6. **Observability is part of the work, not an afterthought.** Prometheus metrics from every role, correlation IDs carried through HTTP, RabbitMQ and Temporal, queue-depth, outbox-lag and dead-letter alerts, per-role health and readiness, Sentry kept for errors.

## Consequences

- Positive: failures are contained; cron jobs cannot double-run when `api` scales; slow audit writes and slow batch jobs stop affecting users; long processes become visible, retryable and testable with time skipping.
- Negative: more moving parts (a Temporal server and its database, more services in compose), a stricter module split inside the API, and a learning curve for workflow determinism. Self-hosted Temporal needs about 1 GB of memory on top of today's stack; Temporal Cloud avoids that for a fee.
- Neutral: PM2 adds little over container restart policies when each role is already its own container; its value here is the single declarative process description, cluster mode for `api`, graceful reload and consistent restart rules across roles and environments.

## Alternatives considered

- **Keep one process and only add locks:** cheapest, but a leak or crash still stops everything.
- **BullMQ (Redis) instead of Temporal:** simpler to run and enough for retries and delays, but it has no durable workflow state, signals or compensation model, so long processes would stay hand-written.
- **Only RabbitMQ (delayed messages and dead-letter timers):** workable for single delays, painful for multi-step processes with waits and compensation.
- **Audit by database triggers:** complete and unskippable, but loses who and why (actor, request, reason) and cannot be redacted per field.
