# Master roadmap: the final plan

Last updated: 2026-11-26. This is a living document. It is revised as each batch lands, and the status column in section 4 is the place to look for what is done.

**The rule behind every decision below: keep it simple and keep failures isolated.** Staging runs on Render as two services, as decided. Splitting into more services is a later step, recorded in section 6.

Related: [how the system works](how-it-works.md), [how production teams run services](how-production-teams-run-services.md), [platform reliability plan](platform-reliability-plan.md) (design), [hub fulfillment and delivery plan](hub-fulfillment-and-delivery-plan.md) (the big operation's content), [Running and testing locally](../operations/local-development.md), [ADR 0004](adr/0004-operational-safety-and-environment-parity.md).

## 1. Final decisions

| Area | Decision | Why |
|---|---|---|
| Programs | **Staging on Render: two services.** Service 1 runs api, worker and jobs together as three separate PM2 processes (`PM2_APP=api,worker,jobs`, not `all`, which is one process). Service 2 runs web. The Temporal worker joins as a third service later. | Fits the budget. A crash in one process is restarted by PM2 without touching the others. The weakness is that the container itself (memory, a deploy) stops all three; each program becomes its own service when the budget allows. |
| One image | One image per commit, started in different roles (`PM2_APP`); the Temporal worker has its own image because its native library needs a different base. | Build once, run the same thing everywhere. |
| Supervisor | PM2 stays inside each container in every environment. | Same restart behaviour in development and on the platform. |
| Environments | Development and staging only until launch. | There is no production yet. |
| Local development | **Docker Compose** is the main way (`npm run dev`): one container per program, started in health order, a log view and a restart per service. The no-Docker launcher stays as `npm run dev:local`. | It is the most common practice and the closest to staging. |
| Hosting | **Render.** The backend service must be an always-on paid instance: free services sleep after 15 minutes without traffic, which would stop the worker and jobs. Exactly one copy of it must run, because jobs must never run twice. | Free web services sleep and Render's free plan does not include background workers. |
| Data | Managed Postgres (Supabase), Redis (Redis Cloud), hosted RabbitMQ, Temporal Cloud for staging and production. | Teams do not run their own data stores at this size. |
| Observability | Metrics, dashboard and alerts locally; Grafana Cloud on staging; an uptime monitor; Sentry alerts. | Silent failure is the worst failure. |

**Open decisions:** whether to retire the no-Docker launcher and VS Code tasks once Compose has been used for a while. Still to check before relying on the layout: how much memory the three backend processes need together (to pick the instance size), and pointing Render's health check at `/api/v1/health/background` so a dead worker or jobs process is noticed.

## 2. How the application runs

| Program | What it does | Runs as |
|---|---|---|
| **web** | The storefront, vendor and admin screens (Next.js) | its own service |
| **api** | Answers requests: data for pages, checkout, login | its own service |
| **worker** | Emails, notifications, analytics, stock updates, audit writing | its own service |
| **jobs** | Scheduled jobs. Exactly one copy | its own service |
| temporal-worker | Long-running workflows, when Temporal is on | its own service, own image |

Plus PostgreSQL, Redis, RabbitMQ (and Temporal). All environments run the same programs from the same code and differ only in configuration. The one-process setting (`PM2_APP=all`, the current default) exists only as an emergency rollback; staging services set `PM2_APP` explicitly.

## 3. What is in the push you are about to make (Batch 0)

Everything on `feat/release1-hardening`:

- Platform foundation: transaction runner, PM2 roles, metrics, alerts and dashboard, asynchronous audit pipeline (60 endpoints declare `@Audit`), Temporal foundation, request ids, the dead-letter queue tool.
- Per-program ports and env examples, the Redis connection budget, the Render guide and template, local Prometheus and Grafana.
- Local development: `npm run dev` runs everything in Docker Compose, one container per program, started in health order (data services, api, worker, jobs, web), with one log command per service (`npm run dev:logs:api` and so on). The ordered no-Docker launcher remains as `npm run dev:local`, with a VS Code task per service.
- Fixes: the "Not interested" save failed because the database rule did not allow that event type (new migration); the discount tags on cards no longer vanish when a product is dismissed.
- Docs: how it works, ADR 0004, how production teams run services, this roadmap.

Not verified: the VS Code tabs and the full Docker dev profile. Nothing in this batch changes behaviour on staging beyond the migration and the audit pipeline.

## 4. The batches

Who acts: **you** create accounts, keys and click in the hosting dashboard; **I** write the files.

| # | Batch | What happens | Status |
|---|---|---|---|
| 0 | Foundation and local parity | Section 3 | pushed with this change |
| 1 | Development like production | Compose is now the main dev command (one container per program, health order, per-service logs and restart, Temporal included). Verified once: api, worker, jobs and web all became healthy. Remaining: use it for a while, then decide whether to retire the no-Docker launcher and VS Code tasks | mostly done |
| 2 | Review and merge | You merge #155, #156 to #161 and the release branch into `development`, one at a time, CI green between. Do not merge `development` into `staging` before this | after push |
| 3 | Staging on Render (two services) | I first test `PM2_APP=api,worker,jobs` here: killing the worker must leave the api and jobs running. You then create the backend service (always-on paid instance, one copy, `PM2_APP=api,worker,jobs`, a connection budget split across the three) and the web service, point the health check at `/api/v1/health/background`, and run `scripts/verify-deploy.sh` | after merge |
| 4 | Watching staging | You create Grafana Cloud, an uptime monitor, a Sentry alert, a log destination and `METRICS_TOKEN`. I write the collector config and its service template and the alert import steps | after batch 3 |
| 5 | A gate on every deploy | I add a GitHub Action that runs `verify-deploy.sh` after a merge to `staging` and fails loudly, plus a dependency scan and Dependabot; one image per commit. You add the secrets | after batch 3 |
| 6 | Temporal on staging | You create the Temporal Cloud namespace and API key. I add the dedicated worker Dockerfile, its service entry, env wiring and a smoke check. Done when a sample workflow started inside a transaction runs and survives a worker restart | after batch 4 |
| 7 | Money code made safe | One reviewed PR per slice: payments, then wallets and payouts, then orders and refunds, then the remaining files; unify audit with `ctx.audit`; remove the legacy allowlist in the architecture check | after batch 5 |
| 8 | Processes move to Temporal | Behind flags, each beside its old job for a week: order payment expiry (W1), refunds (W2), announcements (W6), abandoned carts (W7), account deletion (W8) | after batches 6 and 7 |
| 9 | Delivery | The delivery plan's phases 1 to 4: parcels, hub, Lagos pricing and ETA, rider tracking, proof of delivery | after batch 8 |
| 10 | Polish | Personalisation polish (quality-weighted starter shelf, "Why am I seeing this", cold start), plus the backlog | last |

Each batch ends with something you can see and a check that must pass before the next one starts.

## 5. Switches that undo things quickly

| If this goes wrong | Do this |
|---|---|
| Roles cause trouble on a server | `PM2_APP=all` on the api service (one program does everything again) |
| PM2 causes trouble | `PM2_ENABLED=false` (plain Node process) |
| Temporal causes trouble | `TEMPORAL_ENABLED=false` (workflow starts become logged no-ops) |
| A bad deploy | Redeploy the previous image tag; migrations are additive, so the old version still runs |

## 6. Future directions considered

Each was weighed and **not adopted for now**. The last column is the signal that would make us look again.

| Direction | Why not now | Revisit when |
|---|---|---|
| **Each program as its own service** | Needs more paid services than the budget allows; the single-container layout above is the chosen compromise | When the budget allows: then api, worker and jobs each get their own service |
| **Free hosting tiers** (Render free, others) | Free services sleep when idle, background workers are not part of Render's free plan, and instance hours run out. A sleeping worker does no work | Only for throwaway demos |
| **AWS (ECS on Fargate or EC2)** | New accounts get credits and a six-month plan, then it is paid; the setup work (networking, load balancer, registry) is large for a team this size | When staging outgrows the first host, or a requirement (region, compliance, private networking) demands it |
| **Kubernetes** | Operational weight far beyond the need | Many services, many teams, or autoscaling needs |
| **Web on Vercel** | Puts web and api on different domains, which can break login cookies and CSRF protection; needs those settings re-checked first | A measured need for its edge network, after the cookie and CSRF design is verified |
| **Tilt for local development** | Compose is the common standard and is already in the repo | If Compose logs and restarts prove too clumsy |
| **Self-hosted Temporal** | You would run and upgrade a cluster | Cost or data-residency needs outweigh the work |
| **Splitting the worker further** (analytics apart from email) | No measured problem | A growing queue or rising event-loop lag on the worker |
| **A separate real-time (SSE) gateway** | Thousands of open streams are not yet competing with normal requests | Stream count starts to hurt request latency |
| **Separate admin or vendor API** | No separate teams or scaling needs | Different scaling or security requirements per audience |
| **A trained recommendation model** | The deterministic ranker is explainable and enough | Enough data and a measured ceiling in the current ranker |

Rule used throughout: split or add something when a measured problem justifies it, not before.

## 7. What I need from you

1. Say "go" when you want me to test the three-process layout (start of batch 3).
2. Say "go" for batch 1 when you want it.
3. After batch 3: the monitoring accounts and keys listed in batch 4.
