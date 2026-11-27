# Master roadmap: the final plan

Last updated: 2026-11-26. This is a living document. It is revised as each batch lands, and the status column in section 4 is the place to look for what is done.

**The rule behind every decision below: keep it simple and keep failures isolated.** Staging runs on Render as two services, as decided. Splitting into more services is a later step, recorded in section 6.

Related: [how the system works](how-it-works.md), [how production teams run services](how-production-teams-run-services.md), [platform reliability plan](platform-reliability-plan.md) (design), [hub fulfillment and delivery plan](hub-fulfillment-and-delivery-plan.md) (the big operation's content), [Running and testing locally](../operations/local-development.md), [ADR 0004](adr/0004-operational-safety-and-environment-parity.md).

## 1. Final decisions

| Area | Decision | Why |
|---|---|---|
| Programs | **Staging today: one Render service for the backend running everything as one process (`PM2_APP=all`), plus one for web.** The target is api, worker and jobs as three separate processes (`PM2_APP=api,worker,jobs`), then each as its own service. | Measured on 2026-11-26: the three processes need about 980 MB together (api about 390 MB, worker about 400 MB, jobs starting at 120 MB). The free 512 MB instance cannot hold them, and Render kept restarting it. Three processes need an instance of about 1 to 2 GB; until then staging stays on `all`. |
| One image | One image per commit, started in different roles (`PM2_APP`); the Temporal worker has its own image because its native library needs a different base. | Build once, run the same thing everywhere. |
| Supervisor | PM2 stays inside each container in every environment. | Same restart behaviour in development and on the platform. |
| Environments | Development and staging only until launch. | There is no production yet. |
| Local development | **Docker Compose** is the main way (`npm run dev`): one container per program, started in health order, a log view and a restart per service. The no-Docker launcher stays as `npm run dev:local`. | It is the most common practice and the closest to staging. |
| Hosting | **Render.** The backend must be an always-on paid instance for the worker and jobs to be reliable (free services sleep after 15 minutes without traffic). Exactly one copy must run, because jobs must never run twice. | Free web services sleep and Render's free plan does not include background workers. |
| Data | Managed Postgres (Supabase), Redis (Redis Cloud), hosted RabbitMQ, Temporal Cloud for staging and production. | Teams do not run their own data stores at this size. |
| Observability | Metrics, dashboard and alerts locally; Grafana Cloud on staging; an uptime monitor; Sentry alerts. | Silent failure is the worst failure. |

**Open decisions:** which paid Render instance size runs the backend (needed for the three-process layout); whether to retire the no-Docker launcher and VS Code tasks once Compose has been used for a while.

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

## 4. The final list

Status key: **done**, **todo**, **you** (an action only you can take), **decide** (a decision is needed). IDs in brackets point to the [audit](event-driven-and-resilience-audit.md): E event-driven, R resilience, L layout, H health sweep.

### Why this order

1. **Safety net first** (phases 1 and 2): fix security, align the database with the schema, and add tests and CI gates, so every later change is checked.
2. **Move files before changing behaviour** (phase 3): a mechanical move that touches about 240 files conflicts with every other change. Doing it early means all later work lands in its final place. This swaps the order I gave you earlier (layout used to come after messaging).
3. **Make messaging reliable before putting more on it** (phases 4 and 5): moving work onto queues that drop a message after one failure would make things worse.
4. **Money code after the event backbone** (phase 6): payments, wallets and orders are converted once, onto the final event model.
5. **Temporal and delivery last** (phases 8 to 10): they rebuild payment, refund and delivery logic and need a proven foundation.
6. **Staging is paused** until development is healthy; its steps are in the staging track and can resume at any point you choose.

### Phase 0. Done

| ID | Item | Status |
|---|---|---|
| 0.1 | Foundation: transaction runner, PM2 roles, metrics, alerts and dashboard, async audit pipeline, Temporal foundation, request ids, dead-letter tool | done |
| 0.2 | Local parity: `npm run dev` on Docker Compose in health order, a log command per service, local Prometheus and Grafana, ordered no-Docker launcher | done |
| 0.3 | #155 to #161 and the release branch merged into `development`; `development` merged into `staging` (#164) | done |
| 0.4 | Fixes: "Not interested" constraint, card discount tags, push-service warning, Compose RabbitMQ conflict, metrics ports | done |
| 0.5 | Audits and plan written (this document, the audit) | done, **uncommitted** |

### Phase 1. Development health (security and correctness)

| ID | Item | Status |
|---|---|---|
| 1.1 | Upgrade vulnerable dependencies until `npm audit --omit=dev` shows no critical or high: Next.js, express chain (`proxy-addr`, `body-parser`), `multer` and `@nestjs/platform-express`, `compression`, `nanoid`, `sharp`, `postcss`, `prisma` [H1] | done |
| 1.2 | Remove unused direct dependencies: `zod`, `@sentry/node`, `@temporalio/activity`, `@temporalio/common`; remove the dead `BULLMQ_PREFIX` config [H8] | done |
| 1.3 | CI: fail on high or critical advisories; Dependabot (weekly, grouped); local secret scan before commit | done |
| 1.4 | Pin Node: `.nvmrc` and `engines` (Docker and CI already use 22) | done |
| 1.5 | One corrective migration: drop the `CREATOR` role value, create the two missing indexes, rename the legacy `creators_*` indexes and the foreign key, remove the duplicate search indexes, and declare the trigram indexes as raw-SQL-managed so a future `migrate dev` cannot drop them [H2] | done |
| 1.6 | CI check that the migrations and `schema.prisma` produce no drift (with the trigram list allowed) | done |
| 1.7 | Scope the `QueueWithoutConsumers` alert so it ignores `q.nuts.workflows` while Temporal is off [H3] | done |
| 1.8 | Warm the caches on start (campaigns, discover, category previews, categories) [H4] | done |
| 1.9 | Paystack IP filter: use the proxy-aware `req.ip`, not the client header; keep the HMAC check as the real protection [H6] | done |
| 1.10 | Process-level `unhandledRejection` and `uncaughtException` handlers in api, worker, jobs (log, report to Sentry, flush, exit) [H7] | done |
| 1.11 | Fix the root README quickstart (storefront is 5173; the new `npm run dev`); prune and group the ~60 root scripts [H9] | done |
| 1.12 | The lint warning in `request-context.ts`; the hard-coded `poolMax: 0` in the startup log (log the real `DB_CONNECTION_LIMIT`) [H11] | done |
| 1.13 | Timing breakdown in the slow-request log; investigate `auth/refresh` (bcrypt on 4 threads, `UV_THREADPOOL_SIZE`) and the `for-you` feed with a signed-in session [H10] | done (the breakdown is live; `auth/refresh` uses HMAC, bcrypt only for legacy hashes, so read its real database time from `Server-Timing`) |
| 1.14 | Branch hygiene: delete the 65 remote branches already merged into `development` and the old `feat/release1-hardening`; document the branch protection and required checks | **you**: the list of 65 merged branches is ready to delete on your word |
| 1.15 | Add `nuts_*` metric for each circuit breaker and an alert when one is open (also in phase 4) | moved to 4.8 |

**Result (2026-11-27):** `npm audit` for production dependencies went from 33 findings (2 critical, 15 high) to 10 moderate in build-time tooling; the migrated database and `schema.prisma` agree (checked on an empty database built from all 43 migrations); CI now fails on high advisories and on drift; 580 API tests, lint, type-checks, the architecture check and a production web build pass. Not committed to the remote yet (branch `chore/phase1-dev-health`).

### Phase 2. Tests where there are none, and quality gates

| ID | Item | Status |
|---|---|---|
| 2.1 | Referral service (money) [H5] | done (28 tests) |
| 2.2 | All consumers: email, inventory, analytics, notifications, vendor-follow, audit, workflow-start (success, failure, redelivery) | done (all 7 consumers; two known defects pinned as failing tests) |
| 2.3 | The 11 cron jobs without tests, starting with unpaid orders, abandoned carts and vendor summary | done (all 12 jobs and the shared lock; one known defect pinned) |
| 2.4 | Outbox relay under failure: broker down, publish rejected, crash between publish and settle, two relays at once | done except two relays at once, which needs a real database |
| 2.5 | End-to-end money flow test: checkout, pay, webhook, ship, deliver, earnings, refund | done (the existing suite repaired and now run in CI) |
| 2.6 | Smoke test that every route in the OpenAPI document answers without a 5xx (the sweep I ran by hand) | done (`npm run smoke:routes`, usable after a deploy) |
| 2.7 | Coverage thresholds in CI, set at today's level and raised over time | todo |

**Done when:** every consumer, cron and money service has tests, and CI enforces them.

### Phase 3. Code layout to the production standard (audit section 6)

| ID | Item | Status |
|---|---|---|
| 3.1 | One alias scheme (`@api/*`); delete the unused families and the legacy aliases [L3] | todo |
| 3.2 | Rename `infrastructure` into `database`, `cache`, `messaging`, `mail`, `storage`, `observability`, `resilience`, `workflows`; `configuration` becomes `config` [L1, L6, L8] | todo |
| 3.3 | Consumers into their domains (analytics, products, notifications); audit into one module [L1, L2] | todo |
| 3.4 | Auth owns customer, vendor and admin authentication, tokens, account lock and the single cookie module; `modules/admin` split into announcements, platform and staff [L4, L9, L10] | todo |
| 3.5 | One module layout (`controllers/ services/ dto/ consumers/ events/ jobs/`), plural and singular rule, shared types in one place [L4, L5, L6] | todo |
| 3.6 | File kinds fixed: `cron` to `job`, `type` to `types`, `response` to `dto`, no file without a kind [L11] | todo |
| 3.7 | Architecture check enforces layers, deep imports, file and class names, consumer location | todo |
| 3.8 | Database naming: **decision recorded** (my recommendation: keep existing columns, snake_case for every new table and column, written as an ADR) [L12] | decide |

**Done when:** the architecture check passes with the new rules and no behaviour changed (all tests green, the Docker image builds, the stack starts).

### Phase 4. Messaging reliability (audit R3 to R18)

| ID | Item | Status |
|---|---|---|
| 4.1 | Outbox: `next_attempt_at` with exponential backoff and jitter; terminal `DEAD` status; replay for dead rows; alert on dead rows [R3] | todo |
| 4.2 | Outbox: per-aggregate ordering, or declare every consumer order-tolerant [R4] | todo |
| 4.3 | One owner for the relay and the wake-on-commit design written down [R18] | todo |
| 4.4 | Consumers: retry queues with delays (10 s, 1 min, 10 min), an attempt counter header, dead-letter after the last attempt [R6] | todo |
| 4.5 | Classify transient versus permanent errors; permanent go straight to the dead-letter queue [R7] | todo |
| 4.6 | Idempotent consumers: processed-event record per consumer (the email consumer first) [R8] | todo |
| 4.7 | Open circuit means delay and retry, not dead-letter [R13] | todo |
| 4.8 | Circuit breakers: count only timeouts, network errors, 5xx and 429; protect Cloudinary; retry with backoff and jitter for repeatable calls; a gauge and alert per breaker [R9 to R12] | todo |
| 4.9 | Per-queue prefetch and a handler timeout [R15] | todo |
| 4.10 | Fix the inventory consumer race with an atomic increment [R21] | todo |
| 4.11 | Dead-letter alerting by queue and age; runbook entry for replay | todo |

**Done when:** killing a consumer, the broker or a provider mid-flight loses nothing and sends nothing twice (proved by the phase 2 tests).

### Phase 5. Event backbone and the full event catalog (audit sections 1 and 5)

| ID | Item | Status |
|---|---|---|
| 5.1 | Backbone: one envelope, `<aggregate>.<fact>` naming, versioning, publishing through the transaction runner, a queue per consumer, delete the dead routing keys [R19, R20] | todo |
| 5.2 | Move the 8 in-process events onto the backbone with their existing consumers [R19] | todo |
| 5.3 | Webhook inbox: verify, store the raw event once, answer 200, process through the queue [E13] | todo |
| 5.4 | Emails through the queue: OTP, welcome, password reset, password changed, order confirmation with PDF, new-device login [E1, E2, E3] | todo |
| 5.5 | Referral rewards as an event with an idempotency key [E4] | todo |
| 5.6 | User, vendor, catalog, review, cart, promotion and wallet events from the catalog (about 70 in all) | todo |
| 5.7 | Tracking buffers: recommendation, marketplace and search events batched through the analytics queue; debounce cache invalidation [E5, E7] | todo |
| 5.8 | Rating aggregate on the product by event [E9]; analytics rollups [E8]; precomputed feeds [E6] | todo |
| 5.9 | Cache invalidation by event, uploads by signed direct upload and webhook, verify announcement fan-out [E10, E11, E12] | todo |
| 5.10 | Cron and timer work reviewed: what becomes a delayed event now, what waits for Temporal | todo |

**Done when:** every catalog event is published through the outbox in its transaction, has at least one consumer or a recorded reason it has none, and the in-process event emitter is no longer used for business events.

### Phase 6. Money code made safe

| ID | Item | Status |
|---|---|---|
| 6.1 | Payments onto the transaction runner and `ctx.emit` / `ctx.audit`; split the file by use case | todo |
| 6.2 | Wallets and vendor payouts, including settlement | todo |
| 6.3 | Orders and refunds; split the file by use case | todo |
| 6.4 | The remaining 12 services converted; remove the legacy allowlist in the architecture check | todo |
| 6.5 | Split the other very large services (products, discounts, search) by use case [L7] | todo |
| 6.6 | Idempotency review of every write that moves money or stock (keys, unique constraints, replays) | todo |
| 6.7 | Personalisation polish: quality-weighted starter shelf, "Why am I seeing this", tiered cold start | todo |

**Done when:** the architecture check's legacy list is empty and payments, wallets and refunds write critical audit events atomically.

### Phase 7. Production readiness (my additions; veto any you do not want)

| ID | Item | Status |
|---|---|---|
| 7.1 | Runbooks: dead-letter replay, stuck outbox, Redis down, RabbitMQ down, Brevo down, Paystack down, bad migration | todo |
| 7.2 | SLOs and alert tuning from the dashboard (latency, error rate, queue age) | todo |
| 7.3 | Load-test baseline (checkout, feeds, search) and a recorded capacity limit | todo |
| 7.4 | Chaos checks: kill worker, jobs, api, broker, Redis during traffic | todo |
| 7.5 | Backup and restore drill for the database | todo |
| 7.6 | Secrets inventory and rotation plan; PII and log redaction review; data retention and account deletion policy | todo |
| 7.7 | API deprecation: remove the legacy route aliases on a published date | todo |
| 7.8 | ADRs for the decisions in this plan (event model, layout, naming, hosting, Temporal) | todo |

### Phase 8. Temporal

| ID | Item | Status |
|---|---|---|
| 8.1 | Temporal worker in the dev stack; its target stops showing "down"; a sample workflow survives a worker restart | todo |
| 8.2 | W1 order payment expiry behind a flag, beside the old job for a week, then the job is removed | todo |
| 8.3 | W2 refunds, W6 announcements, W7 abandoned carts, W8 account deletion, each the same way | todo |
| 8.4 | Fulfillment on Temporal | todo |

### Phase 9. Delivery operation

| ID | Item | Status |
|---|---|---|
| 9.1 | Parcels and the hub (delivery plan phase 1) | todo |
| 9.2 | Lagos pricing and ETA (phase 2) | todo |
| 9.3 | Rider tracking (phase 3) | todo |
| 9.4 | Proof of delivery (phase 4) | todo |

### Phase 10. Polish

| ID | Item | Status |
|---|---|---|
| 10.1 | The font mismatch (needs your screenshot or the page name) [H12] | you |
| 10.2 | Remaining backlog and any slow screens the metrics show | todo |

### Staging track (paused; resumes when you say, or after phase 5 at the latest)

| ID | Item | Status |
|---|---|---|
| S1 | Render api back to one process: delete `PM2_APP`, `DB_CONNECTION_LIMIT=10`; run `scripts/verify-deploy.sh` | you |
| S2 | Check the web service's health check (a 429 was reported) and the api's "Instance failed" message | you, then me |
| S3 | Keys saved in the Render env group (done by you; names in the Render guide) | you |
| S4 | Collector that sends staging metrics to Grafana Cloud, dashboard import, alerts | me |
| S5 | GitHub Action that runs `verify-deploy.sh` after each merge to `staging`; one image built per commit and promoted, not rebuilt | me |
| S6 | Add the staging outbound addresses to Brevo's authorised IPs (or turn the block off) | you |
| S7 | A paid instance of 1 to 2 GB, then `PM2_APP=api,worker,jobs`, then each program as its own service; `AUTO_MIGRATE=false` on worker and jobs | you decide the size, me the config |
| S8 | Temporal Cloud worker image, service entry, smoke check | me, then you |
| S9 | Log destination decision | you |

### Your own items, any time

1. Add your current IP to Brevo's authorised IPs, then replay any dead-lettered emails with `npm run dlq -- replay --dry-run` first.
2. Send a screenshot or page name for the font mismatch.
3. Say "commit" when you want these documents saved.

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
| **Each program as its own service** | Needs more paid services than the budget allows; for now the backend runs in one service (one process, or three once the instance has about 1 to 2 GB) | When the budget allows: then api, worker and jobs each get their own service |
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

1. **Decision 3.8** (database naming): I recommend keeping existing columns and applying snake_case to every new table and column, recorded as an ADR.
2. Say "commit" for the documents, then "go" for phase 1.
3. Anything in phase 7 you want removed.
