# Processes, health and monitoring

The API image runs as three independent roles. Each role is its own container and runs under PM2 (`pm2-runtime`), so a crash in one does not stop the others. Design and rationale: [ADR 0003](../architecture/adr/0003-process-model-audit-pipeline-and-durable-workflows.md) and the [platform reliability plan](../architecture/platform-reliability-plan.md).

## Roles

| Role | Compose service | Starts | Health | Metrics port |
|---|---|---|---|---|
| `api` | `api-prod` | HTTP, SSE | `GET :3001/api/v1/health` (liveness), `/api/v1/health/ready` | 9464 |
| `worker` | `worker-prod` | RabbitMQ consumers, outbox relay sweep | `GET :3002/health` | 9464 |
| `jobs` | `jobs-prod` | Scheduled (cron) jobs. **Run exactly one.** | `GET :3003/health` | 9464 |

Under PM2 (every container) the program is chosen by **`PM2_APP`**: `all`, `api`, `worker` or `jobs`. The PM2 file then sets `PROCESS_ROLE` itself, so setting `PROCESS_ROLE` in an environment has no effect there; it only matters when PM2 is disabled. **`PM2_APP` defaults to `all`** (everything in one process, exactly as before the split), so a service nobody has configured keeps working; split environments set it explicitly on each service.

**Deploy order matters.** Crons and queue consumers run only in `worker-prod` and `jobs-prod`. The repository does not deploy to a host, so the host's compose file must contain all three services before `api-prod` moves to the `api` role; otherwise nothing consumes queues or runs jobs. To run everything in one container temporarily, set `PM2_APP=all` on `api-prod` (this is also the default).

**Rollback:** set `PM2_ENABLED=false` to start one plain Node process instead of PM2 (the role then comes from `PROCESS_ROLE`, default `all`).

## PM2 behaviour (`apps/api/ecosystem.config.cjs`)

- Restarts a crashed process with exponential backoff; gives up after 10 quick failures so the container healthcheck takes over.
- Restarts gracefully above `PM2_MAX_MEMORY` (default 600M) and allows `PM2_KILL_TIMEOUT_MS` (default 30 s) to drain.
- `PM2_API_INSTANCES` above 1 turns `api` into cluster mode; only do this after raising CPU limits.
- Logs are structured JSON on stdout; read them with `docker compose logs <service>`.

## Metrics

Each role serves Prometheus metrics on the internal `METRICS_PORT` (off when unset; never publish it or route it through nginx). Set `METRICS_TOKEN` to require `Authorization: Bearer <token>`.

| Series | Meaning |
|---|---|
| `nuts_http_request_duration_seconds` | API latency by method, route and status class |
| `nuts_db_transaction_duration_seconds`, `nuts_db_transaction_retries_total` | Transaction time and conflict retries by transaction name |
| `nuts_outbox_pending_events`, `nuts_outbox_oldest_pending_age_seconds` | Outbox backlog and the age of its oldest event (best "pipeline stuck" signal) |
| `nuts_rabbitmq_up`, `nuts_rabbitmq_queue_messages`, `nuts_rabbitmq_queue_consumers` | Broker connection, queue depth and consumers; the dead-letter queue should stay at 0 |
| `nuts_process_*`, `nuts_nodejs_*` | Memory, CPU, event-loop lag, GC |

Alert rules are in [`ops/prometheus/alerts.yml`](../../ops/prometheus/alerts.yml) and an example scrape config in [`ops/prometheus/prometheus.example.yml`](../../ops/prometheus/prometheus.example.yml). They work with a self-hosted Prometheus or can be imported into a hosted Grafana stack.

## Common checks

- Is the pipeline healthy? `nuts_outbox_oldest_pending_age_seconds` near 0 and `nuts_rabbitmq_queue_messages{queue="q.nuts.dlq"}` equal to 0.
- A queue is not draining: confirm `worker-prod` is up (`curl :3002/health` inside the network) and the queue's consumer count is above 0.
- Scheduled jobs did not run: confirm `jobs-prod` is up; its logs show each job. Never start a second `jobs` container.

## Silent failures: heartbeats and `verify-deploy`

If the worker or jobs program is not running, nothing errors: queued emails, notifications and scheduled jobs simply stop. To make that loud:

- The worker and jobs programs write a heartbeat to Redis every 30 s (`nuts:heartbeat:worker`, `nuts:heartbeat:jobs`); a program that is `all` writes both.
- `GET /api/v1/health/background` returns 503 with a plain-language explanation if a heartbeat is stale or missing, or if any work queue has no consumer (the queue for workflows is ignored while Temporal is disabled). It is **not** used as a container health check, so a missing worker never takes the API out of rotation.
- `scripts/verify-deploy.sh <base-url>` runs the three health checks and exits non-zero on any failure. Run it after every deploy.
- The API logs an error 90 s after starting if the programs it relies on are missing.
- Metric `nuts_background_up{target}` and alert `BackgroundProgramNotRunning` (critical after 3 minutes).

## Request ids

Every request gets an id (`X-Request-Id`). It is carried through the outbox into the RabbitMQ message header (`x-request-id`), restored for the consumer that handles the message, added to every log line written while handling it, stored in `audit_logs.requestId` and set as a memo on Temporal workflows started from the request. To follow one request, search the logs for its id.

## Dead-letter queue

`npm run dlq --prefix apps/api -- list | replay | purge`; see [Running and testing locally](local-development.md#6-dead-letter-queue). The `DeadLetterQueueNotEmpty` alert fires when anything is waiting.

## Dashboard

[`ops/grafana/nuts-overview.json`](../../ops/grafana/nuts-overview.json): health at a glance, queues and outbox, API traffic and latency, transaction timing, process memory, event-loop lag and CPU. Import it into Grafana and choose your Prometheus data source. HTTP metrics are recorded for every response, including those rejected by middleware or guards (401, 403, 429), under the route label `unmatched` when no route matched.

## Rate limits

The API limits calls per caller address: 100 per minute overall, 10 per minute for session refresh, and 5 per minute for sign-in, registration and one-time codes. A caller over the limit gets HTTP 429 with the message "Too many requests. Please wait N seconds and try again.", the error code `RATE_LIMITED`, and a `Retry-After` header of the seconds really left (never 0). The web app reads it and pauses session refreshes for that long instead of retrying.

The limit only works if the API sees each visitor's real address:

- **Production with nginx:** nginx sends `/api/` straight to the API with `X-Forwarded-For`, so each visitor has their own limit.
- **Render:** the platform's edge adds `X-Forwarded-For` to the web service, and the web service's `/api` rewrite passes incoming headers on to the API. Check the API log of a rejected request (`Request rejected`) shows different `ip` values for different people.
- **Local Docker (`npm run dev`):** nothing sits in front of the web server, so the API sees the web container's address for every browser call and all your tabs share one limit. Expect to reach the refresh limit sooner while testing; it is not what customers see.
