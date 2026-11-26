# ADR 0004: Operational safety and environment parity

- **Status:** Accepted; implemented on the release branch, not yet merged or deployed.
- **Date:** 2026-11-25
- **Owners:** Platform engineering
- **Related code:** [`process-role.ts`](../../../apps/api/src/infrastructure/configuration/process-role.ts), [`heartbeat.service.ts`](../../../apps/api/src/infrastructure/health/heartbeat.service.ts), [`ecosystem.config.cjs`](../../../apps/api/ecosystem.config.cjs), [`ecosystem.dev.config.cjs`](../../../apps/api/ecosystem.dev.config.cjs), [`request-context.ts`](../../../apps/api/src/common/request-context/request-context.ts), [`audit.interceptor.ts`](../../../apps/api/src/common/audit-log/audit.interceptor.ts), [`verify-deploy.sh`](../../../scripts/verify-deploy.sh)

## Context

[ADR 0003](0003-process-model-audit-pipeline-and-durable-workflows.md) split the API into independent programs. Reviewing that work against a real staging setup (Render services for web and api; Supabase, Redis Cloud and a hosted AMQP broker) found four problems:

1. **Silent failure.** The api no longer sends emails or runs scheduled jobs. If the worker or jobs program is not running, nothing errors; the work just stops.
2. **A wrong safety net.** The documented fallback (`PROCESS_ROLE=all`) did nothing under PM2, because the PM2 file sets the role, and `PM2_APP` defaulted to `api`. An untouched service would have silently lost its background work on the next deploy.
3. **Development differed from staging.** Locally the API ran as one process; staging ran separate programs, so problems appeared only in staging.
4. **Hosted limits.** Every program loads the whole application, so each opens its own database pool, Redis connections and broker connection; three programs triple them against hosted plan limits.

Audit had a fifth issue: it was written by hand inside 11 services (64 calls), which made it easy to forget and noisy to read.

## Decisions

1. **The same programs in every environment.** Development (`npm run dev`), Docker development and staging all run web, api, worker and jobs under PM2 and differ only in configuration. A one-process mode exists for debugging only.
2. **`PM2_APP` selects the program and defaults to `all`.** An unconfigured service behaves as it did before the split; split environments set `api`, `worker`, `jobs` explicitly. Under PM2 the role comes from `PM2_APP`; `PROCESS_ROLE` matters only when PM2 is disabled.
3. **Make absence loud.** Worker and jobs write heartbeats to Redis; `GET /api/v1/health/background` fails with a plain explanation when a heartbeat is stale or a queue has no consumer (it is deliberately not a container health check, so a missing worker never takes the api out of rotation); `scripts/verify-deploy.sh` runs it after deploys; the api logs an error 90 s after start if programs are missing; a metric and an alert cover it.
4. **One request id end to end.** The id is carried through the outbox, the RabbitMQ header, consumers, every log line, audit rows and Temporal memos, so one request can be followed across programs.
5. **Ports resolved in one place.** `portFor(kind, program)` reads `{PROGRAM}_{KIND}_PORT`, then `{KIND}_PORT`, then a default, so one local env file serves every program while a deployed service sets one value. Metrics are on by default only in development; elsewhere nothing is exposed until a port is set.
6. **A connection budget.** Only the api opens the live-notification subscriber; each Render service sets its own database pool size (api 10, worker 5, jobs 3).
7. **Audit is declared, not hand-written.** `@Audit` on the controller method says what happened; services attach specifics with `auditDetails` / `auditAlso`; a global interceptor records the event after the response. Calls outside any request are allowed only where listed, by exact count, and the list can only shrink.
8. **A development start that is ordered and independent.** `npm run dev` starts the data services, then the compiler, api, worker, jobs and web **one after another, each waiting until the previous is healthy** (a small launcher, `scripts/dev.mjs`, with tests). A step that never becomes healthy is reported and the rest still start, because the services do not depend on each other once running. VS Code users get one terminal tab per service from `.vscode/tasks.json`. Turborepo's all-at-once view remains as `npm run dev:parallel`. Docker Compose (`npm run dev:docker`) remains the production-parity option with true per-service restarts.

## Consequences

- Positive: a missing program is detected within seconds; development reproduces staging behaviour, including automatic restarts; an untouched Render service keeps working; the connection total is known and bounded; adding audit to an endpoint is one decorator.
- Negative: every program loads the whole application (more memory per program); a first start takes about 30 seconds; developers need Docker for the shared services; PM2 is an extra layer where a platform already restarts containers (accepted for one description across environments and restart backoff).
- Neutral: the audit trail's critical tier (money, permissions) still uses the standard path until it moves into transactions in a later release.

## Alternatives considered

- **Keep one process locally.** Simpler, but hides every problem that only the split exposes.
- **Rely on the platform's restarts and drop PM2.** Closer to common practice and less to maintain; PM2 stays for now because it gives one declarative description, restart backoff and crash-loop protection in every environment.
- **Treat a missing worker as an API readiness failure.** It would stop traffic for a problem that only affects background work.
- **Distributed tracing instead of request ids.** More capable and more to run; request ids answer the immediate question and can feed tracing later.
