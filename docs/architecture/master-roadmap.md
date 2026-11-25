# Master roadmap: from today to the big operation

This is the single ordered plan. It explains how the application runs in each environment, what has to happen on the server for staging, and the order of the remaining work, finishing with the large rebuild (Temporal workflows and delivery) last.

Related: [platform reliability plan](platform-reliability-plan.md) (design), [hub fulfillment and delivery plan](hub-fulfillment-and-delivery-plan.md) (the big operation's content), [Running and testing locally](../operations/local-development.md).

## 1. How the application runs

The application is made of independent programs. A crash in one does not stop the others.

| Program | What it does | Runs as |
|---|---|---|
| **web** | The storefront, vendor and admin screens (Next.js) | its own program |
| **api** | Answers requests: pages' data, checkout, login | its own program |
| **worker** | Background tasks: emails, notifications, analytics, stock updates, audit writing | its own program |
| **jobs** | Scheduled jobs: cancel unpaid orders, abandoned-cart reminders, cleanups. Exactly one copy | its own program |
| temporal-worker | Long-running workflows (later; only when Temporal is turned on) | its own program |

Plus shared services: PostgreSQL, Redis, RabbitMQ (and Temporal later).

| Environment | How it starts | Programs |
|---|---|---|
| **Local** | `npm run dev` | web, api, worker and jobs as four separate programs, the same shape as staging and production. Health on `:3001` (api), `:3002` (worker), `:3003` (jobs); web on `:5173`. |
| **Local, in Docker** | `npm run dev:docker` | The same four programs as containers (`api`, `worker`, `jobs`, `client`). |
| **Staging / production** | Docker Compose on the server | The same four programs, each in its own container, with PM2 restarting a crashed one. |

All environments run the same programs from the same code and differ only in configuration (env files, hosts, secrets). `npm run dev` starts the database, Redis and RabbitMQ first. A one-program mode (`npm run dev:single --prefix apps/api`) exists only for debugging and is not used anywhere else.

### Should there be more than four programs?

Four is the right number today. More would add cost without a problem to solve:

- **temporal-worker** is the fifth program, added only when Temporal is turned on (step 6).
- **Database migration** is a one-off job that runs before a deploy, not a running program.
- **Splitting the worker further** (for example analytics apart from emails and notifications) is what larger companies do when one kind of work starts delaying another. The signal is in the metrics: a growing queue or rising event-loop lag on the worker. If that happens, the worker gets a setting that selects which queues it consumes, and a second worker container is added. No code rewrite is needed.
- **A separate real-time (SSE) gateway** is common at much larger scale, when thousands of open streams compete with normal requests. Not needed now.
- **A separate admin or vendor API** only makes sense with separate teams or scaling needs.

Rule of thumb used here: split a program out when a measured problem (a slow queue, a noisy workload, a different scaling or security need) justifies it, not before.

## 2. What "staging needs one thing from you" means

The deploy pipeline works like this:

1. You merge to `staging`. CI runs the checks.
2. The CD workflow **builds the Docker images and uploads them to GitHub's registry**. That is all it does. It does not log in to your server and does not start anything.
3. On the server, someone runs Docker Compose to pull the new images and start the containers.

Step 3 is the one thing that is yours. Before this work, the server only needed to start the API and the web app, because the API did everything. Now the API only answers requests, and the background tasks and scheduled jobs live in two **extra** containers (`worker-prod` and `jobs-prod`).

So when you deploy staging, the command that starts it must start all of them. The repository's `docker-compose.yml` already defines them, so running it unchanged (`docker compose --profile staging up -d`) does the right thing. The risk is a server that still runs an older copy of the compose file, or starts only specific services by name. In that case the site still loads, but **no emails or notifications are sent and no scheduled job runs**, and nothing shows an error.

Is that how production-grade companies work? Splitting into web, API, worker and scheduler programs is standard. Failing silently is not: mature teams (a) deploy all programs together from one definition so none can be forgotten, (b) alert when a queue has no consumer or a scheduler stops, and (c) run an automatic post-deploy check that fails the release. Here: (a) is the compose file, (b) is the heartbeat metric and alerts, and (c) is `scripts/verify-deploy.sh`, which checks that the API is up, the database and cache are reachable, and that the worker and jobs are running, and reports in plain language what is missing. The API also logs an error 90 seconds after start if the worker or jobs are absent.

How to check after every deploy: run `scripts/verify-deploy.sh https://<your-staging-url>`, and `docker compose --profile staging ps` should list `api-prod`, `worker-prod`, `jobs-prod`, `client-prod` and `nginx` as running (and `api-migrate` as exited successfully). Safety net if you cannot update the server's compose file yet: set `PROCESS_ROLE=all` on `api-prod`, which makes it do everything as before.

## 3. The order of work

Each step ends with something you can see, and the next step starts only when it holds. The big operation is last on purpose: it rewrites payment, refund and delivery logic, so it should start from a foundation that has been running and tested.

### Step 1. Local parity (done)
`npm run dev` starts the four programs locally (and `npm run dev:docker` as containers). Verified: all four healthy; stopping the worker leaves the API, jobs and web serving, and `scripts/verify-deploy.sh` reports the stopped worker.
**Done when:** `npm run dev` runs the four programs on your machine.

### Step 2. Ship what is built to `development`
Merge #155 (Phase 0), then #156 to #161 in order (they are stacked, so each later one contains the earlier ones). One merge at a time; wait for CI between them.
**Done when:** `development` contains everything and its CI is green. Local setup on `development` is then `npm install`, `npm run db:generate`, `npm run migrate:deploy`, `npm run dev`.

### Step 3. Roll out to staging
1. Make sure the server runs the repo's compose file (section 2) and its env files contain the required variables (see the environment checklist in the final message of the platform work, or `.env.example`).
2. Deploy. The `api-migrate` container applies the new audit columns before the api starts.
3. Run `scripts/verify-deploy.sh https://<staging-url>` (it must pass), check the five containers, and `docker compose logs worker-prod jobs-prod` for startup lines.
4. Optional but recommended: point Prometheus (or Grafana Cloud) at the metrics ports, load `ops/prometheus/alerts.yml` and import `ops/grafana/nuts-overview.json`.
**Done when:** staging serves traffic with api, worker and jobs running separately, and the dead-letter queue is empty or understood.

### Step 4. Test period (you)
Run through the checklist in the local-development guide on staging: the multi-vendor guard, scroll behaviour, "Not interested", audit rows with request ids, an email and a notification being delivered by the worker, a scheduled job running in `jobs-prod`. Restart `worker-prod` on purpose and confirm checkout keeps working.
**Done when:** no surprises for a few days of normal use. Anything found is fixed before step 5.

### Step 5. Hardening, in small pull requests
These make the money code safer and are done one slice at a time, each deployed to staging before the next:
1. **Payments**: move its transactions to the transaction helper and record critical audit events inside them (payment confirmed, refund requested).
2. **Wallets and vendor payouts**: same, including settlement.
3. **Orders and refunds**: same.
4. **The remaining files** (auth, categories, products, vendors, notifications and others, 12 files): mechanical conversion, then remove the legacy allowlist in the architecture check.
5. **Personalisation polish (0c-2)**: quality-weighted starter shelf, "Why am I seeing this", tiered cold start, shelf cleanups.
**Done when:** the architecture check's legacy list is empty and payments, wallets and refunds write critical audit events atomically.

### Step 6. Turn Temporal on in staging
Decide hosting (recommendation: Temporal Cloud for production; self-hosted for staging), run the Temporal worker container, start the sample workflow, and add the Temporal metrics to the dashboard.
**Done when:** a sample workflow started from a database transaction runs end to end in staging and survives a worker restart.

### Step 7. The big operation
Only now:
1. **W1 order payment** (replaces the unpaid-orders job) behind a flag, running next to the old job for a week and compared, then the job is removed.
2. **W2 refunds**, **W6 announcements**, **W7 abandoned carts**, **W8 account deletion**, each the same way.
3. **Fulfillment on Temporal** and the delivery plan's Phases 1 to 4 (parcels, hub, Lagos pricing and ETA, rider tracking, proof of delivery).
**Done when:** each old cron is gone and each process can be inspected in the Temporal UI.

## 4. Switches that undo things quickly

| If this goes wrong | Do this |
|---|---|
| Roles cause trouble on a server | `PROCESS_ROLE=all` on `api-prod` (one program does everything again) |
| PM2 causes trouble | `PM2_ENABLED=false` (plain Node process) |
| Temporal causes trouble | `TEMPORAL_ENABLED=false` (workflow starts become logged no-ops) |
| A bad deploy | Redeploy the previous image tag; the migrations are additive, so the old version still runs |

## 5. What I need from you

1. How staging is deployed today: which compose file or command runs on the server, and where it lives. That decides whether step 3 needs changes there.
2. Which logs and metrics place to use (self-hosted or a hosted free tier).
3. Temporal in production: Cloud or self-hosted.
