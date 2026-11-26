# How the whole system works

A plain-language tour of NUTS: what runs, how one request travels through it, what protects it when something fails, and **why each piece exists**. Technical terms are explained where they first appear and collected in the [glossary](../engineering/field-manual/glossary.md). For decisions and alternatives see [ADR 0003](adr/0003-process-model-audit-pipeline-and-durable-workflows.md) and [ADR 0004](adr/0004-operational-safety-and-environment-parity.md); for commands see [Running and testing locally](../operations/local-development.md).

## 1. What runs

The application is several independent **programs**. They are built from one codebase and one image, and each does one job, so a crash or slow task in one does not stop the others.

| Program | What it does | If it stops |
|---|---|---|
| **web** | the screens: storefront, vendor and admin (Next.js) | pages stop loading |
| **api** | answers requests: login, catalogue, cart, checkout, live notification streams | nothing can be bought or changed |
| **worker** | background tasks taken from a queue: send emails and notifications, record analytics, update stock, write audit records, start workflows | the site works, but emails, notifications and similar work wait in the queue |
| **jobs** | work on a timer: cancel unpaid orders, cart and wishlist reminders, cleanups. **Exactly one copy** | the site works, but timed work stops |
| temporal-worker | long multi-step processes (only when Temporal is turned on; none are moved onto it yet) | those processes pause |
| api-migrate | a one-off job that updates the database schema before a deploy | the deploy waits |

They share these services (none are our code): **PostgreSQL** (all data), **Redis** (cache, rate limits, job locks, heartbeats, live-notification fan-out), **RabbitMQ** (the message queues) and, later, **Temporal**. They also call outside services: Paystack (payments), Brevo (email), Cloudinary (images), Google (sign-in), web push, Sentry (errors).

**The programs depend on shared services, never on each other.** The api needs no worker to answer requests; the worker needs no api to send an email. The only start order is: shared services first, then the programs in any order. A program that starts too early fails to connect, is restarted by its supervisor with a growing delay, and comes up by itself.

## 2. The same programs everywhere

| Environment | How it starts | What runs |
|---|---|---|
| Your machine | `npm run dev` | the data services from `db:up`, then Docker Compose runs web, api, worker, jobs and Temporal as separate containers, started in health order, logs per service |
| Your machine, without Docker for the programs | `npm run dev:local` | the same programs started one after another on your machine |
| Staging (Render) | two services | service 1 runs api, worker and jobs as three PM2 processes (`PM2_APP=api,worker,jobs`); service 2 runs web |

Every program runs under **PM2**, a process manager that restarts a program if it crashes. The only differences between environments are settings (database addresses, secrets, ports). This is on purpose: if development ran everything in one process and staging ran four, bugs would appear only in staging.

`PM2_APP` defaults to `all` (everything in one process), so a service nobody has configured keeps behaving exactly as before the split.

## 3. How one request travels (placing an order)

1. **The browser** calls the **api**. The api checks who you are and validates the order.
2. **One database transaction** (a group of changes that all succeed or all fail) does everything that must be consistent: it saves the order, reduces stock, and writes an **outbox record** saying "order created". Nothing is sent yet.
3. **The outbox relay** reads those records and publishes them to **RabbitMQ**. Because the record was saved in the same transaction as the order, an event can never be lost or announced for an order that did not save (the *outbox pattern*).
4. **The worker** takes each message and acts: it sends the confirmation email, creates the in-app notification, updates analytics, and so on. If a task keeps failing it goes to the **dead-letter queue** instead of vanishing, where `npm run dlq` can inspect and replay it.
5. **The live notification** reaches your open browser tab: the worker publishes it through Redis, the api (which holds the open connections) pushes it to you.
6. **The jobs program**, on a timer, finds unpaid orders past their deadline and cancels them, restoring stock. Jobs that must not overlap take a lock in Redis, and only one jobs program runs in any case.

The api answers at step 2; everything after it happens in the background, so a slow email provider never slows checkout.

## 4. What watches over it

| Mechanism | What it does | Why it exists |
|---|---|---|
| **Request id** | one id given to a request, carried through logs, queue messages, worker logs and audit rows | to follow one request across programs |
| **Audit trail** | `@Audit` on a controller method says what happened; the service attaches the details with `auditDetails`; an interceptor records it after the response | the request never waits for audit, and no service writes audit by hand |
| **Heartbeats and the deploy check** | worker and jobs report in every 30 s; `GET /api/v1/health/background` fails if either is missing or a queue has no consumer; `scripts/verify-deploy.sh` runs it after a deploy | without these, a missing worker shows no error: emails and timed jobs just stop |
| **Metrics and alerts** | each program serves Prometheus metrics on an internal port; alert rules cover the dead-letter queue, stuck outbox, missing programs, errors and slow requests; a Grafana dashboard shows them | to notice problems before users do |
| **Transaction helper** | one function opens database transactions, retries conflicts and runs follow-up work only after commit | the same safe behaviour everywhere, instead of copies that drift |
| **Connection budget** | per-service database pool sizes; only the api opens the notification subscriber | three programs share the limits of hosted Supabase, Redis and RabbitMQ plans |

## 5. Worker versus temporal-worker

The **worker** does quick, independent tasks from RabbitMQ: send an email, create a notification. Each takes milliseconds and does not remember anything afterwards.

The **temporal-worker** runs long, multi-step processes from Temporal, for example "wait 30 minutes for payment, then check, then cancel and restore stock". Temporal remembers where each process is, across restarts, deploys and waits of days.

Rule of thumb: a one-off side effect is a worker task; anything with waits, deadlines or several steps that must stay consistent is a Temporal workflow. Today the Temporal pieces (client, worker, tests, an image) exist but no real process runs on them, so turning Temporal on changes nothing.

## 6. Why each choice

| Problem | What we did | Trade-off accepted |
|---|---|---|
| One crash or slow task could stop checkout | separate programs, each restarted on its own | more services to run and pay for |
| Timed jobs would run on every copy of the api | exactly one jobs program | a single point to monitor |
| A missing worker is silent | heartbeats, a failing health endpoint, a metric and an alert | one more check to run after deploys |
| Audit slowed requests and was written by hand in 64 places | declared on controllers, recorded after the response | an audit event can be lost if the process dies in the first instant (a transactional tier for money events exists and is adopted in the next release) |
| Hosted services have connection limits | per-service pool sizes, fewer Redis connections | smaller pools per program |
| Development differed from staging | same programs, same supervisor | slower first start than one process |

## 7. What is not built yet

- Moving money-critical audit events into their transactions (`ctx.audit`) and converting the remaining files to the transaction helper (next release).
- Real Temporal workflows (payment expiry, refunds, announcements, abandoned carts, account deletion) and the delivery features.
- Distributed tracing with spans (request ids cover "follow one request" today).
- Hosted monitoring for staging (you create the accounts; see [Deploying to Render](../operations/render-deployment.md)).
- Building one image per commit and deploying that exact image, and an automatic post-deploy check in the delivery pipeline.
