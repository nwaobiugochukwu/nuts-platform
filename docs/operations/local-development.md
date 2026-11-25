# Running and testing locally

Everything below was run on the `feat/ops-request-ids-dlq-dashboards` branch, which contains every change in PRs #155-#160 plus the ops tooling. After those PRs merge, use `development`.

## 1. First-time setup

```bash
npm install
npm run db:generate          # Prisma client
npm run migrate:deploy       # applies pending migrations, including the new audit_logs columns
```

Requires Docker (databases and broker run in containers) and Node 22. Environment files: `apps/api/.env.development` and `apps/web/.env.development` (see `.env.example` next to each).

## 2. Start everything

```bash
npm run dev
```

This starts the databases and broker (`docker-compose.db.yml`), then **four separate programs**, the same shape as staging and production:

| Program | What it does | Where |
|---|---|---|
| web | the screens | `http://localhost:5173` |
| api | answers requests | `http://localhost:3001/api/v1/health`, metrics `:9464` |
| worker | emails, notifications, analytics, stock updates, audit writing | health `:3002`, metrics `:9465` |
| jobs | scheduled jobs (exactly one) | health `:3003`, metrics `:9466` |

Ready after about 30 s (the TypeScript compile runs first). The programs run under **PM2**, the same supervisor staging uses: a program that crashes is restarted automatically, a change to the source recompiles and restarts the programs, and every log line starts with its program name (`[api]`, `[worker]`, `[jobs]`). Stopping one program leaves the others serving. Ctrl+C stops everything; `npm run db:down` stops the databases.

Related commands:

| Command | Use |
|---|---|
| `npm run dev:backend` | the three backend programs (api, worker, jobs) without web |
| `npm run dev:api` | only the api program (start `dev:worker` and `dev:jobs` in other terminals, or emails and scheduled jobs will not run) |
| `npm run dev:web` | only the web app |
| `npm run dev:docker` | the same four programs as Docker containers (`docker compose --profile dev`): `api`, `worker`, `jobs`, `client` |
| `npm run dev:worker`, `npm run dev:jobs` | one program each, in its own terminal (each keeps its PM2 state under `apps/api/.pm2/`) |
| `npm run dev --prefix apps/api` | same as `dev:backend` |
| `npm run dev:single` | one backend program doing everything (`all`). For debugging only; it is **not** how staging or production run |
| `npm run start:debug --prefix apps/api` | like `dev:single` with the Node inspector on port 9229 |

If a command says a port is in use, an old run is still alive (look for leftover `node` processes).

## Is everything running? `scripts/verify-deploy.sh`

```bash
scripts/verify-deploy.sh http://localhost:3001
```

Checks that the api is up, the database and cache are reachable, and that the **worker and jobs programs are running** (heartbeats plus a consumer on every queue). Without the worker or jobs, the site still loads but emails, notifications and scheduled jobs silently stop; this check turns that into a visible failure and says what is missing. Run it after every deploy, against staging and production URLs too.

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

`npm run dev` already runs the same separate programs; this section additionally shows PM2's automatic restarts.

To see the API split into independent processes (as production does):

```bash
npm run build --prefix apps/api
cd apps/api
export NODE_ENV=development
PM2_HOME=/tmp/pm2-api    PORT=3001 METRICS_PORT=9466 npx pm2-runtime ecosystem.config.cjs --only api
PM2_HOME=/tmp/pm2-worker HEALTH_PORT=3002 METRICS_PORT=9464 npx pm2-runtime ecosystem.config.cjs --only worker
PM2_HOME=/tmp/pm2-jobs   HEALTH_PORT=3003 npx pm2-runtime ecosystem.config.cjs --only jobs
```

Run each in its own terminal, each with its own `PM2_HOME` (in production each role is its own container, so they never share one). Check `curl localhost:3002/health` and `localhost:3003/health`. Do not run these at the same time as `npm run dev` (same ports).

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

## 8. Seeing, tracking and tracing locally

### The monitoring stack

```bash
npm run obs:up       # starts Prometheus and Grafana (profile "observability")
npm run obs:down     # stops them
```

| What | Where | Notes |
|---|---|---|
| Grafana | `http://localhost:3030` | login `admin` and `GRAFANA_ADMIN_PASSWORD` from the root `.env` (default `admin`); opens with the **NUTS Platform Overview** dashboard and the Prometheus data source already set up |
| Prometheus | `http://localhost:9090` | Status, Targets shows each program; Alerts shows the 13 alert rules from `ops/prometheus/alerts.yml` |
| Raw metrics | `http://localhost:9464/metrics` (api), `:9465` (worker), `:9466` (jobs), `:9467` (temporal worker) | plain text, one line per measurement |

Start `npm run dev` first (or after; a program that is not running shows as down). The temporal worker target stays down until Temporal is turned on. Every port can be changed in `apps/api/.env.development`; see `apps/api/.env.example` ("Programs, ports and monitoring").

What the dashboard answers: *Is it healthy?* (dead-letter queue, oldest pending outbox event, broker up, 5xx rate), *Queues and outbox* (what is waiting, who is consuming), *API* (traffic and the slowest routes), *Database transactions* (timing and conflict retries), *Processes* (memory, event-loop lag, CPU, which programs report in).

### Tracing one request

Every API response carries an `X-Request-Id` header, and the same id is written to every log line produced while handling that request, copied onto the RabbitMQ messages it causes (header `x-request-id`), restored in the worker that handles them, stored in the audit row (`audit_logs.requestId`), and set as a memo on any Temporal workflow it starts. To follow a request end to end:

1. Make the request and note the id: `curl -i http://localhost:3001/api/v1/categories | grep -i x-request-id`.
2. Search the terminal output of `npm run dev` for that id. You will see lines from the api and, if the request caused background work, from the worker.
3. Look it up in the database: `select action, entity, "entityId", "requestId" from audit_logs where "requestId" = '<id>';`.

Distributed tracing with spans and a trace viewer (OpenTelemetry) is not built; request ids give you the same "follow one request" answer today, and Sentry already records traces for errors.

### Checking the alerts and dashboard themselves

`ops/prometheus/alerts.yml` is validated with `promtool`, every dashboard query was run against a live Prometheus, and Grafana imports the dashboard; the provisioned stack above loads both automatically.
