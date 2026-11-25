# Running and testing locally

Everything below was run on a clean checkout of the `feat/ops-request-ids-dlq-dashboards` branch, which contains every change in PRs #155-#160 plus the ops tooling. After those PRs merge, use `development`.

## 1. First-time setup

```bash
npm install
npm run db:generate          # Prisma client
npm run migrate:deploy       # applies pending migrations, including the new audit_logs columns
```

Requires Docker (databases and broker run in containers) and Node 22. Environment files: `apps/api/.env.development` and `apps/web/.env.development` (see `.env.example` next to each).

## 2. Start everything

Two ways, both start the databases and broker first:

| Command | What runs |
|---|---|
| `npm run dev` | web plus **one** backend program doing api, worker and jobs together. Simplest for everyday work. |
| `npm run dev:split` | web, api, worker and jobs as **four separate programs**, the same shape as staging and production. Stopping one leaves the others serving. |

Use one or the other, not both (they share ports). With `dev:split`: api `:3001`, worker health `:3002`, jobs health `:3003`, web `:5173`, metrics on `:9464` (api), `:9465` (worker), `:9466` (jobs). In this mode the worker and jobs programs do not restart by themselves if they crash (production does that with PM2); they restart when you change code.

### `npm run dev`

```bash
npm run dev
```

This starts PostgreSQL (`:5433`), Redis (`:6379`), RabbitMQ (`:5672`, management UI `http://localhost:15672`) and RedisInsight (`:8001`) through `docker-compose.db.yml`, then runs the API and the web app with Turbo:

| What | Where | Ready after |
|---|---|---|
| API | `http://localhost:3001/api/v1/health` | about 35 s (the TypeScript compile runs first) |
| Web | `http://localhost:5173` | about 15 s after the API starts compiling |

Locally the API runs **every role in one process** (`PROCESS_ROLE` unset means `all`): HTTP, queue consumers, scheduled jobs and the outbox relay, exactly as before. You do not need PM2, extra containers or Temporal to test the app. Stop with Ctrl+C; stop the databases with `npm run db:down`.

Each part can also run alone: `npm run dev:api`, `npm run dev:web`.

## 3. What changed and how to check it

| Change | How to see it |
|---|---|
| Multi-vendor payout guard | As a vendor, open an order that also contains another vendor's items: Ship and Deliver are hidden with an explanation; the API answers 403 if called anyway. |
| Scroll position | Scroll the home page, open a product, press Back: you return to the same spot. Click the logo or reload: you start at the top. |
| "Not interested" | Home, "Picked based on your activity": use the link under a card; it disappears and stays gone after a refresh. |
| Audit trail | Perform an admin action, then look at `audit_logs`: the row has `eventId`, `source`, `requestId`. Admin audit viewer still works. |
| Request ids | Every API response has `X-Request-Id`; the same id appears in the logs of the consumer that handled the resulting message and in `audit_logs.requestId`. |
| Metrics | Set `METRICS_PORT=9464` in `apps/api/.env.development`, restart, then `curl localhost:9464/metrics`. |
| Dead letters | `npm run dlq --prefix apps/api -- list` (see section 6). |

## 4. Running the roles under PM2 (production-style restart behaviour)

To see the API split into independent processes (as production does):

```bash
npm run build --prefix apps/api
cd apps/api
export NODE_ENV=development
PM2_HOME=/tmp/pm2-api    PORT=3001 METRICS_PORT=9466 npx pm2-runtime ecosystem.config.cjs --only api
PM2_HOME=/tmp/pm2-worker HEALTH_PORT=3002 METRICS_PORT=9464 npx pm2-runtime ecosystem.config.cjs --only worker
PM2_HOME=/tmp/pm2-jobs   HEALTH_PORT=3003 npx pm2-runtime ecosystem.config.cjs --only jobs
```

Run each in its own terminal, each with its own `PM2_HOME` (in production each role is its own container, so they never share one). Check `curl localhost:3002/health` and `localhost:3003/health`. Do not run these at the same time as `npm run dev` on the same ports, and do not run the `all` role alongside them, or scheduled jobs and consumers will run twice.

## 5. Temporal (optional)

Temporal is off by default and has no real workflows yet; only try it to see the foundation work.

```bash
docker compose --profile dev up -d temporal      # server :7233, UI http://localhost:8233, namespace nuts-dev
```

In `apps/api/.env.development` set `TEMPORAL_ENABLED=true`, `TEMPORAL_ADDRESS=localhost:7233`, `TEMPORAL_NAMESPACE=nuts-dev`, restart the API, then run the worker: `npm run build --prefix apps/api && npm run pm2:temporal-worker --prefix apps/api`. Stop with `docker compose --profile dev stop temporal`. More in [Temporal](temporal.md).

## 6. Dead-letter queue

Failed queue messages land in `q.nuts.dlq`. Your local broker may already hold some from earlier runs.

```bash
npm run build --prefix apps/api
npm run dlq --prefix apps/api -- list                         # read-only
npm run dlq --prefix apps/api -- replay --dry-run             # what would be replayed
npm run dlq --prefix apps/api -- replay --queue q.nuts.emails --limit 5
npm run dlq --prefix apps/api -- purge --queue q.nuts.analytics --yes
```

Replay sends a message back with its original routing key and acknowledges it only after the broker confirms; a message replayed more than 3 times is skipped unless `--force`. Replaying emails or notifications sends them again, so check the list first. Message bodies are shown redacted and truncated.

## 7. Tests and checks

```bash
npm test --prefix apps/api            # unit tests + Temporal workflow tests (downloads a test server once)
npm run lint && npm run typecheck     # API and web
npm run test:unit --prefix apps/web
npm run check:architecture
python3 scripts/check-doc-links.py
```

## 8. Seeing metrics and the dashboard

`ops/prometheus/prometheus.example.yml` shows how to scrape the roles and load `ops/prometheus/alerts.yml`; `ops/grafana/nuts-overview.json` is a Grafana dashboard (Dashboards, New, Import, upload the file, pick your Prometheus). Both were validated: `promtool` accepts the rules, every dashboard query ran against a live Prometheus scraping a real worker and API, and Grafana imported the dashboard.
