# Deploying to Render (staging)

Staging runs on Render. Today it has two services, **web** and **api**, both built from the repository's Dockerfiles with the Docker runtime. After the platform changes, the API image can run as several independent programs, and on Render each program is its own service. This page says what to create, what to set, and in which order, so staging keeps working throughout.

Why this exists: a crash or slow task in one program must not stop the others, and the background work (emails, notifications, scheduled jobs) must keep running.

## 1. What runs where

| Render service | Type | Dockerfile | `PM2_APP` | Instances |
|---|---|---|---|---|
| **web** (exists) | Web Service | `apps/web/Dockerfile` | not used | 1 |
| **api** (exists, e.g. `nutsonline-api`) | Web Service | `apps/api/Dockerfile` | `api` | 1 or more |
| **worker** (new) | Background Worker | `apps/api/Dockerfile` | `worker` | 1 or more |
| **jobs** (new) | Background Worker | `apps/api/Dockerfile` | `jobs` | **exactly 1** |

All three API-image services use the **same Dockerfile path and Docker build context** as your current api service, and the Dockerfile's last stage (`runner`) stays the last stage, so Render builds the right image. Background Workers have no public URL and no port; Render restarts them if they crash. They are normally a paid instance type; check Render's current pricing before creating them.

## 2. Before anything else

**Do not merge `development` into `staging` until the release containing the `PM2_APP=all` default is in `development`.** With that default, an untouched service behaves exactly as it did before the split (one program doing everything), so deploying changes nothing until you opt in service by service. The earlier open pull requests alone default to `api`, which would silently stop emails and scheduled jobs on your existing api service.

## 3. Environment: one group for shared values, a few per-service values

Create one **Environment Group** (Render dashboard, Environment Groups) named for staging, for example `nuts-staging-api`, containing every variable your api service has today (database, Redis, RabbitMQ, JWT, OTP, Paystack, Brevo, Cloudinary, Google, VAPID, Sentry, `ALLOWED_ORIGINS`, cookies, and so on; see `apps/api/.env.example`). Link the group to the api, worker and jobs services so they can never drift apart. Every program loads the whole app, so each needs the same values.

Set these **on each service** (they are not secrets; you type them):

| Variable | api | worker | jobs | Notes |
|---|---|---|---|---|
| `PM2_APP` | `api` | `worker` | `jobs` | Chooses the program. Unset means `all` |
| `DB_CONNECTION_LIMIT` | `10` | `5` | `3` | Each program has its own database pool; see section 4 |
| `AUTO_MIGRATE` | leave unset | `false` | `false` | Only the api runs database migrations on start; two more services migrating at once would race |
| `PORT` | set by Render | not used | not used | Render injects it for web services |
| `HEALTH_PORT` | not used | optional | optional | Background Workers expose nothing, so it is harmless |
| `METRICS_PORT`, `METRICS_TOKEN` | optional | optional | optional | See section 7 |

`PROCESS_ROLE` is **not** set by you: under PM2 the PM2 file sets it from `PM2_APP`.

## 4. Connection budget (hosted database, Redis and broker)

Every program holds its own connections, so three programs use three times as many:

| Resource | api | worker | jobs | Total |
|---|---|---|---|---|
| Database (Supabase pooler) | up to 10 | up to 5 | up to 3 | up to 18 (with the defaults of 15 each it would be 45) |
| Redis (Redis Cloud) | 2 (client plus the live-notification subscriber) | 1 | 1 | 4 |
| RabbitMQ (hosted AMQP) | 1 | 1 | 1 | 3 |

Compare these totals with your Supabase, Redis Cloud and broker plan limits. If a limit is tight, lower `DB_CONNECTION_LIMIT` on the worker and jobs first.

## 5. Safe transition, step by step

1. **Merge and deploy to staging.** Nothing changes: the api service now runs under PM2 with `PM2_APP` unset, which means `all`.
2. **Create the worker and jobs services** (Background Workers, same repository, branch `staging`, Docker runtime, same Dockerfile path and build context as the api, the environment group, plus the per-service values from section 3). For a short time the api and the new services both consume queues and run jobs. That is safe: queue consumers compete for messages, and every scheduled job takes a lock.
3. **Check:** `scripts/verify-deploy.sh https://<your-api>.onrender.com` must pass. It confirms the api is up, the database and cache are reachable, and the worker and jobs are running.
4. **Switch the api to the api-only program:** set `PM2_APP=api` on the api service and redeploy. Run `scripts/verify-deploy.sh` again.
5. Watch the logs of all three services for a few minutes.

**Deploy order each time:** deploy the api first (it applies database migrations), then the worker and jobs. If they start before the migration finishes you may see brief errors that clear on their own.

## 6. Checking health and troubleshooting

| What you see | Meaning | What to do |
|---|---|---|
| `verify-deploy.sh` fails on "worker and jobs are running" | worker or jobs is missing or has stopped | Check that the service exists, is not suspended, and `PM2_APP` is set; read its logs |
| Site works but no emails or notifications | the worker is not running (nothing errors by itself) | Same as above; `GET /api/v1/health/background` names what is missing |
| Scheduled jobs (unpaid-order cancellation, reminders) not happening | jobs is not running | Same as above. Never run more than one jobs instance |
| API logs "Background programs are not running" 90 s after start | the api cannot see the worker or jobs | Same as above |
| Database or Redis connection errors after adding services | connection limits reached | Lower `DB_CONNECTION_LIMIT` on worker and jobs; check plan limits |

## 7. Monitoring on Render

- Render's own logs and metrics for each service, plus Sentry (already configured).
- `GET /api/v1/health/background` and `scripts/verify-deploy.sh` for the "is everything running" question.
- Prometheus metrics (`METRICS_PORT`) are only reachable on Render's private network between services in the same region. To scrape them you would run a small collector as another Render service (for example Grafana Alloy sending to Grafana Cloud). Until you do that, leave `METRICS_PORT` unset on staging. The same metrics and the dashboard run locally with `npm run obs:up`.

## 8. Rolling back

| Problem | Do this |
|---|---|
| The split causes trouble | Set `PM2_APP=all` on the api service and redeploy; suspend the worker and jobs services |
| PM2 itself causes trouble | Set `PM2_ENABLED=false` on the service (one plain Node process; the role then comes from `PROCESS_ROLE`, default `all`) |
| A bad deploy | Use Render's rollback to the previous deploy; migrations are additive, so the previous version still runs |

A reference template with all four services is in [`ops/render/render.staging.example.yaml`](../../ops/render/render.staging.example.yaml). It is not a Blueprint Render picks up automatically; copy it to `render.yaml` at the repository root only if you decide to manage Render from code (a Blueprint creates new services; it does not adopt the ones you made by hand).
