# Temporal (durable workflows)

Temporal runs the multi-step, long-running business processes (payment expiry, refunds, announcements, parcel deadlines, payouts). RabbitMQ stays for fire-and-forget fan-out. Design: [ADR 0003](../architecture/adr/0003-process-model-audit-pipeline-and-durable-workflows.md); workflow catalogue: [platform reliability plan](../architecture/platform-reliability-plan.md#63-workflow-catalogue-from-the-scan).

**Status: foundation only.** The client, worker, outbox-started workflows, tests and images exist; the only workflow is a sample template. The real workflows (W1-W11) are not migrated yet, so enabling Temporal changes nothing in production behaviour.

## Pieces

| Piece | Where | Notes |
|---|---|---|
| Client | `WorkflowClientService` | Lazy connection, idempotent `startWorkflow` (the workflow id is the business key), `signalWithStart`, `signal`, `describe`. A logged no-op while `TEMPORAL_ENABLED` is not `true`. |
| Start from a transaction | `ctx.startWorkflow(...)` | Written to the outbox in the same transaction as the change; the relay publishes `workflow.start`; the `worker` role's `WorkflowStartConsumer` starts it. Duplicates are harmless. |
| Workflows | `infrastructure/workflows/workflows/` | Deterministic sandbox code: only `@temporalio/workflow` and pure modules (enforced by `npm run check:architecture`). Export each one from `index.ts`. |
| Activities | `infrastructure/workflows/activities/` | All I/O (database, HTTP, messages). Must be idempotent; Temporal retries them. Register new providers in `WorkflowWorkerModule` and `buildActivities`. |
| Worker | `workflow-worker.ts`, role `workflow-worker` | Polls the task queues in `TEMPORAL_TASK_QUEUES` (default all five). Health on `HEALTH_PORT` (default 3004); SDK metrics on `TEMPORAL_METRICS_PORT`. |

Task queues: `nuts-default`, `nuts-payments`, `nuts-fulfillment`, `nuts-comms`, `nuts-lifecycle`, one per concern so a noisy queue cannot starve payments.

## Running it locally

```bash
docker compose --profile dev up -d temporal        # server on :7233, UI on http://localhost:8233, namespace nuts-dev
# in apps/api/.env.development:
#   TEMPORAL_ENABLED=true
#   TEMPORAL_ADDRESS=localhost:7233
#   TEMPORAL_NAMESPACE=nuts-dev
npm run build --prefix apps/api
npm run pm2:workflow-worker --prefix apps/api      # or: node -r tsconfig-paths/register dist/workflow-worker.js
```

Workflow tests use Temporal's time-skipping test server (downloaded on first run), so a six-hour timer finishes in milliseconds: `npm run test:workflows --prefix apps/api` (also part of `npm test`). They need Node's `--experimental-vm-modules` flag, which would break other specs, so they run as a separate Jest invocation.

## The image

The Temporal native core has **no musl build**, so the worker cannot run on the Alpine API image. The Dockerfile has a Debian target, `runner-workflow`, built from `builder-glibc`; compose service `workflow-worker-prod` (profile `temporal`, opt-in, not in `prod` or `staging`) uses it. A plain `docker build` still produces the Alpine `runner`, because that stage stays last.

## Production

Recommended: **Temporal Cloud** for production (the server's database, upgrades and backups are the real burden; check current pricing), self-hosted dev server for development, and Cloud or a separate self-hosted cluster for staging. Never run the Temporal server on the same memory-limited host as the API. Set `TEMPORAL_ADDRESS=<namespace>.<account>.tmprl.cloud:7233`, `TEMPORAL_NAMESPACE=<namespace>.<account>` and `TEMPORAL_API_KEY`. Keep the Web UI behind authentication, never public.

## Rules for new workflows

- Never change a running workflow's code without versioning (`patched()`); add a replay test against a saved history before deploying.
- Use the business key as the workflow id (`order-payment:<orderId>`); start with `ctx.startWorkflow` so the start commits with the data.
- Signals for outside events (webhooks, admin decisions), timers for deadlines, child workflows for fan-out.
- Money activities check current state before acting and carry an idempotency key.
- A database transaction never spans two activities.
