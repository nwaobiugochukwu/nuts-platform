# Master roadmap: the final plan

Last updated: 2026-11-26. This is a living document. It is revised as each batch lands, and the status column in section 4 is the place to look for what is done.

**The rule behind every decision below: do what production teams do.** A decision that exists only to fit a free tier or a shortcut is recorded in section 6 (considered and not adopted), not adopted.

Related: [how the system works](how-it-works.md), [how production teams run services](how-production-teams-run-services.md), [platform reliability plan](platform-reliability-plan.md) (design), [hub fulfillment and delivery plan](hub-fulfillment-and-delivery-plan.md) (the big operation's content), [Running and testing locally](../operations/local-development.md), [ADR 0004](adr/0004-operational-safety-and-environment-parity.md).

## 1. Final decisions

| Area | Decision | Why |
|---|---|---|
| Programs | web, api, worker, jobs and (later) temporal-worker each run as **their own service**. Programs are never combined on purpose. | A crash, deploy or memory problem in one cannot take down another; each scales and restarts on its own. |
| One image | One image per commit, started in different roles (`PM2_APP`); the Temporal worker has its own image because its native library needs a different base. | Build once, run the same thing everywhere. |
| Supervisor | PM2 stays inside each container in every environment. | Same restart behaviour in development and on the platform. |
| Environments | Development and staging only until launch. | There is no production yet. |
| Local development | **Docker Compose** is the standard way: one container per program, started in health order, a log view and a restart per service. | It is the most common practice and the closest to staging. |
| Hosting | Staging needs a plan that allows **at least six services** (web, api, worker, jobs, the Temporal worker, and a metrics collector). | Separate services is the decision; the hosting plan follows it, not the other way round. |
| Data | Managed Postgres (Supabase), Redis (Redis Cloud), hosted RabbitMQ, Temporal Cloud for staging and production. | Teams do not run their own data stores at this size. |
| Observability | Metrics, dashboard and alerts locally; Grafana Cloud on staging; an uptime monitor; Sentry alerts. | Silent failure is the worst failure. |

**Open decisions that need an answer from you** (marked in the batches where they matter): which hosting plan runs the six services (Render paid is the smallest change; AWS later, see section 6); whether to keep the custom ordered launcher once Compose is the main command.

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
- Local development: `npm run dev` starts the data services, compiler, api, worker, jobs and web in order, each waiting for the previous to be healthy, with per-service log files (`npm run dev:quiet`); one VS Code tab per service from `.vscode/tasks.json`; Compose dev services also start in health order.
- Fixes: the "Not interested" save failed because the database rule did not allow that event type (new migration); the discount tags on cards no longer vanish when a product is dismissed.
- Docs: how it works, ADR 0004, how production teams run services, this roadmap.

Not verified: the VS Code tabs and the full Docker dev profile. Nothing in this batch changes behaviour on staging beyond the migration and the audit pipeline.

## 4. The batches

Who acts: **you** create accounts, keys and click in the hosting dashboard; **I** write the files.

| # | Batch | What happens | Status |
|---|---|---|---|
| 0 | Foundation and local parity | Section 3 | pushed with this change |
| 1 | Development like production | Verify the Compose dev profile for real; make it the main dev command (one container per program, health order, per-service logs and restart); add Temporal as a service in it; decide what to retire (the custom launcher, the VS Code tasks) once Compose is proven | next |
| 2 | Review and merge | You merge #155, #156 to #161 and the release branch into `development`, one at a time, CI green between. Do not merge `development` into `staging` before this | after push |
| 3 | Staging as separate services | You choose the hosting plan, create worker and jobs services (plus an environment group, `PM2_APP`, `DB_CONNECTION_LIMIT` api 10 / worker 5 / jobs 3, `AUTO_MIGRATE=false` on worker and jobs), run `scripts/verify-deploy.sh`, set the api to `PM2_APP=api`. If the host's background workers cannot take inbound traffic, use private services | after merge |
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
| **One container running api, worker and jobs** (as a way to fit a small plan) | Not what production teams do: one container failure stops all three, and they share memory | Never as a target. Only as a temporary staging fallback if a hosting limit forces it |
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

1. The hosting plan for staging (six services). This decides how batch 3 is written.
2. Say "go" for batch 1 when you want it.
3. After batch 3: the monitoring accounts and keys listed in batch 4.
